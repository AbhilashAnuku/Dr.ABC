import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { readFacePose } from '../lib/face-pose.ts';
import { getMouthAmplitude } from '../lib/voice.ts';

/**
 * Mörbius — cute 3D bot face (Wall-E / EVE / BB-8 mood).
 *
 * Round white head, big glowing cyan eyes that track the cursor, blink,
 * smile that lip-syncs, antenna with a pulsing tip, and cheek dots.
 * Built fully in code — no GLB needed.
 */

interface MorbiusFaceProps {
  speaking?: boolean;
  listening?: boolean;
  /** Override mouth amplitude (0..1) — useful for mic input. */
  mouthOpen?: number;
}

const SHELL = '#f7f8fa';
const SHELL_DEEP = '#dbe2ec';
const ACCENT = '#1f2a4a';
const CYAN = '#38bdf8';
const CYAN_BRIGHT = '#7dd3fc';
const BIO = '#10b981';

export function MorbiusFace({ speaking = false, listening = true, mouthOpen }: MorbiusFaceProps) {
  const headRef = useRef<THREE.Group | null>(null);
  const lidLRef = useRef<THREE.Mesh | null>(null);
  const lidRRef = useRef<THREE.Mesh | null>(null);
  const eyeLRef = useRef<THREE.Mesh | null>(null);
  const eyeRRef = useRef<THREE.Mesh | null>(null);
  const pupilLRef = useRef<THREE.Mesh | null>(null);
  const pupilRRef = useRef<THREE.Mesh | null>(null);
  const smileRef = useRef<THREE.Mesh | null>(null);
  const antennaTipRef = useRef<THREE.Mesh | null>(null);
  const cheekLRef = useRef<THREE.Mesh | null>(null);
  const cheekRRef = useRef<THREE.Mesh | null>(null);
  const visorRef = useRef<THREE.Mesh | null>(null);

  const blink = useMemo(() => ({ next: 2, value: 0, double: false }), []);
  const sway = useMemo(() => ({ t: 0, rx: 0, ry: 0 }), []);
  const cursor = useMemo(() => ({ x: 0, y: 0 }), []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      cursor.x = (e.clientX / window.innerWidth) * 2 - 1;
      cursor.y = -((e.clientY / window.innerHeight) * 2 - 1);
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    return () => window.removeEventListener('mousemove', onMove);
  }, [cursor]);

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;

    // ---- BLINK (cute double-blinks more often) ----
    if (t > blink.next) {
      blink.value = 1;
      blink.next = blink.double ? t + 0.16 : t + 3 + Math.random() * 2.5;
      blink.double = !blink.double && Math.random() < 0.32;
    }
    blink.value = Math.max(0, blink.value - dt * 8);
    const lidScale = Math.max(0.04, 1 - blink.value * 0.96);
    if (lidLRef.current) lidLRef.current.scale.y = lidScale;
    if (lidRRef.current) lidRRef.current.scale.y = lidScale;

    // ---- HEAD + EYE TRACKING ----
    // Stage-8: face-mirror takes priority when the user has the camera
    // toggle on AND the tracker has a fresh pose; otherwise fall back
    // to cursor follow. Same `{ x, y }` coordinate space, so the math
    // below is identical for both sources.
    const fp = readFacePose();
    const sourceX = fp.fresh ? fp.x : cursor.x;
    const sourceY = fp.fresh ? fp.y : cursor.y;
    const targetRy = sourceX * 0.22;
    const targetRx = -sourceY * 0.13;
    sway.ry += (targetRy - sway.ry) * 0.06;
    sway.rx += (targetRx - sway.rx) * 0.06;
    if (headRef.current) {
      headRef.current.rotation.y = sway.ry + Math.sin(t * 0.5) * 0.03;
      headRef.current.rotation.x = sway.rx + Math.sin(t * 0.7) * 0.02;
      headRef.current.position.y = Math.sin(t * 1.2) * 0.025; // bob
    }
    // Pupils dart toward the active pointer (cursor OR head pose)
    if (pupilLRef.current && pupilRRef.current) {
      pupilLRef.current.position.x = sourceX * 0.025;
      pupilLRef.current.position.y = sourceY * 0.018;
      pupilRRef.current.position.x = sourceX * 0.025;
      pupilRRef.current.position.y = sourceY * 0.018;
    }

    // ---- LIP SYNC ----
    // Priority: explicit prop > TTS-driven amplitude (real lip-sync,
    // spiked on `boundary` events from voice.ts) > free-running
    // sinusoid (fallback for when speaking flag is true but no TTS
    // events are firing — e.g. user piped audio in elsewhere).
    let mouthTarget: number;
    if (mouthOpen !== undefined) {
      mouthTarget = Math.max(0.06, Math.min(1, mouthOpen));
    } else {
      const ttsAmp = getMouthAmplitude();
      if (ttsAmp > 0.02) {
        // Add a tiny per-frame jitter so the mouth doesn't lock — real
        // mouths flutter a bit between syllables.
        const jitter = 0.06 * Math.sin(t * 22);
        mouthTarget = 0.16 + ttsAmp * 0.65 + jitter;
      } else if (speaking) {
        const env = 0.35 + 0.5 * Math.abs(Math.sin(t * 16));
        const burst = Math.sin(t * 9) > 0.2 ? 1 : 0.5;
        mouthTarget = 0.18 + env * burst * 0.55;
      } else {
        mouthTarget = 0.12; // resting smile thickness
      }
    }
    if (smileRef.current) {
      const cur = smileRef.current.scale.y;
      smileRef.current.scale.y = cur * 0.6 + mouthTarget * 0.4;
    }

    // ---- ANTENNA + STATE GLOW ----
    const stateColor = speaking ? CYAN : listening ? BIO : CYAN_BRIGHT;
    const stateHex = new THREE.Color(stateColor).getHex();
    const pulse = listening || speaking ? 0.55 + Math.sin(t * (speaking ? 9 : 3.5)) * 0.3 : 0.4;
    for (const ref of [eyeLRef, eyeRRef, smileRef, antennaTipRef, cheekLRef, cheekRRef, visorRef]) {
      const m = ref.current?.material as THREE.MeshStandardMaterial | undefined;
      if (m) {
        m.emissive.setHex(stateHex);
        m.emissiveIntensity = m.emissiveIntensity * 0.85 + pulse * 0.15;
      }
    }
    // Antenna gentle bob
    if (antennaTipRef.current) {
      antennaTipRef.current.position.y = 0.78 + Math.sin(t * 2.2) * 0.02;
    }
  });

  return (
    <group ref={headRef}>
      {/* ============ HEAD — round white shell ============ */}
      <mesh>
        <sphereGeometry args={[0.6, 48, 48]} />
        <meshStandardMaterial color={SHELL} metalness={0.15} roughness={0.45} />
      </mesh>

      {/* Top crown plate (subtle) */}
      <mesh position={[0, 0.32, 0]} scale={[1, 0.7, 1]}>
        <sphereGeometry args={[0.55, 48, 32, 0, Math.PI * 2, 0, Math.PI * 0.4]} />
        <meshStandardMaterial color={SHELL_DEEP} metalness={0.3} roughness={0.4} />
      </mesh>

      {/* ============ ANTENNA ============ */}
      <mesh position={[0, 0.7, 0]}>
        <cylinderGeometry args={[0.02, 0.025, 0.18, 12]} />
        <meshStandardMaterial color={ACCENT} metalness={0.5} roughness={0.4} />
      </mesh>
      <mesh ref={antennaTipRef} position={[0, 0.78, 0]}>
        <sphereGeometry args={[0.055, 24, 24]} />
        <meshStandardMaterial color={CYAN_BRIGHT} emissive={CYAN_BRIGHT} emissiveIntensity={1} />
      </mesh>

      {/* ============ VISOR — single dark band that contains the eyes ============ */}
      <mesh ref={visorRef} position={[0, 0.04, 0.45]} scale={[1.05, 1, 0.4]}>
        <sphereGeometry args={[0.4, 48, 32, 0, Math.PI * 2, Math.PI * 0.32, Math.PI * 0.36]} />
        <meshStandardMaterial
          color={ACCENT}
          metalness={0.6}
          roughness={0.25}
          emissive={CYAN}
          emissiveIntensity={0.08}
        />
      </mesh>

      {/* ============ EYES — big glowing cyan ============ */}
      {/* Left eye */}
      <mesh ref={eyeLRef} position={[-0.18, 0.06, 0.55]}>
        <sphereGeometry args={[0.075, 32, 32]} />
        <meshStandardMaterial color={CYAN_BRIGHT} emissive={CYAN_BRIGHT} emissiveIntensity={1.2} />
      </mesh>
      <mesh ref={pupilLRef} position={[-0.18, 0.06, 0.62]}>
        <sphereGeometry args={[0.025, 16, 16]} />
        <meshStandardMaterial color="#0a1828" />
      </mesh>
      {/* Lid for blinking — overlays the eye */}
      <mesh ref={lidLRef} position={[-0.18, 0.06, 0.56]}>
        <sphereGeometry args={[0.083, 24, 24, 0, Math.PI * 2, 0, Math.PI * 0.5]} />
        <meshStandardMaterial color={ACCENT} metalness={0.6} roughness={0.25} />
      </mesh>

      {/* Right eye */}
      <mesh ref={eyeRRef} position={[0.18, 0.06, 0.55]}>
        <sphereGeometry args={[0.075, 32, 32]} />
        <meshStandardMaterial color={CYAN_BRIGHT} emissive={CYAN_BRIGHT} emissiveIntensity={1.2} />
      </mesh>
      <mesh ref={pupilRRef} position={[0.18, 0.06, 0.62]}>
        <sphereGeometry args={[0.025, 16, 16]} />
        <meshStandardMaterial color="#0a1828" />
      </mesh>
      <mesh ref={lidRRef} position={[0.18, 0.06, 0.56]}>
        <sphereGeometry args={[0.083, 24, 24, 0, Math.PI * 2, 0, Math.PI * 0.5]} />
        <meshStandardMaterial color={ACCENT} metalness={0.6} roughness={0.25} />
      </mesh>

      {/* ============ SMILE — curved cyan line that lip-syncs ============ */}
      {/* Friendly upturned smile (torus segment) */}
      <mesh
        ref={smileRef}
        position={[0, -0.2, 0.55]}
        rotation={[0, 0, Math.PI]}
        scale={[1, 0.12, 1]}
      >
        <torusGeometry args={[0.13, 0.022, 8, 32, Math.PI]} />
        <meshStandardMaterial color={CYAN} emissive={CYAN} emissiveIntensity={0.9} />
      </mesh>

      {/* ============ CHEEK DOTS — cute! ============ */}
      <mesh ref={cheekLRef} position={[-0.4, -0.08, 0.42]}>
        <sphereGeometry args={[0.04, 16, 16]} />
        <meshStandardMaterial
          color={CYAN}
          emissive={CYAN}
          emissiveIntensity={0.7}
          transparent
          opacity={0.85}
        />
      </mesh>
      <mesh ref={cheekRRef} position={[0.4, -0.08, 0.42]}>
        <sphereGeometry args={[0.04, 16, 16]} />
        <meshStandardMaterial
          color={CYAN}
          emissive={CYAN}
          emissiveIntensity={0.7}
          transparent
          opacity={0.85}
        />
      </mesh>

      {/* ============ EAR PADS (little side bumps) ============ */}
      <mesh position={[-0.55, 0.05, 0]} rotation={[0, -Math.PI / 2.5, 0]}>
        <sphereGeometry args={[0.12, 24, 24]} />
        <meshStandardMaterial color={SHELL_DEEP} metalness={0.3} roughness={0.4} />
      </mesh>
      <mesh position={[0.55, 0.05, 0]} rotation={[0, Math.PI / 2.5, 0]}>
        <sphereGeometry args={[0.12, 24, 24]} />
        <meshStandardMaterial color={SHELL_DEEP} metalness={0.3} roughness={0.4} />
      </mesh>

      {/* ============ NECK / BASE ============ */}
      <mesh position={[0, -0.55, 0]}>
        <cylinderGeometry args={[0.18, 0.22, 0.14, 24]} />
        <meshStandardMaterial color={ACCENT} metalness={0.55} roughness={0.4} />
      </mesh>
      <mesh position={[0, -0.49, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.2, 0.012, 8, 32]} />
        <meshStandardMaterial color={CYAN} emissive={CYAN} emissiveIntensity={0.5} />
      </mesh>
    </group>
  );
}
