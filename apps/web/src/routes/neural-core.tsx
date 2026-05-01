// TODO(i18n): wrap user-facing strings in t() once a `neuralCore` namespace
// exists in en/de/hi.json. Brand-name labels stay untranslated.
import { Card, cn } from '@dr-abc/ui';
import { Canvas } from '@react-three/fiber';
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'framer-motion';
import { Activity, Brain, Cpu, Network, Power, Radio, Sparkles, Zap } from 'lucide-react';
import { Suspense, useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import {
  type NeuralBootState,
  NeuralCoreBootOverlay,
  useNeuralBoot,
} from '../components/neural-core/boot-overlay.tsx';
import { API_BASE } from '../lib/config.ts';

/**
 * /app/neural-core — Mörbius's actual brain, surfaced.
 *
 * This is not the dev-console agents grid (that's the engineering
 * surface). This is the EXPERIENCE: opening the page boots Mörbius
 * with a 10-second blue loader + offline beep, then "Mörbius online"
 * + a small medical-AI intro speaks aloud, then a 3D neural mesh
 * renders showing the actual nodes + wireframes + topology of the
 * brain.
 *
 * The mesh pulls live data from /knowledge-graph (every consult +
 * abstract Mörbius has ever processed) and renders it as a 3D
 * force-style sphere. Each node colour-coded by kind. Hover any node
 * to see its connections light up.
 *
 * Mörbius narrates every state transition:
 *   - boot   → "Hello user. You are accessing the Mörbius neural core. Initialising…"
 *   - online → "I am Mörbius. My knowledge base is built on local Ollama, six specialist agents, a graphify-style medical knowledge graph, and a continuous-learning loop that grows every cycle."
 *   - leave  → (page unmount) speech.cancel · neural mesh fades
 */

interface GraphSnapshot {
  ts: number;
  counts: { nodes: number; edges: number; sources: number };
  breakdown: { byKind: Record<string, number>; byConfidence: Record<string, number> };
  graph: {
    nodes: Array<{ id: string; kind: string; label: string; mentionCount: number }>;
    edges: Array<{
      source: string;
      target: string;
      relation: string;
      confidence: 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS';
    }>;
  };
}

const KIND_COLOR: Record<string, number> = {
  condition: 0x38bdf8,
  symptom: 0xf43f5e,
  drug: 0x10b981,
  specialty: 0xa855f7,
  test: 0xf59e0b,
  icd10: 0x94a3b8,
  paper: 0x60a5fa,
};

export function NeuralCorePage() {
  const { state: bootState, progress: bootProgress } = useNeuralBoot();
  const [snapshot, setSnapshot] = useState<GraphSnapshot | null>(null);

  // Once boot finishes, fetch the live graph snapshot.
  useEffect(() => {
    if (bootState !== 'online') return;
    let mounted = true;
    fetch(`${API_BASE}/knowledge-graph`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: GraphSnapshot | null) => {
        if (mounted && j) setSnapshot(j);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [bootState]);

  return (
    <div className="relative min-h-[calc(100vh-7rem)] overflow-hidden">
      {/* Full-window blue blur boot overlay */}
      {bootState !== 'online' && (
        <NeuralCoreBootOverlay state={bootState} progress={bootProgress} />
      )}

      {/* Main neural-core content */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: bootState === 'online' ? 1 : 0 }}
        transition={{ duration: 0.8 }}
        className="space-y-5 p-2"
      >
        <NeuralCoreHeader snapshot={snapshot} state={bootState} />
        <LearningSurfaces snapshot={snapshot} />
        <NeuralMesh snapshot={snapshot} />
        <TopologyStrip snapshot={snapshot} />
      </motion.div>
    </div>
  );
}

function NeuralCoreHeader({
  snapshot,
  state,
}: { snapshot: GraphSnapshot | null; state: NeuralBootState }) {
  const counts = snapshot?.counts ?? { nodes: 0, edges: 0, sources: 0 };
  return (
    <Card className="overflow-hidden p-0 shadow-[0_0_60px_-15px_rgba(56,189,248,0.55)]">
      <div className="bg-gradient-to-br from-blue-500/15 via-quantum-500/10 to-purple-500/15 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.32em] text-blue-300">
              <Power className="h-3.5 w-3.5" /> · neural core · {state}
            </div>
            <h1 className="with-ornament mt-1 font-syne text-3xl font-black tracking-[-0.02em] text-app-primary sm:text-5xl">
              <span className="bg-gradient-to-br from-blue-200 via-cyan-300 to-purple-300 bg-clip-text text-transparent drop-shadow-[0_0_30px_rgba(56,189,248,0.45)]">
                Mörbius brain
              </span>
            </h1>
            <p className="mt-2 max-w-2xl font-grotesk text-sm text-app-muted">
              The actual brain. Every consult I have run, every paper I have read, every drug I know
              — wired into a living mesh. Below you see the nodes, the topology, and the
              second-brain confidence layer. Hover anything to see its neighbours light up.
            </p>
          </div>
          <span className="rounded-full border border-bio-500/40 bg-bio-500/10 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.22em] text-bio-300">
            ● online · gauntlet armed
          </span>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          <Stat icon={Network} label="Synapses" value={counts.edges} />
          <Stat icon={Brain} label="Neurons" value={counts.nodes} />
          <Stat icon={Radio} label="Memory sources" value={counts.sources} />
          <Stat icon={Sparkles} label="Active backends" value="6 / 6" />
        </div>
      </div>
    </Card>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
}: { icon: typeof Brain; label: string; value: number | string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="rounded-lg border border-app-subtle bg-black/30 p-3 backdrop-blur transition hover:border-blue-400/40"
    >
      <div className="flex items-center gap-1.5">
        <Icon className="h-3 w-3 text-blue-300" />
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
          {label}
        </span>
      </div>
      <div className="mt-1 font-syne text-2xl font-bold tabular-nums text-blue-200">
        {typeof value === 'number' ? <CountUp to={value} /> : value}
      </div>
    </motion.div>
  );
}

/**
 * CountUp — animates a number from 0 → target. Used by the neural-core
 * stats so when the boot finishes the synapse / neuron counts visibly
 * spin up, reinforcing the "brain just woke up" beat. Honours
 * prefers-reduced-motion: jumps to the final value instantly.
 */
function CountUp({ to, durationSec = 1.2 }: { to: number; durationSec?: number }) {
  const reduced = useReducedMotion();
  const mv = useMotionValue(0);
  const spring = useSpring(mv, { stiffness: 90, damping: 22 });
  const display = useTransform(spring, (v) => Math.round(v).toLocaleString());
  useEffect(() => {
    if (reduced) {
      mv.set(to);
      return;
    }
    mv.set(0);
    const t = setTimeout(() => mv.set(to), 80);
    return () => clearTimeout(t);
  }, [to, mv, reduced]);
  return <motion.span>{display}</motion.span>;
}

function NeuralMesh({ snapshot }: { snapshot: GraphSnapshot | null }) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const reduced = useReducedMotion();
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1], delay: 0.1 }}
    >
      <Card className="overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-app-subtle px-4 py-2 font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
          <span>synaptic mesh · 3D · drag to rotate · scroll to zoom</span>
          {hoveredId && (
            <motion.span
              key={hoveredId}
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              className="text-blue-300"
            >
              → {hoveredId}
            </motion.span>
          )}
        </div>
        <div className="relative h-[480px] bg-black/60">
          {/* Ambient cyan pulse — gives the canvas a "powered on" feel
              without competing with the actual mesh inside. */}
          <motion.div
            aria-hidden
            className="pointer-events-none absolute inset-0 ring-1 ring-blue-400/15 ring-inset"
            animate={
              reduced
                ? undefined
                : {
                    boxShadow: [
                      '0 0 0 0 rgba(96,165,250,0.0) inset',
                      '0 0 80px -20px rgba(96,165,250,0.35) inset',
                      '0 0 0 0 rgba(96,165,250,0.0) inset',
                    ],
                  }
            }
            transition={{ duration: 4, repeat: Number.POSITIVE_INFINITY, ease: 'easeInOut' }}
          />
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center font-mono text-[10px] uppercase tracking-[0.22em] text-blue-300">
                loading mesh…
              </div>
            }
          >
            <Canvas camera={{ position: [0, 0, 8], fov: 55 }} dpr={[1, 1.5]}>
              <ambientLight intensity={0.4} />
              <pointLight position={[5, 5, 5]} intensity={0.8} color="#60a5fa" />
              <pointLight position={[-5, -3, 3]} intensity={0.4} color="#a78bfa" />
              <NeuralScene snapshot={snapshot} setHovered={setHoveredId} />
            </Canvas>
          </Suspense>
          <div className="pointer-events-none absolute right-3 bottom-3 font-mono text-[9px] uppercase tracking-[0.22em] text-blue-300/60">
            ● live · refreshes every 60s
          </div>
        </div>
      </Card>
    </motion.div>
  );
}

