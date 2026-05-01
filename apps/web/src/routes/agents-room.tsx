import { ContactShadows, Float, OrbitControls, Stars, Trail } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Link } from 'wouter';
import { BigCycleCard } from '../components/agents-room/big-cycle-card.tsx';
import { useActivityTail } from '../lib/cockpit-events.ts';
import { useTheme } from '../lib/theme.tsx';
import { MorbiusFace } from '../overlay/morbius-face.tsx';

/**
 * /app/agents-room — Mörbius's 3D agent office.
 *
 * A dark "void" workshop environment containing the 9-agent team rendered
 * as real-time 3D, built with three.js and particle effects.
 *
 * Visual:
 *   · 9 glowing low-poly orbs arranged in a wide arc around a central
 *     Mörbius core
 *   · Each orb = one agent. State drives appearance:
 *       idle    — gentle bob + slow rotation · soft accent halo
 *       working — fast pulse + emissive boost · trail + particles
 *                  toward the central core
 *       break   — drifts toward "lounge corner" · dimmed
 *       rest    — half-scale · slow breathe · cool blue tint
 *   · Central core pulses on every `pipeline.completed` event
 *   · Ambient star-field background + post-processing bloom
 *   · Slow orbital camera with damped OrbitControls
 *
 * Live state: connects to `/orchestrate/events` SSE if present,
 * otherwise simulates realistic activity so the room is never static.
 */

type AgentState = 'idle' | 'working' | 'break' | 'rest';

interface AgentSpec {
  id: string;
  label: string;
  role: string;
  color: string;
  /** Workstation position around the Mörbius being built. */
  position: [number, number, number];
  /** Orb sphere radius. */
  size: number;
}

// Workshop layout · all agents work in a room assembling Mörbius. The
// head is complete and the body is under construction; vitals are
// pending and the build feeds on incoming data pulses.
//
// Mörbius head sits in the centre at y=2 (head done). Below it the
// body wireframe is forming. The 9 agents are at fixed workstations
// around the build, each emitting a data stream toward the body.
// Workstations are arranged in a wide arc on a horseshoe layout.
const AGENT_LAYOUT: AgentSpec[] = [
  // Front-left arc (working on neural / vitals · closer to head)
  {
    id: 'triage',
    label: 'Triage',
    role: 'ESI 1-5 + intent',
    color: '#67e8f9',
    position: [-7.5, 2.5, 3],
    size: 0.42,
  },
  {
    id: 'diagnostic',
    label: 'Diagnostic',
    role: 'cross-validating',
    color: '#34d399',
    position: [-9, 1.0, 1],
    size: 0.46,
  },
  {
    id: 'profile',
    label: 'Profile',
    role: 'FHIR record',
    color: '#22d3ee',
    position: [-8.5, -0.5, -2],
    size: 0.4,
  },
  // Back arc (gauntlet team · stationed behind the build)
  {
    id: 'validator',
    label: 'Validator',
    role: 'gate · confidence',
    color: '#fbbf24',
    position: [-3.5, -1, -7],
    size: 0.4,
  },
  {
    id: 'safety',
    label: 'Safety',
    role: 'gate · red-flag',
    color: '#f43f5e',
    position: [0, -0.5, -8],
    size: 0.42,
  },
  {
    id: 'privacy',
    label: 'Privacy',
    role: 'gate · PHI',
    color: '#a78bfa',
    position: [3.5, -1, -7],
    size: 0.4,
  },
  // Front-right arc (data + research)
  {
    id: 'library',
    label: 'Library',
    role: 'RAG · corpus',
    color: '#60a5fa',
    position: [8.5, -0.5, -2],
    size: 0.4,
  },
  {
    id: 'imaging',
    label: 'Imaging',
    role: 'py-svc · MONAI',
    color: '#10b981',
    position: [9, 1.0, 1],
    size: 0.46,
  },
  {
    id: 'research',
    label: 'Research',
    role: 'PubMed · arXiv',
    color: '#c4b5fd',
    position: [7.5, 2.5, 3],
    size: 0.42,
  },
];

// Mörbius construction · head at (0, 2, 0), body assembling below
const CORE_POSITION: [number, number, number] = [0, 2, 0];
const BODY_TOP: [number, number, number] = [0, 0.6, 0];
// Spine vertebra ids · used as stable React keys instead of array index
const SPINE_VERTEBRAE = ['c1', 'c2', 't1', 't2', 'l1', 'l2'] as const;

// ──────────────────────────────────────────────────────────────────────
//  Single agent orb · all state animation lives here
// ──────────────────────────────────────────────────────────────────────

