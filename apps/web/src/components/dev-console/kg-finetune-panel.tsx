// KG fine-tune panel — accuracy-sentinel training-cycle viewport.
//
// Live SVG charts (no chart-library dep · keeps the bundle tight):
//   - Cycle counter + last-run timestamp
//   - Per-cycle absolute-shift line (proxy for "how much the graph moved")
//   - Bar chart of top strengthened + weakened edges in the most recent cycle
//   - Red-flag-guarded count + decay count
//   - "Run cycle now" button (developer-gated, calls POST /kg/finetune/run)
//
// Reads GET /kg/finetune/history every 30 seconds. The shape comes from
// packages/agents/src/knowledge-graph/finetune.ts · FineTuneCycleResult.

import { Card } from '@dr-abc/ui';
import { Play, TrendingDown, TrendingUp, Zap } from 'lucide-react';
import { useEffect, useState } from 'react';
import { API_BASE } from '../../lib/config.ts';

interface EdgeChange {
  edgeId: string;
  sourceLabel: string;
  targetLabel: string;
  relation: string;
  oldWeight: number;
  newWeight: number;
  delta: number;
}

interface CycleEntry {
  cycleSeq: number;
  ranAt: string;
  signalsConsumed: number;
  edgesUpdated: number;
  topStrengthened: EdgeChange[];
  topWeakened: EdgeChange[];
  redFlagsGuarded: number;
  decayedEdges: number;
  totalAbsoluteShift: number;
  sourceSnapshot?: string;
}

const TICK_MS = 30_000;

function fmtTimeAgo(iso: string | null): string {
  if (!iso) return '---';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '---';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

function fmtNum(n: number, d = 3): string {
  return n.toFixed(d);
}

// --- shift-line sparkline -------------------------------------------------

function ShiftSparkline({ values }: { values: number[] }) {
  if (values.length === 0) {
    return (
      <div className="flex h-20 items-center justify-center font-mono text-[11px] text-app-muted">
        no cycles yet
      </div>
    );
  }
  const max = Math.max(0.0001, ...values);
  const W = 320;
  const H = 80;
  const stepX = values.length > 1 ? W / (values.length - 1) : 0;
  const points = values.map((v, i) => `${i * stepX},${H - (v / max) * (H - 6) - 3}`).join(' ');
  const last = values[values.length - 1] ?? 0;
  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-20 w-full"
        aria-label="cycle-shift sparkline"
      >
        <title>cycle absolute-shift over time</title>
        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          className="text-bio-400"
          strokeWidth={1.5}
        />
        {values.map((v, i) => {
          const cx = i * stepX;
          const cy = H - (v / max) * (H - 6) - 3;
          return (
            <circle
              key={`pt-${i}-${v.toFixed(4)}`}
              cx={cx}
              cy={cy}
              r={1.6}
              className="fill-bio-400"
            />
          );
        })}
      </svg>
      <div className="pointer-events-none absolute right-1 top-1 font-mono text-[10px] text-app-muted">
        last {fmtNum(last)}
      </div>
    </div>
  );
}

// --- edge-delta bar chart ------------------------------------------------