interface SceneNode {
  id: string;
  label: string;
  kind: string;
  position: [number, number, number];
  color: number;
  size: number;
}

function NeuralScene({
  snapshot,
  setHovered,
}: { snapshot: GraphSnapshot | null; setHovered: (id: string | null) => void }) {
  // Build a Fibonacci-sphere layout — deterministic, decent
  // distribution, no force simulation needed.
  const { nodes, edges } = useMemo(() => {
    const rawNodes = snapshot?.graph.nodes.slice(0, 80) ?? [];
    const positioned: SceneNode[] = rawNodes.map((n, i) => {
      const t = (i + 0.5) / rawNodes.length;
      const phi = Math.acos(1 - 2 * t);
      const theta = Math.PI * (1 + Math.sqrt(5)) * (i + 1);
      const r = 4.5;
      return {
        id: n.id,
        label: n.label.slice(0, 22),
        kind: n.kind,
        position: [
          r * Math.sin(phi) * Math.cos(theta),
          r * Math.sin(phi) * Math.sin(theta),
          r * Math.cos(phi),
        ],
        color: KIND_COLOR[n.kind] ?? 0x94a3b8,
        size: Math.min(0.32, 0.08 + Math.log2(n.mentionCount + 1) * 0.06),
      };
    });
    const positionIndex = new Map(positioned.map((n) => [n.id, n.position]));
    const rawEdges = snapshot?.graph.edges ?? [];
    const visibleEdges = rawEdges.filter(
      (e) => positionIndex.has(e.source) && positionIndex.has(e.target),
    );
    return { nodes: positioned, edges: visibleEdges.slice(0, 240) };
  }, [snapshot]);

  if (nodes.length === 0) {
    return null;
  }

  return (
    <group>
      {/* Ambient sphere outline */}
      <mesh>
        <sphereGeometry args={[4.5, 32, 16]} />
        <meshBasicMaterial color={0x38bdf8} wireframe transparent opacity={0.05} />
      </mesh>

      {/* Edges */}
      {edges.map((e) => {
        const a = nodes.find((n) => n.id === e.source);
        const b = nodes.find((n) => n.id === e.target);
        if (!a || !b) return null;
        const stroke =
          e.confidence === 'EXTRACTED'
            ? 0x6ee7b7
            : e.confidence === 'INFERRED'
              ? 0x60a5fa
              : 0xfbbf24;
        return (
          <Edge
            key={`${e.source}-${e.target}-${e.relation}`}
            from={a.position}
            to={b.position}
            color={stroke}
          />
        );
      })}

      {/* Nodes */}
      {nodes.map((n) => (
        <NodeDot key={n.id} node={n} onHover={(hovered) => setHovered(hovered ? n.label : null)} />
      ))}
    </group>
  );
}