function AgentOrb({ spec, state }: { spec: AgentSpec; state: AgentState }) {
  // Workshop AgentOrb · sits at a fixed workstation, gentle hover-bob
  // when idle, brighter pulse when "working" on the build, dim when
  // resting. Working agents emit a DataStream toward Mörbius's body.
  const planetRef = useRef<THREE.Mesh>(null);
  const haloRef = useRef<THREE.Mesh>(null);
  const startedAt = useMemo(() => Math.random() * 100, []);

  const target = useMemo(() => {
    switch (state) {
      case 'idle':
        return { sizeMul: 1.0, emissive: 0.55, halo: 0.18 };
      case 'working':
        return { sizeMul: 1.15, emissive: 1.6, halo: 0.5 };
      case 'break':
        return { sizeMul: 0.88, emissive: 0.3, halo: 0.08 };
      case 'rest':
        return { sizeMul: 0.78, emissive: 0.2, halo: 0.05 };
    }
  }, [state]);

  useFrame((_, delta) => {
    const t = startedAt + performance.now() / 1000;
    if (planetRef.current) {
      planetRef.current.rotation.y += delta * (state === 'working' ? 0.9 : 0.28);
      const cur = planetRef.current.scale.x;
      const next = cur + (target.sizeMul * spec.size - cur) * Math.min(1, delta * 4);
      planetRef.current.scale.setScalar(next);
      // Subtle hover bob
      planetRef.current.position.y = Math.sin(t * 1.4) * (state === 'working' ? 0.18 : 0.08);
    }
    if (haloRef.current) {
      const haloScale = 1.35 + Math.sin(t * (state === 'working' ? 5 : 1.6)) * 0.12;
      haloRef.current.scale.setScalar(haloScale * spec.size);
      haloRef.current.position.y = planetRef.current?.position.y ?? 0;
    }
  });

  const color = useMemo(() => new THREE.Color(spec.color), [spec.color]);

  return (
    <group position={spec.position}>
      <mesh ref={haloRef}>
        <sphereGeometry args={[1.05, 24, 24]} />
        <meshBasicMaterial color={color} transparent opacity={target.halo} depthWrite={false} />
      </mesh>
      <mesh ref={planetRef}>
        <sphereGeometry args={[1, 32, 32]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={target.emissive}
          metalness={0.3}
          roughness={0.45}
        />
      </mesh>
      {state === 'working' && (
        <Trail width={spec.size * 0.35} length={4} color={color} attenuation={(w) => w * w}>
          <mesh>
            <sphereGeometry args={[0.04, 6, 6]} />
            <meshBasicMaterial color={color} />
          </mesh>
        </Trail>
      )}
      <AgentLabel spec={spec} state={state} />
    </group>
  );
}

/** DataStream · animated dotted line from a working agent to a point
 *  on Mörbius's body · sells the "feeding data into the build" idea. */
function DataStream({
  from,
  color,
  active,
}: {
  from: [number, number, number];
  color: string;
  active: boolean;
}) {
  const ref = useRef<THREE.Points>(null);
  // 12 packets stream from the agent to a random point on the body
  const target = useMemo<[number, number, number]>(
    () => [(Math.random() - 0.5) * 0.6, Math.random() * 2.4 - 1.4, (Math.random() - 0.5) * 0.6],
    [],
  );
  const N = 12;
  const positions = useMemo(() => new Float32Array(N * 3), []);
  const phases = useMemo(() => Array.from({ length: N }, (_, i) => i / N), []);
  const startedAt = useMemo(() => performance.now() / 1000, []);

  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return g;
  }, [positions]);

  useFrame(() => {
    if (!ref.current || !active) return;
    const t = performance.now() / 1000 - startedAt;
    for (let i = 0; i < N; i++) {
      const u = (t * 0.4 + (phases[i] ?? 0)) % 1;
      const x = from[0] + (target[0] - from[0]) * u;
      const y = from[1] + (target[1] - from[1]) * u;
      const z = from[2] + (target[2] - from[2]) * u;
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
    }
    const attr = ref.current.geometry.getAttribute('position') as THREE.BufferAttribute;
    attr.needsUpdate = true;
  });

  if (!active) return null;
  return (
    <points ref={ref} geometry={geom}>
      <pointsMaterial
        color={color}
        size={0.12}
        transparent
        opacity={0.85}
        sizeAttenuation
        depthWrite={false}
      />
    </points>
  );
}

/** Mörbius body under construction · wireframe torso forming below the
 *  head · build-progress percentage rises over time so it visibly
 *  "comes online". */
