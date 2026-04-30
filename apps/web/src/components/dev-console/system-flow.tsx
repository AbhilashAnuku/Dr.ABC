import { Card, PulseDot, cn } from '@dr-abc/ui';
import { motion } from 'framer-motion';
import { Activity, Boxes, Brain, Cloud, Cpu, Database, Loader2, Play, Wifi, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { API_BASE } from '../../lib/config.ts';

/**
 * SystemFlow — live system-architecture viewer for the dev console.
 *
 * Calls GET /health/full and renders every component (cloud LLM
 * providers · local containers · agent mesh · activity sink) as a
 * fixed-position SVG node. Edges between layers animate with traveler
 * dots when both endpoints are healthy.
 *
 * Shows exactly which container a request flows through next, with
 * each component's current health and latency.
 *
 * Three layers, top → bottom:
 *
 *   Cloud providers (Anthropic · NVIDIA · HuggingFace)
 *      │
 *      ▼
 *   Local containers (Ollama · py-svc · Postgres)
 *      │
 *      ▼
 *   Agent mesh (triage · diagnostic · 6 specialists · imaging · …)
 *      │
 *      ▼
 *   Frontend (web app)
 */

export type ComponentKind = 'provider' | 'container' | 'agent' | 'sink' | 'frontend';
export type ComponentStatus = 'ok' | 'down' | 'skipped';

export interface SystemComponent {
  component: string;
  kind: ComponentKind;
  status: ComponentStatus;
  latencyMs?: number;
  detail?: string;
}

export interface FullHealthResponse {
  ts: number;
  durationMs: number;
  summary: { total: number; ok: number; down: number; skipped: number };
  diagnosticBackend?: string;
  imagingBackend?: string;
  components: SystemComponent[];
}

const STATUS_TONE: Record<
  ComponentStatus,
  { ring: string; chip: string; dot: 'bio' | 'amber' | 'rose' }
> = {
  ok: { ring: 'border-bio-500/40', chip: 'bg-bio-500/15 text-bio-300', dot: 'bio' },
  skipped: { ring: 'border-amber-500/40', chip: 'bg-amber-500/15 text-amber-300', dot: 'amber' },
  down: { ring: 'border-rose-500/50', chip: 'bg-rose-500/15 text-rose-300', dot: 'rose' },
};

const KIND_ICON: Record<ComponentKind, typeof Cloud> = {
  provider: Cloud,
  container: Boxes,
  agent: Brain,
  sink: Database,
  frontend: Wifi,
};

export function partitionByKind(
  components: SystemComponent[],
): Record<ComponentKind, SystemComponent[]> {
  const out: Record<ComponentKind, SystemComponent[]> = {
    provider: [],
    container: [],
    agent: [],
    sink: [],
    frontend: [],
  };
  for (const c of components) out[c.kind].push(c);
  return out;
}

interface SystemFlowProps {
  /** Auto-poll interval in ms. 0 / undefined disables auto-polling. */
  pollMs?: number;
}

export function SystemFlow({ pollMs }: SystemFlowProps) {
  const [data, setData] = useState<FullHealthResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoPoll, setAutoPoll] = useState(false);

  const probe = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${API_BASE}/health/full`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const json = (await r.json()) as FullHealthResponse;
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'probe failed');
    } finally {
      setLoading(false);
    }
  }, []);

  // Run once on mount.
  useEffect(() => {
    void probe();
  }, [probe]);

  // Auto-poll when toggled on. Pauses while the tab is hidden so we
  // don't burn cloud-LLM credits or local CPU when the user isn't
  // looking at the dashboard.
  useEffect(() => {
    if (!autoPoll) return;
    const interval = pollMs ?? 8000;
    const tick = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      void probe();
    };
    const t = setInterval(tick, interval);
    return () => clearInterval(t);
  }, [autoPoll, pollMs, probe]);

  const layers = useMemo(() => (data ? partitionByKind(data.components) : null), [data]);

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.32em] text-quantum-300">
              <Activity className="h-3 w-3" /> · live system map
            </div>
            <h2 className="mt-1 font-display text-xl font-bold text-app-primary">
              How Mörbius is wired right now.
            </h2>
            {data && (
              <p className="mt-1 font-mono text-[11px] tabular-nums text-app-muted">
                {data.summary.ok} ok · {data.summary.skipped} skipped · {data.summary.down} down ·
                probe took {data.durationMs} ms · diagnostic{' '}
                <span className="text-app-secondary">{data.diagnosticBackend ?? 'offline'}</span> ·
                imaging{' '}
                <span className="text-app-secondary">{data.imagingBackend ?? 'offline'}</span>
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-app-subtle px-3 py-1 font-mono text-[10px] uppercase tracking-[0.22em] text-app-muted">
              <input
                type="checkbox"
                checked={autoPoll}
                onChange={(e) => setAutoPoll(e.target.checked)}
                className="accent-quantum-400"
              />
              auto-poll · {(pollMs ?? 8000) / 1000}s
            </label>
            <button
              type="button"
              onClick={() => void probe()}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-md border border-quantum-400/40 bg-quantum-500/15 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-quantum-200 transition hover:bg-quantum-500/25 disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Play className="h-3 w-3" />
              )}
              run live check
            </button>
          </div>
        </div>
      </Card>

      {error && (
        <Card className="border-rose-500/40 p-3">
          <div className="inline-flex items-center gap-2 font-mono text-[11px] text-rose-300">
            <X className="h-3.5 w-3.5" /> probe failed: {error}
          </div>
        </Card>
      )}

      {data && layers ? (
        <Card className="p-5">
          <FlowLayer
            label="cloud LLM providers"
            sublabel="anthropic · nvidia · huggingface"
            items={layers.provider}
          />
          <Connector active={layers.provider.some((c) => c.status === 'ok')} />
          <FlowLayer
            label="local containers"
            sublabel="ollama · py-svc · postgres"
            items={layers.container}
          />
          <Connector active={layers.container.some((c) => c.status === 'ok')} />
          <FlowLayer
            label="agent mesh"
            sublabel={`${layers.agent.length} agents online`}
            items={layers.agent}
          />
          <Connector active={layers.agent.length > 0} />
          <FlowLayer label="sinks" sublabel="activity log" items={layers.sink} />
        </Card>
      ) : (
        !error && (
          <Card className="flex items-center justify-center p-10 font-mono text-[11px] uppercase tracking-[0.22em] text-app-muted">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> probing…
          </Card>
        )
      )}
    </div>
  );
}

interface FlowLayerProps {
  label: string;
  sublabel: string;
  items: SystemComponent[];
}

function FlowLayer({ label, sublabel, items }: FlowLayerProps) {
  if (items.length === 0) {
    return (
      <div className="my-3 flex items-center gap-2 rounded-lg border border-dashed border-app-subtle px-3 py-2 font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
        {label} — none
      </div>
    );
  }
  return (
    <div className="my-3">
      <div className="mb-2 inline-flex items-baseline gap-2 font-mono text-[10px] uppercase tracking-[0.32em] text-app-faint">
        {label} <span className="text-app-muted">· {sublabel}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {items.map((c, i) => (
          <ComponentNode key={c.component} c={c} index={i} />
        ))}
      </div>
    </div>
  );
}

function ComponentNode({ c, index }: { c: SystemComponent; index: number }) {
  const tone = STATUS_TONE[c.status];
  const Icon = KIND_ICON[c.kind];
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.04 }}
      className={cn(
        'group flex flex-col gap-1.5 rounded-xl border bg-white/2 p-3 transition hover:bg-white/5',
        tone.ring,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 font-display text-sm font-semibold text-app-primary">
          <Icon className="h-3.5 w-3.5 text-app-faint" />
          {c.component}
        </span>
        <PulseDot active={c.status === 'ok'} size="xs" tone={tone.dot} />
      </div>
      <div className="flex items-center justify-between gap-2">
        <span
          className={cn(
            'rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.22em]',
            tone.chip,
          )}
        >
          {c.status}
        </span>
        {typeof c.latencyMs === 'number' && (
          <span className="font-mono text-[10px] tabular-nums text-app-faint">{c.latencyMs}ms</span>
        )}
      </div>
      {c.detail && <p className="line-clamp-2 font-mono text-[10px] text-app-muted">{c.detail}</p>}
    </motion.div>
  );
}

function Connector({ active }: { active: boolean }) {
  // Animated traveler dots when the layer above is healthy. SVG-only,
  // no Three.js, sub-millisecond render.
  return (
    <div className="my-2 flex h-8 items-center justify-center">
      <svg
        width="100%"
        height="32"
        viewBox="0 0 200 32"
        preserveAspectRatio="none"
        className="opacity-90"
        role="img"
        aria-label={active ? 'data flowing between layers' : 'inactive connection'}
      >
        <title>{active ? 'data flowing between layers' : 'inactive connection'}</title>
        <line
          x1="100"
          y1="0"
          x2="100"
          y2="32"
          stroke="currentColor"
          strokeWidth="1"
          strokeDasharray={active ? '4 4' : '2 6'}
          className={active ? 'text-bio-500/60' : 'text-app-faint'}
        />
        {active && (
          <circle r="3" fill="currentColor" className="text-bio-400">
            <animateMotion dur="1.6s" repeatCount="indefinite" path="M 100 0 L 100 32" />
          </circle>
        )}
      </svg>
    </div>
  );
}

export const __test = { partitionByKind, STATUS_TONE };