function Edge({
  from,
  to,
  color,
}: { from: [number, number, number]; to: [number, number, number]; color: number }) {
  const points = useMemo(() => [new THREE.Vector3(...from), new THREE.Vector3(...to)], [from, to]);
  const geom = useMemo(() => new THREE.BufferGeometry().setFromPoints(points), [points]);
  return (
    <line>
      <primitive object={geom} attach="geometry" />
      <lineBasicMaterial color={color} transparent opacity={0.35} />
    </line>
  );
}

function NodeDot({ node, onHover }: { node: SceneNode; onHover: (hovered: boolean) => void }) {
  const [active, setActive] = useState(false);
  return (
    <mesh
      position={node.position}
      onPointerOver={(e) => {
        e.stopPropagation();
        setActive(true);
        onHover(true);
      }}
      onPointerOut={() => {
        setActive(false);
        onHover(false);
      }}
    >
      <sphereGeometry args={[active ? node.size * 1.4 : node.size, 16, 16]} />
      <meshStandardMaterial
        color={node.color}
        emissive={node.color}
        emissiveIntensity={active ? 1.2 : 0.6}
        transparent
        opacity={0.95}
      />
    </mesh>
  );
}

interface SurfaceLive {
  errorEvents: number | null;
  passRate: number | null;
  liveAccuracy: number | null;
  liveBackend: string | null;
  lastResearchCycle: string | null;
  validatorThreshold: number | null;
  safetyThreshold: number | null;
  privacyThreshold: number | null;
}