function MorbiusBodyBuild() {
  const ref = useRef<THREE.Group>(null);
  const chestRef = useRef<THREE.Mesh>(null);
  const [progress, setProgress] = useState(0.18);
  useEffect(() => {
    const id = window.setInterval(() => {
      setProgress((p) => (p < 0.86 ? p + 0.005 + Math.random() * 0.01 : 0.18));
    }, 1500);
    return () => window.clearInterval(id);
  }, []);
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta * 0.12;
    // Chest core breathes — slow pulse so the body reads "alive", not static.
    if (chestRef.current) {
      const t = performance.now() / 700;
      const k = 1 + Math.sin(t) * 0.06;
      chestRef.current.scale.set(k, k, k);
    }
  });
  // Mörbius body: a friendly rounded-robot silhouette. Replaces the old
  // stretched-wireframe torso with a layered build · rounded core sphere +
  // shoulder spheres + chest plate with a pulsing arc-reactor accent.
  // Spine vertebrae kept as internal indicators behind the chest plate.
  return (
    <group ref={ref} position={BODY_TOP}>
      {/* Rounded torso · solid emissive sphere · friendly silhouette */}
      <mesh position={[0, -0.4, 0]} scale={[1.05, 1.1, 1.0]}>
        <sphereGeometry args={[1.0, 36, 36]} />
        <meshStandardMaterial
          color="#1f1745"
          emissive="#7c3aed"
          emissiveIntensity={0.55}
          metalness={0.7}
          roughness={0.32}
        />
      </mesh>
      {/* Shoulder spheres · chunky accent on each side */}
      <mesh position={[-1.05, 0.05, 0]} scale={0.46}>
        <sphereGeometry args={[1.0, 28, 28]} />
        <meshStandardMaterial
          color="#0f0a26"
          emissive="#a78bfa"
          emissiveIntensity={0.42}
          metalness={0.78}
          roughness={0.36}
        />
      </mesh>
      <mesh position={[1.05, 0.05, 0]} scale={0.46}>
        <sphereGeometry args={[1.0, 28, 28]} />
        <meshStandardMaterial
          color="#0f0a26"
          emissive="#a78bfa"
          emissiveIntensity={0.42}
          metalness={0.78}
          roughness={0.36}
        />
      </mesh>
      {/* Chest plate · flat disc that frames the core accent */}
      <mesh position={[0, -0.3, 0.92]} rotation={[0, 0, 0]}>
        <cylinderGeometry args={[0.42, 0.42, 0.06, 48]} />
        <meshStandardMaterial
          color="#0a0820"
          emissive="#22d3ee"
          emissiveIntensity={0.45}
          metalness={0.85}
          roughness={0.24}
        />
      </mesh>
      {/* Core accent · the breathing center · brightest point on the body */}
      <mesh ref={chestRef} position={[0, -0.3, 0.96]}>
        <sphereGeometry args={[0.22, 24, 24]} />
        <meshStandardMaterial
          color="#67e8f9"
          emissive="#22d3ee"
          emissiveIntensity={2.4}
          metalness={0.2}
          roughness={0.18}
          toneMapped={false}
        />
      </mesh>
      {/* Spine vertebrae · still here but lifted behind the chest plate
          so they read as "structure showing through" rather than the
          whole body skeleton. Each one lights up as build progress
          climbs past its position. */}
      {SPINE_VERTEBRAE.map((vid, i) => {
        const visible = i / SPINE_VERTEBRAE.length < progress;
        return (
          <mesh
            key={vid}
            position={[0, -0.3 - i * 0.32, -0.55]}
            scale={visible ? 0.85 : 0.55}
            visible={visible}
          >
            <torusGeometry args={[0.16 + i * 0.018, 0.034, 8, 24]} />
            <meshStandardMaterial
              color="#67e8f9"
              emissive="#67e8f9"
              emissiveIntensity={1.0}
              transparent
              opacity={0.85}
            />
          </mesh>
        );
      })}
      {/* Base · low rounded dome instead of the old flat disc · gives
          the build a friendly "stands on its own" anchor. */}
      <mesh position={[0, -2.85, 0]}>
        <sphereGeometry args={[1.35, 32, 24, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial
          color="#1a1233"
          emissive="#a78bfa"
          emissiveIntensity={0.55}
          metalness={0.78}
          roughness={0.3}
        />
      </mesh>
    </group>
  );
}

/** Vitals waveform · ECG-like pulse line floating beside the build.
 *  Uses a Three.js Line wrapped in <primitive> so JSX picks the R3F
 *  object instead of the intrinsic SVG `<line>` element. */
function VitalsWaveform() {
  const N = 90;
  const positions = useMemo(() => new Float32Array(N * 3), []);
  const lineObj = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const m = new THREE.LineBasicMaterial({ color: 0x34d399, transparent: true, opacity: 0.85 });
    const l = new THREE.Line(g, m);
    l.position.set(0, 4.2, -2);
    return l;
  }, [positions]);
  useFrame(() => {
    const t = performance.now() / 600;
    for (let i = 0; i < N; i++) {
      const u = i / N;
      const x = (u - 0.5) * 5;
      const ph = (u * 6 + t) % 1;
      let y = Math.sin(u * Math.PI * 8 + t) * 0.05;
      if (ph > 0.45 && ph < 0.55) y += 0.5;
      if (ph > 0.55 && ph < 0.6) y -= 0.18;
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = 0;
    }
    const attr = lineObj.geometry.getAttribute('position') as THREE.BufferAttribute;
    attr.needsUpdate = true;
  });
  return <primitive object={lineObj} />;
}