function EdgeBars({ items, sign }: { items: EdgeChange[]; sign: 'pos' | 'neg' }) {
  if (items.length === 0) {
    return (
      <p className="font-mono text-[11px] text-app-muted">
        {sign === 'pos' ? '(no strengthened edges this cycle)' : '(no weakened edges this cycle)'}
      </p>
    );
  }
  const max = Math.max(...items.map((c) => Math.abs(c.delta)));
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((c) => {
        const w = (Math.abs(c.delta) / max) * 100;
        return (
          <li key={c.edgeId} className="flex flex-col gap-0.5">
            <div className="flex items-center justify-between font-mono text-[10px]">
              <span className="truncate text-app-primary">
                {c.sourceLabel.slice(0, 28)}{' '}
                <span className="text-app-muted">--{c.relation}--&gt;</span>{' '}
                {c.targetLabel.slice(0, 22)}
              </span>
              <span
                className={sign === 'pos' ? 'font-bold text-bio-300' : 'font-bold text-rose-300'}
              >
                {c.delta > 0 ? '+' : ''}
                {fmtNum(c.delta)}
              </span>
            </div>
            <div className="h-1.5 w-full rounded bg-app-surface-strong">
              <div
                className={
                  sign === 'pos' ? 'h-full rounded bg-bio-500/70' : 'h-full rounded bg-rose-500/70'
                }
                style={{ width: `${w}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// --- main component -------------------------------------------------------

export function KgFinetunePanel() {
  const [cycles, setCycles] = useState<CycleEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRunOutput, setLastRunOutput] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const fetchHistory = async () => {
      try {
        const r = await fetch(`${API_BASE}/kg/finetune/history`);
        if (!r.ok) return;
        const j = (await r.json()) as { cycles?: CycleEntry[] };
        if (alive) setCycles(j.cycles ?? []);
      } catch {
        /* swallow */
      }
    };
    fetchHistory();
    const id = window.setInterval(fetchHistory, TICK_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  const runNow = async () => {
    setBusy(true);
    setError(null);
    setLastRunOutput(null);
    try {
      const r = await fetch(`${API_BASE}/kg/finetune/run`, {
        method: 'POST',
        headers: { 'X-Dr-Abc-Role': 'developer' },
      });
      const j = (await r.json()) as {
        ok?: boolean;
        exitCode?: number;
        stdout?: string;
        stderr?: string;
        error?: string;
      };
      if (j.error) setError(j.error);
      else setLastRunOutput(j.stdout ?? '');
      // re-fetch the history so the new cycle appears.
      const h = await fetch(`${API_BASE}/kg/finetune/history`);
      if (h.ok) {
        const hj = (await h.json()) as { cycles?: CycleEntry[] };
        setCycles(hj.cycles ?? []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const latest = cycles[cycles.length - 1] ?? null;
  const shiftSeries = cycles.slice(-32).map((c) => c.totalAbsoluteShift ?? 0);

  return (
    <Card className="flex flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-quantum-300" aria-hidden="true" />
          <h3 className="font-mono text-[12px] uppercase tracking-[0.18em] text-app-primary">
            KG fine-tune cycle
          </h3>
        </div>
        <button
          type="button"
          onClick={() => void runNow()}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-full border border-quantum-400/40 bg-quantum-500/15 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.16em] text-quantum-200 transition hover:border-quantum-400/70 hover:bg-quantum-500/25 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Play className="h-3 w-3" aria-hidden="true" />
          {busy ? 'running…' : 'run cycle'}
        </button>
      </header>

      <div className="grid grid-cols-2 gap-3 font-mono text-[11px] sm:grid-cols-4">
        <Stat label="cycles" value={cycles.length.toString()} />
        <Stat label="last run" value={fmtTimeAgo(latest?.ranAt ?? null)} />
        <Stat label="signals consumed" value={latest ? latest.signalsConsumed.toString() : '---'} />
        <Stat label="edges updated" value={latest ? latest.edgesUpdated.toString() : '---'} />
      </div>

      <div className="flex flex-col gap-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-app-muted">
          absolute-shift per cycle (last 32)
        </p>
        <ShiftSparkline values={shiftSeries} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <p className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.16em] text-bio-300">
            <TrendingUp className="h-3 w-3" aria-hidden="true" /> top strengthened
          </p>
          <EdgeBars items={latest?.topStrengthened ?? []} sign="pos" />
        </div>
        <div className="flex flex-col gap-2">
          <p className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.16em] text-rose-300">
            <TrendingDown className="h-3 w-3" aria-hidden="true" /> top weakened
          </p>
          <EdgeBars items={latest?.topWeakened ?? []} sign="neg" />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 font-mono text-[10px] uppercase tracking-[0.14em] text-app-muted">
        <span>
          red-flags guarded:{' '}
          <span className="text-amber-300">{latest?.redFlagsGuarded ?? '---'}</span>
        </span>
        <span>
          decayed edges: <span className="text-app-primary">{latest?.decayedEdges ?? '---'}</span>
        </span>
        <span>
          source: <span className="text-app-primary">{latest?.sourceSnapshot ?? '---'}</span>
        </span>
      </div>

      {error && (
        <p className="rounded border border-rose-400/40 bg-rose-500/10 p-2 font-mono text-[11px] text-rose-200">
          {error}
        </p>
      )}
      {lastRunOutput && (
        <details className="rounded border border-app-subtle bg-app-surface-strong/40 p-2">
          <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-[0.14em] text-app-muted">
            last-run console output
          </summary>
          <pre className="mt-2 overflow-auto whitespace-pre-wrap font-mono text-[10px] leading-relaxed text-app-primary">
            {lastRunOutput}
          </pre>
        </details>
      )}

      <p className="font-sans text-[10px] leading-relaxed text-app-muted">
        Each cycle reads the latest accuracy snapshot, maps every case to a gradient signal (patient
        text + predicted vs truth + validator verdict), and updates KG edge weights via bounded
        gradient descent. Per-edge cap ±0.30, weights clamped to [0.10, 1.50], red-flag targets are
        never damped. Un-touched edges drift toward 1.0 at α = 0.005 per cycle.
      </p>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-[0.16em] text-app-muted">{label}</span>
      <span className="font-mono text-[14px] tabular-nums text-app-primary">{value}</span>
    </div>
  );
}