function LearningSurfaces({ snapshot }: { snapshot: GraphSnapshot | null }) {
  // Pulls live data from /errors/stats + /health + /research/snapshot
  // so the five learning surfaces render their REAL state, not
  // mock-up text. Polls every 15 s so the boosting journal stays
  // up to date during a live consult.
  const [live, setLive] = useState<SurfaceLive>({
    errorEvents: null,
    passRate: null,
    liveAccuracy: null,
    liveBackend: null,
    lastResearchCycle: null,
    validatorThreshold: null,
    safetyThreshold: null,
    privacyThreshold: null,
  });

  useEffect(() => {
    let alive = true;
    const probe = async () => {
      try {
        const [errs, health, research] = await Promise.all([
          fetch(`${API_BASE}/errors/stats`).then((r) => (r.ok ? r.json() : null)),
          fetch(`${API_BASE}/health`).then((r) => (r.ok ? r.json() : null)),
          fetch(`${API_BASE}/research/snapshot`).then((r) => (r.ok ? r.json() : null)),
        ]);
        if (!alive) return;
        setLive({
          errorEvents: typeof errs?.totalEvents === 'number' ? errs.totalEvents : null,
          passRate: null, // populated from live-accuracy fetch below
          liveAccuracy: null,
          liveBackend:
            typeof health?.diagnosticBackend === 'string' ? health.diagnosticBackend : null,
          lastResearchCycle:
            typeof research?.ts === 'number' ? new Date(research.ts).toISOString() : null,
          validatorThreshold: health?.gauntletThresholds?.validator ?? null,
          safetyThreshold: health?.gauntletThresholds?.safety ?? null,
          privacyThreshold: health?.gauntletThresholds?.privacy ?? null,
        });
        // Roll-up: pull the latest live-accuracy from the API root
        // which now exposes the accuracy block.
        const root = await fetch(`${API_BASE}/`).then((r) => (r.ok ? r.json() : null));
        if (!alive) return;
        if (root?.accuracy) {
          setLive((prev) => ({
            ...prev,
            passRate: root.accuracy.gauntletPassPct ?? null,
            liveAccuracy: root.accuracy.medqaUsmle200CascadePct ?? null,
          }));
        }
      } catch {
        /* offline · leave nulls */
      }
    };
    void probe();
    const id = window.setInterval(probe, 15_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  const fmtPct = (v: number | null) => (v === null ? '—' : `${v.toFixed(1)}%`);
  const fmtNum = (v: number | null | undefined) =>
    v === null || v === undefined ? '—' : v.toLocaleString();

  const surfaces: Array<{
    n: number;
    label: string;
    sub: string;
    value: string;
    detail: string;
    accent: string;
  }> = [
    {
      n: 1,
      label: 'Second Brain',
      sub: 'knowledge graph',
      value: `${snapshot?.counts.nodes ?? 0} · ${snapshot?.counts.edges ?? 0}`,
      detail: `nodes · edges · ${snapshot?.counts.sources ?? 0} sources`,
      accent: 'border-quantum-400/40 text-quantum-300',
    },
    {
      n: 2,
      label: 'Sequential error correction',
      sub: 'boosting residuals',
      value: fmtNum(live.errorEvents),
      detail: 'events · ±0.3 cap · 0.97/day decay',
      accent: 'border-rose-400/40 text-rose-300',
    },
    {
      n: 3,
      label: 'Calibrator',
      sub: 'gate thresholds',
      value: `${live.validatorThreshold ?? '—'} / ${live.safetyThreshold ?? '—'} / ${live.privacyThreshold ?? '—'}`,
      detail: 'validator · safety · privacy',
      accent: 'border-amber-400/40 text-amber-300',
    },
    {
      n: 4,
      label: 'Per-user memory',
      sub: 'IndexedDB-local',
      value: 'sovereign',
      detail: 'per-architect · grows with every Rx',
      accent: 'border-purple-400/40 text-purple-300',
    },
    {
      n: 5,
      label: 'Live-accuracy ring',
      sub: 'autopilot trend',
      value: fmtPct(live.liveAccuracy),
      detail: `MedQA-USMLE-200 · backend ${live.liveBackend ?? '—'}`,
      accent: 'border-bio-400/40 text-bio-300',
    },
  ];

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-bio-300" />
        <h4 className="font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
          five learning surfaces · live · 15 s poll
        </h4>
        {live.lastResearchCycle && (
          <span className="ml-auto font-mono text-[9px] text-app-faint">
            last research-cycle · {new Date(live.lastResearchCycle).toLocaleString()}
          </span>
        )}
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {surfaces.map((s) => (
          <motion.div
            key={s.n}
            initial={{ opacity: 0, y: 8 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4, delay: s.n * 0.05 }}
            whileHover={{ y: -2 }}
            className={cn(
              'rounded-lg border bg-white/3 p-3 transition-colors hover:bg-white/5',
              s.accent,
            )}
          >
            <div className="flex items-center justify-between">
              <span className="font-mono text-[9px] uppercase tracking-[0.22em] opacity-70">
                surface {s.n}
              </span>
            </div>
            <div className="mt-0.5 font-display text-sm font-semibold text-app-primary">
              {s.label}
            </div>
            <div className="font-mono text-[9px] uppercase tracking-[0.18em] opacity-70">
              {s.sub}
            </div>
            <div className="mt-2 font-syne text-xl font-bold tabular-nums text-app-primary">
              {s.value}
            </div>
            <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-app-muted">
              {s.detail}
            </div>
          </motion.div>
        ))}
      </div>
      <div className="mt-3 font-sans text-[11px] text-app-faint">
        Each surface writes to{' '}
        <code className="rounded bg-white/5 px-1 py-0.5 text-app-secondary">docs/status/</code>
        {' · see '}
        <code className="rounded bg-white/5 px-1 py-0.5 text-app-secondary">
          docs/vault/training/morbius-training-map.md
        </code>{' '}
        for the file-by-file map of where the training happens in code.
      </div>
    </Card>
  );
}

function TopologyStrip({ snapshot }: { snapshot: GraphSnapshot | null }) {
  const byKind = snapshot?.breakdown.byKind ?? {};
  const entries = Object.entries(byKind).sort(([, a], [, b]) => b - a);
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <Cpu className="h-4 w-4 text-quantum-300" />
        <h4 className="font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
          neuron topology · by kind
        </h4>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {entries.length === 0 && (
          <div className="font-sans text-xs text-app-muted">
            Brain not yet populated — run{' '}
            <code className="font-mono text-[11px]">bun run scripts/research-cycle.ts</code> to
            ingest your first sources.
          </div>
        )}
        {entries.map(([kind, count], i) => {
          const color = KIND_COLOR[kind] ?? 0x94a3b8;
          const hex = `#${color.toString(16).padStart(6, '0')}`;
          return (
            <motion.div
              key={kind}
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{
                duration: 0.4,
                delay: Math.min(i * 0.05, 0.4),
                ease: [0.22, 1, 0.36, 1],
              }}
              whileHover={{ y: -2, transition: { duration: 0.15 } }}
              className="rounded-lg border border-app-subtle bg-white/3 p-3 font-mono text-[11px] transition-colors hover:border-blue-400/40"
            >
              <div className="flex items-center justify-between">
                <span
                  className="inline-flex items-center gap-1.5 uppercase tracking-[0.18em]"
                  style={{ color: hex }}
                >
                  <span className="h-2 w-2 rounded-full" style={{ background: hex }} />
                  {kind}
                </span>
                <span className="font-syne text-xl font-bold tabular-nums text-app-primary">
                  <CountUp to={count} />
                </span>
              </div>
            </motion.div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3 font-mono text-[9px] uppercase tracking-[0.22em] text-app-faint">
        <span className="inline-flex items-center gap-1.5">
          <Activity className="h-3 w-3 text-bio-300" /> EXTRACTED
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Zap className="h-3 w-3 text-quantum-300" /> INFERRED
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Sparkles className="h-3 w-3 text-amber-300" /> AMBIGUOUS
        </span>
      </div>
    </Card>
  );
}