function AgentLabel({ spec, state }: { spec: AgentSpec; state: AgentState }) {
  // Render the label as a small sprite-plane that always faces the camera
  const ref = useRef<THREE.Group>(null);
  useFrame((stateThree) => {
    if (ref.current) ref.current.lookAt(stateThree.camera.position);
  });
  // Use canvas texture for label · keeps R3F deps minimal
  const texture = useMemo(
    () => makeLabelTexture(spec.label, spec.role, state),
    [spec.label, spec.role, state],
  );
  return (
    <group ref={ref} position={[0, 1.7, 0]}>
      <mesh>
        <planeGeometry args={[2.2, 0.7]} />
        <meshBasicMaterial map={texture} transparent depthWrite={false} />
      </mesh>
    </group>
  );
}

function makeLabelTexture(label: string, role: string, state: AgentState): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 160;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);
  ctx.fillStyle = 'rgba(8, 12, 24, 0.78)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = 'rgba(103, 232, 249, 0.4)';
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, canvas.width, canvas.height);
  ctx.font = 'bold 56px Syne, system-ui, sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'top';
  ctx.fillText(label, 24, 14);
  ctx.font = 'normal 22px JetBrains Mono, monospace';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
  ctx.fillText(role, 24, 80);
  ctx.font = 'bold 18px JetBrains Mono, monospace';
  ctx.fillStyle =
    state === 'working'
      ? '#34d399'
      : state === 'break'
        ? '#fbbf24'
        : state === 'rest'
          ? '#94a3b8'
          : '#67e8f9';
  ctx.fillText(`· ${state.toUpperCase()}`, 24, 120);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

// ──────────────────────────────────────────────────────────────────────
//  Central Mörbius core · pulses on pipeline.completed
// ──────────────────────────────────────────────────────────────────────

function MörbiusCore({ pulseAt }: { pulseAt: number }) {
  // More realistic central figure: replaced the wireframe icosahedron
  // with the actual MorbiusFace (the 3D head used on landing + dashboard)
  // plus a glowing pedestal underneath, so the central figure reads as the
  // focal point of the room, not a placeholder.
  const groupRef = useRef<THREE.Group>(null);
  const haloRef = useRef<THREE.Mesh>(null);
  const ringRef = useRef<THREE.Mesh>(null);

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    const t = performance.now() / 1000;
    // Pulse for 1.2 s after a pipeline.completed event
    const sinceP = (performance.now() - pulseAt) / 1000;
    const pulse = sinceP < 1.2 ? 1 + (1.2 - sinceP) * 0.35 : 1;
    const breathe = 1 + Math.sin(t * 1.2) * 0.04;
    groupRef.current.scale.setScalar(pulse * breathe);
    if (haloRef.current) {
      haloRef.current.rotation.z += delta * 0.4;
      const haloScale = 1 + Math.sin(t * 1.6) * 0.06;
      haloRef.current.scale.setScalar(haloScale);
    }
    if (ringRef.current) {
      ringRef.current.rotation.z -= delta * 0.25;
    }
  });

  return (
    <group position={CORE_POSITION} ref={groupRef}>
      {/* Pedestal · subtly emits violet so the head sits on light */}
      <mesh position={[0, -1.6, 0]}>
        <cylinderGeometry args={[1.6, 1.8, 0.18, 64]} />
        <meshStandardMaterial
          color="#1a1233"
          emissive="#8b5cf6"
          emissiveIntensity={0.45}
          metalness={0.7}
          roughness={0.25}
        />
      </mesh>
      {/* Halo ring · floating laurel */}
      <mesh ref={haloRef} position={[0, 1.1, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[1.55, 0.04, 12, 64]} />
        <meshStandardMaterial color="#a78bfa" emissive="#a78bfa" emissiveIntensity={2.2} />
      </mesh>
      {/* Counter-rotating outer ring · two-frequency motion */}
      <mesh ref={ringRef} position={[0, 0.4, 0]} rotation={[Math.PI / 2.3, 0, 0]}>
        <torusGeometry args={[2.1, 0.018, 8, 96]} />
        <meshStandardMaterial color="#67e8f9" emissive="#67e8f9" emissiveIntensity={1.4} />
      </mesh>
      {/* The actual Mörbius — gentle float + always faces forward */}
      <Float
        speed={1.2}
        rotationIntensity={0.15}
        floatIntensity={0.4}
        floatingRange={[-0.05, 0.05]}
      >
        <group scale={1.05} position={[0, 0.2, 0]}>
          <MorbiusFace listening />
        </group>
      </Float>
    </group>
  );
}

// ──────────────────────────────────────────────────────────────────────
//  Live event subscription · drives agent states
// ──────────────────────────────────────────────────────────────────────

/**
 * useAgentStates — derives per-agent state from the LIVE activity sink.
 *
 * Reads `/dev/activity` via `useActivityTail`. Each row carries an
 * `action` like `agent.triage.completed` or a `payload.agent` field;
 * we map any agent mention in the last 5 s to "working", and a
 * `pipeline.completed` event triggers the core pulse. Agents that
 * haven't surfaced in 12 s drift to "idle"; longer than 60 s →
 * "break". This makes the room genuinely react to real consults
 * happening in clinic / dev-console / autopilot.
 *
 * Falls back to a gentle simulated loop when the activity sink is
 * empty (no consults yet today) so the room never reads as dead on
 * a fresh boot.
 */
function useAgentStates() {
  const { rows } = useActivityTail({ maxEntries: 200, bootstrapLimit: 80 });
  const [states, setStates] = useState<Record<string, AgentState>>(() =>
    Object.fromEntries(AGENT_LAYOUT.map((a) => [a.id, 'idle' as AgentState])),
  );
  const [corePulse, setCorePulse] = useState(0);
  const lastSeenRef = useRef<Record<string, number>>({});

  // Drive states off the live activity feed.
  useEffect(() => {
    if (rows.length === 0) return;
    const now = Date.now();
    const lastSeen = lastSeenRef.current;
    const knownIds = new Set(AGENT_LAYOUT.map((a) => a.id));
    let pulseFired = false;
    for (const row of rows) {
      // Pipeline completion → fire the core pulse once per render.
      if (
        !pulseFired &&
        (row.action === 'pipeline.completed' || row.action === 'orchestrate.completed')
      ) {
        setCorePulse(performance.now());
        pulseFired = true;
      }
      // Pull an agent name out of the action / payload.
      const candidate =
        row.action.match(/agent\.([a-z-]+)\./)?.[1] ??
        (typeof row.payload?.agent === 'string' ? row.payload.agent : null);
      if (candidate && knownIds.has(candidate)) {
        const prev = lastSeen[candidate] ?? 0;
        if (row.ts > prev) lastSeen[candidate] = row.ts;
      }
    }
    setStates((prev) => {
      const next: Record<string, AgentState> = { ...prev };
      for (const id of knownIds) {
        const seen = lastSeen[id];
        if (!seen) continue;
        const age = now - seen;
        next[id] =
          age < 5_000 ? 'working' : age < 12_000 ? 'idle' : age < 60_000 ? 'idle' : 'break';
      }
      return next;
    });
  }, [rows]);

  // Gentle simulated background loop — only kicks in if the activity
  // sink has been silent for 30 s. Keeps the room from looking dead
  // when nothing is happening upstream.
  useEffect(() => {
    let alive = true;
    const tick = () => {
      if (!alive) return;
      const lastSeen = lastSeenRef.current;
      const stale = Object.values(lastSeen).every((ts) => Date.now() - ts > 30_000);
      if (stale) {
        setStates((prev) => {
          const next: Record<string, AgentState> = { ...prev };
          const ids = AGENT_LAYOUT.map((a) => a.id);
          const target = ids[Math.floor(Math.random() * ids.length)] ?? ids[0];
          if (target) next[target] = 'working';
          for (const id of ids) {
            if (id === target) continue;
            if (prev[id] === 'working') next[id] = 'idle';
          }
          return next;
        });
      }
      window.setTimeout(tick, 5_000 + Math.random() * 3_000);
    };
    const id = window.setTimeout(tick, 1_500);
    return () => {
      alive = false;
      window.clearTimeout(id);
    };
  }, []);

  return { states, corePulse };
}

// ──────────────────────────────────────────────────────────────────────
//  Background ambient particle field
// ──────────────────────────────────────────────────────────────────────

function ParticleField() {
  const ref = useRef<THREE.Points>(null);
  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const N = 400;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const r = 12 + Math.random() * 8;
      const theta = Math.random() * Math.PI * 2;
      const phi = (Math.random() - 0.5) * 0.8;
      pos[i * 3] = r * Math.cos(theta) * Math.cos(phi);
      pos[i * 3 + 1] = r * Math.sin(phi) - 0.5;
      pos[i * 3 + 2] = r * Math.sin(theta) * Math.cos(phi);
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return g;
  }, []);
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta * 0.03;
  });
  return (
    <points ref={ref} geometry={geom}>
      <pointsMaterial
        color="#67e8f9"
        size={0.05}
        transparent
        opacity={0.55}
        sizeAttenuation
        depthWrite={false}
      />
    </points>
  );
}

// ──────────────────────────────────────────────────────────────────────
//  Page
// ──────────────────────────────────────────────────────────────────────

// ──────────────────────────────────────────────────────────────────────
//  Live metrics HUD — real numbers, not abstract orbits
//
//  Surfaces concrete Mörbius analysis values across the agents-room
//  dashboard cards rather than relying on graphs alone.
//
//  Polls /errors/stats + /research/snapshot every 10 s and surfaces five
//  live numbers as a vertical card stack on the right edge. Each number
//  is tabular-num + mono so the eye reads it as a real telemetry feed,
//  not a decorated mockup.
// ──────────────────────────────────────────────────────────────────────

interface LiveMetrics {
  activeAgents: number;
  passRate: number | null;
  errorEvents: number | null;
  kgNodes: number | null;
  kgEdges: number | null;
  lastConsultMs: number | null;
  dockerRunning: number | null;
  dockerTotal: number | null;
}

function MetricsHUD({ states }: { states: Record<string, AgentState> }) {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const [metrics, setMetrics] = useState<LiveMetrics>({
    activeAgents: 0,
    passRate: null,
    errorEvents: null,
    kgNodes: null,
    kgEdges: null,
    lastConsultMs: null,
    dockerRunning: null,
    dockerTotal: null,
  });

  // Poll the two server endpoints every 10 s. Both are cheap and idempotent.
  // setMetrics is called with the callback form so the polling closure
  // doesn't capture (and stale-keep) the metrics value across ticks.
  useEffect(() => {
    let alive = true;
    const fetchMetrics = async () => {
      let errorEvents: number | null | undefined;
      let passRate: number | null | undefined;
      let kgNodes: number | null | undefined;
      let kgEdges: number | null | undefined;
      let lastConsultMs: number | null | undefined;
      try {
        const r = await fetch('/errors/stats');
        if (r.ok) {
          const j = (await r.json()) as { total?: number; pass_rate?: number };
          errorEvents = typeof j.total === 'number' ? j.total : null;
          passRate = typeof j.pass_rate === 'number' ? j.pass_rate : null;
        }
      } catch {
        /* offline · keep prior */
      }
      try {
        const r = await fetch('/research/snapshot');
        if (r.ok) {
          const j = (await r.json()) as {
            graph?: { nodes?: number; edges?: number };
            last_cycle_at?: string;
          };
          kgNodes = j.graph?.nodes ?? null;
          kgEdges = j.graph?.edges ?? null;
          if (j.last_cycle_at) {
            lastConsultMs = Date.now() - new Date(j.last_cycle_at).getTime();
          }
        }
      } catch {
        /* offline · keep prior */
      }
      // Docker stats — best-effort. Endpoint is wired but may not be
      // implemented yet; keep prior value silently when missing.
      let dockerRunning: number | null | undefined;
      let dockerTotal: number | null | undefined;
      try {
        const r = await fetch('/ops/docker');
        if (r.ok) {
          const j = (await r.json()) as {
            containers?: Array<{ state: string }>;
          };
          if (Array.isArray(j.containers)) {
            dockerTotal = j.containers.length;
            dockerRunning = j.containers.filter((c) => c.state === 'running').length;
          }
        }
      } catch {
        /* offline · keep prior */
      }
      if (!alive) return;
      setMetrics((prev) => ({
        activeAgents: 0,
        passRate: passRate === undefined ? prev.passRate : passRate,
        errorEvents: errorEvents === undefined ? prev.errorEvents : errorEvents,
        kgNodes: kgNodes === undefined ? prev.kgNodes : kgNodes,
        kgEdges: kgEdges === undefined ? prev.kgEdges : kgEdges,
        lastConsultMs: lastConsultMs === undefined ? prev.lastConsultMs : lastConsultMs,
        dockerRunning: dockerRunning === undefined ? prev.dockerRunning : dockerRunning,
        dockerTotal: dockerTotal === undefined ? prev.dockerTotal : dockerTotal,
      }));
    };
    fetchMetrics();
    const id = window.setInterval(fetchMetrics, 10_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  const activeCount = Object.values(states).filter((s) => s === 'working').length;

  const cards: { label: string; value: string; sub: string; tone: 'q' | 'b' | 'a' | 'p' | 'r' }[] =
    [
      {
        label: 'agents · active',
        value: activeCount.toString().padStart(2, '0'),
        sub: `of ${AGENT_LAYOUT.length} · live state`,
        tone: 'b',
      },
      {
        label: 'gauntlet · pass-rate',
        value:
          metrics.passRate === null ? '--.-' : (metrics.passRate * 100).toFixed(1).padStart(4, ' '),
        sub: 'validator → safety → privacy',
        tone: 'q',
      },
      {
        label: 'sequential error · journal',
        value:
          metrics.errorEvents === null ? '----' : metrics.errorEvents.toString().padStart(4, '0'),
        sub: 'residuals · ±0.3 cap · 0.97/day',
        tone: 'r',
      },
      {
        label: 'second brain · nodes',
        value: metrics.kgNodes === null ? '---' : metrics.kgNodes.toString().padStart(3, '0'),
        sub: `${metrics.kgEdges ?? '--'} edges · graphify-tagged`,
        tone: 'p',
      },
      {
        label: 'last research-cycle',
        value:
          metrics.lastConsultMs === null
            ? '--h --m'
            : metrics.lastConsultMs < 60_000
              ? 'just now'
              : metrics.lastConsultMs < 3_600_000
                ? `${Math.round(metrics.lastConsultMs / 60_000)}m ago`
                : `${Math.round(metrics.lastConsultMs / 3_600_000)}h ago`,
        sub: 'scripts/research-cycle.ts',
        tone: 'a',
      },
    ];

  // Tone palette · dark theme uses light tints (200), light theme uses
  // darker tints (700/600) so the labels stay legible against the white
  // backdrop-blurred card. Border + background flip between black/55 and
  // white/70 so each card reads as a real telemetry chip in either mode.
  const toneClass: Record<'q' | 'b' | 'a' | 'p' | 'r', string> = isLight
    ? {
        q: 'border-quantum-500/40 text-quantum-700',
        b: 'border-bio-500/40 text-bio-700',
        a: 'border-amber-500/50 text-amber-700',
        p: 'border-purple-500/40 text-purple-700',
        r: 'border-rose-500/40 text-rose-700',
      }
    : {
        q: 'border-quantum-400/40 text-quantum-200',
        b: 'border-bio-400/40 text-bio-200',
        a: 'border-amber-400/40 text-amber-200',
        p: 'border-purple-400/40 text-purple-200',
        r: 'border-rose-400/40 text-rose-200',
      };
  const cardBg = isLight ? 'bg-white/75' : 'bg-black/55';

  return (
    <div className="pointer-events-none absolute top-4 right-4 flex w-60 flex-col gap-2">
      <div
        className={`font-mono text-[10px] uppercase tracking-[0.32em] ${isLight ? 'text-quantum-700' : 'text-quantum-300'}`}
      >
        · live telemetry · 10 s poll
      </div>
      {cards.map((c) => (
        <div
          key={c.label}
          className={`rounded-lg border ${cardBg} px-3 py-2 backdrop-blur ${toneClass[c.tone]}`}
        >
          <div className="font-mono text-[9px] uppercase tracking-[0.28em] opacity-80">
            {c.label}
          </div>
          <div className="mt-0.5 font-mono text-xl font-bold tabular-nums text-app-primary">
            {c.value}
          </div>
          <div className="font-mono text-[9px] tabular-nums text-app-muted">{c.sub}</div>
        </div>
      ))}
    </div>
  );
}

export function AgentsRoomPage() {
  const { states, corePulse } = useAgentStates();
  const { theme } = useTheme();
  const isLight = theme === 'light';

  // Light theme = clinical white-blue canvas with brighter ambient,
  // softer bloom, lighter vignette. Dark theme keeps the noir deep-space
  // build-bay look.
  const canvasBackground = isLight
    ? 'radial-gradient(ellipse at 50% 50%, #dbeafe 0%, #f8fafc 70%)'
    : 'radial-gradient(ellipse at 50% 50%, #0a1230 0%, #02040a 70%)';
  const ambientIntensity = isLight ? 0.85 : 0.22;
  const keyLightColor = isLight ? '#ffffff' : '#fff5d6';
  const keyLightIntensity = isLight ? 3.0 : 4.2;
  const rimLightColor = isLight ? '#67e8f9' : '#a78bfa';
  const rimLightIntensity = isLight ? 0.9 : 1.6;
  const floorColor = isLight ? '#e0f2fe' : '#0a1230';
  const floorEmissive = isLight ? '#bae6fd' : '#3b2a78';
  const floorEmissiveIntensity = isLight ? 0.18 : 0.45;
  const floorOpacity = isLight ? 0.6 : 0.85;
  const starsCount = isLight ? 0 : 5000;
  const bloomIntensity = isLight ? 0.55 : 1.25;
  const vignetteDarkness = isLight ? 0.25 : 0.9;
  const contactShadowOpacity = isLight ? 0.18 : 0.45;

  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden">
      <Canvas
        // Tighter, more compact framing for the 3D viewport with maximum
        // pixel depth. Camera moved closer (28 → 18) and FOV tightened (50 → 38) so
        // the build site fills the frame instead of swimming in negative
        // space. DPR ceiling lifted to 2.5 for crisp pixel depth on
        // retina / hi-DPI screens. The cinematic 35mm-equivalent feel.
        camera={{ position: [0, 5.5, 18], fov: 38, near: 0.1, far: 200 }}
        dpr={[1, 2.5]}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        style={{ background: canvasBackground }}
      >
        {/* Workshop lighting · soft warm key from above the build, cool
            rim from agent stations. The scene reads as a lab-floor in
            deep space — no walls, but a clear pool of light around the
            Mörbius being assembled. */}
        <ambientLight intensity={ambientIntensity} />
        <pointLight
          position={[0, 6, 0]}
          intensity={keyLightIntensity}
          color={keyLightColor}
          distance={28}
          decay={1.5}
        />
        <pointLight
          position={[0, 0, 0]}
          intensity={rimLightIntensity}
          color={rimLightColor}
          distance={14}
          decay={2}
        />
        <directionalLight position={[10, 6, -10]} intensity={0.22} color="#7dd3fc" />
        <directionalLight position={[-10, -6, 10]} intensity={0.16} color="#a78bfa" />

        {/* Deep-space starfield · dense + slow. Hidden in light theme so
            the clinical canvas stays clean (no dot-noise on white). */}
        {starsCount > 0 && (
          <Stars
            radius={140}
            depth={90}
            count={starsCount}
            factor={5}
            saturation={0}
            fade
            speed={0.4}
          />
        )}
        <ParticleField />

        {/* Floor pad · subtle violet disc grounds the build site. In light
            theme it becomes a cool sky-blue pad so it reads as a bright
            clinical platform, not a deep-space ring. */}
        <mesh position={[0, -3.4, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[3, 11, 80]} />
          <meshStandardMaterial
            color={floorColor}
            emissive={floorEmissive}
            emissiveIntensity={floorEmissiveIntensity}
            metalness={0.6}
            roughness={0.6}
            side={THREE.DoubleSide}
            transparent
            opacity={floorOpacity}
          />
        </mesh>
        <ContactShadows
          position={[0, -3.35, 0]}
          opacity={contactShadowOpacity}
          scale={24}
          blur={2.4}
          far={6}
        />

        {/* The 9 agents at fixed workstations around the build */}
        {AGENT_LAYOUT.map((spec) => (
          <AgentOrb key={spec.id} spec={spec} state={states[spec.id] ?? 'idle'} />
        ))}

        {/* Data streams · each working agent feeds packets into the body */}
        {AGENT_LAYOUT.map((spec) => (
          <DataStream
            key={`stream-${spec.id}`}
            from={spec.position}
            color={spec.color}
            active={(states[spec.id] ?? 'idle') === 'working'}
          />
        ))}

        {/* Mörbius head — already complete, sits at the top of the build */}
        <MörbiusCore pulseAt={corePulse} />

        {/* Body under construction · forms below the head as data arrives */}
        <MorbiusBodyBuild />

        {/* Vitals waveform · pending · pulses beside the build */}
        <VitalsWaveform />

        {/* Camera · slow auto-orbit so every angle is visible */}
        <OrbitControls
          enablePan={false}
          enableZoom
          autoRotate
          autoRotateSpeed={0.22}
          // Tighter range (was 12→56). The usable orbit sits at 14-22; further
          // out is empty space, closer than 8 clips through the body geometry.
          minDistance={8}
          maxDistance={32}
          maxPolarAngle={Math.PI * 0.85}
          minPolarAngle={Math.PI * 0.15}
        />

        {/* Post-processing · the cinematic finish. Light theme softens
            both the bloom (whites don't blow out) and the vignette (so
            corners stay clean clinical instead of fading to noir). */}
        <EffectComposer>
          <Bloom
            intensity={bloomIntensity}
            luminanceThreshold={0.1}
            luminanceSmoothing={0.55}
            mipmapBlur
          />
          <Vignette eskil={false} offset={0.15} darkness={vignetteDarkness} />
        </EffectComposer>
      </Canvas>

      {/* Overlay caption · top-left. Backdrop-blur wash in light theme so
          the headline reads on the bright canvas without an extra panel. */}
      <div
        className={`pointer-events-none absolute top-4 left-4 max-w-md rounded-xl ${isLight ? 'bg-white/55 px-3 py-2 backdrop-blur' : ''}`}
      >
        <div
          className={`font-mono text-[10px] uppercase tracking-[0.32em] ${isLight ? 'text-quantum-700' : 'text-quantum-300'}`}
        >
          · build site · 9 agents · assembling Mörbius
        </div>
        <h1 className="mt-1 font-display text-2xl font-bold text-app-primary sm:text-3xl">
          The body, coming online.
        </h1>
        <p className="mt-1 max-w-md font-sans text-sm text-app-muted">
          Head's done. Body's wiring up. Vitals pending. Each agent feeds its data stream into the
          build — every packet you see is one piece of Mörbius coming alive. He'll be ready soon.
        </p>
      </div>

      {/* Live metrics HUD — real numbers, right edge */}
      <MetricsHUD states={states} />

      {/* Big training cycle — one-click pipeline + visual report. */}
      <BigCycleCard />

      {/* State legend · bottom-left */}
      <div className="pointer-events-none absolute bottom-4 left-4 flex flex-wrap items-center gap-3 font-mono text-[10px] uppercase tracking-[0.22em] text-app-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-quantum-300" /> idle
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-bio-300" /> working
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-amber-300" /> break
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-app-faint" /> rest
        </span>
      </div>
    </div>
  );
}
