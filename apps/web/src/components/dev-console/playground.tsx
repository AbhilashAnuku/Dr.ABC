// dev-console / playground — TensorFlow-Playground-style analyser for
// the three things that make Mörbius: the knowledge graph, the
// boosting (memory) journal, and the daily learning trail.
//
// Three live tools in one panel:
//
//   1. KG ACTIVATION    Type a complaint → POST /knowledge-graph/activate.
//                       See the seed nodes, the spreading-activation top-K,
//                       hop count, and the rendered evidence block that
//                       would be prepended to the LLM prompt.
//
//   2. RESIDUAL LOOKUP  Type a (complaint × predicted condition) pair
//                       and a probability vector → POST /errors/boost.
//                       See the gradient-boosting residuals fire on a
//                       differential, with deltas per candidate.
//
//   3. LEARNING TRAIL   Read /reports — sparkline of KG node growth,
//                       MedQA accuracy progression, boosting events
//                       per day. The "is the brain actually growing"
//                       evidence, presented at a glance.

import { Card, cn } from '@dr-abc/ui';
import {
  ArrowDown,
  ArrowUp,
  Brain,
  Cpu,
  FlaskConical,
  Network,
  Play,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { API_BASE } from '../../lib/config.ts';

type Tool = 'activation' | 'residual' | 'trail';

export function DevConsolePlayground() {
  const [tool, setTool] = useState<Tool>('activation');
  return (
    <div className="space-y-4 p-3">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.32em] text-quantum-300">
            <FlaskConical className="h-3 w-3" /> · playground · TF-style brain analyser
          </div>
          <h3 className="mt-1 font-display text-lg font-bold text-app-primary">
            Probe the brain. See what it knows.
          </h3>
          <p className="mt-1 max-w-3xl font-sans text-xs text-app-muted">
            Three live tools sitting on top of the same endpoints the runtime uses. Type a complaint
            and watch the knowledge-graph fire. Pretend a diagnosis was wrong and watch the
            gradient-boosting residual shape the next prediction. Scrub the daily learning trail and
            confirm the brain is genuinely growing.
          </p>
        </div>
      </div>

      <Card className="p-1">
        <div className="flex items-center gap-1">
          {(
            [
              { id: 'activation', label: 'Second Brain activation', icon: Network },
              { id: 'residual', label: 'Residual lookup', icon: Sparkles },
              { id: 'trail', label: 'Learning trail', icon: TrendingUp },
            ] as const
          ).map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTool(t.id)}
                className={cn(
                  'inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 font-mono text-[11px] uppercase tracking-[0.22em] transition',
                  tool === t.id
                    ? 'bg-quantum-500/20 text-quantum-200'
                    : 'text-app-muted hover:bg-white/5 hover:text-app-primary',
                )}
              >
                <Icon className="h-3.5 w-3.5" /> {t.label}
              </button>
            );
          })}
        </div>
      </Card>

      {tool === 'activation' && <ActivationProbe />}
      {tool === 'residual' && <ResidualProbe />}
      {tool === 'trail' && <LearningTrail />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
//  1. KG activation — what does the brain actually surface?
// ─────────────────────────────────────────────────────────────────

interface ActivationResp {
  query: string;
  empty: boolean;
  lines: string[];
  hopsUsed: number;
  activated: Array<{ id: string; label: string; kind: string; activation: number }>;
}

const KIND_TONE: Record<string, string> = {
  condition: 'border-bio-400/40 bg-bio-500/10 text-bio-200',
  symptom: 'border-rose-400/40 bg-rose-500/10 text-rose-200',
  drug: 'border-purple-400/40 bg-purple-500/10 text-purple-200',
  specialty: 'border-quantum-400/40 bg-quantum-500/10 text-quantum-200',
  test: 'border-amber-400/40 bg-amber-500/10 text-amber-200',
  icd10: 'border-app-subtle bg-white/5 text-app-secondary',
  paper: 'border-blue-400/40 bg-blue-500/10 text-blue-200',
};

function ActivationProbe() {
  const [query, setQuery] = useState('crushing chest pain radiating to left arm');
  const [topK, setTopK] = useState(8);
  const [decay, setDecay] = useState(0.6);
  const [maxHops, setMaxHops] = useState(3);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ActivationResp | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!query.trim()) return;
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/knowledge-graph/activate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: query.trim(), topK, decay, maxHops }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setResult((await res.json()) as ActivationResp);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'request failed');
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card className="space-y-4 p-4">
      <div>
        <label
          className="font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint"
          htmlFor="ap-q"
        >
          query · chief complaint
        </label>
        <textarea
          id="ap-q"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          rows={2}
          className="mt-1 w-full rounded-lg border border-app-subtle bg-black/30 px-3 py-2 font-sans text-sm text-app-primary placeholder:text-app-faint focus:border-quantum-400/60 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-quantum-400/70"
          placeholder="e.g. 8-year-old with sore throat fever 39C tender cervical nodes"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Knob label="top-K" value={topK} min={3} max={20} step={1} onChange={setTopK} suffix="" />
        <Knob
          label="decay"
          value={decay}
          min={0.1}
          max={0.95}
          step={0.05}
          onChange={setDecay}
          suffix=""
        />
        <Knob
          label="max-hops"
          value={maxHops}
          min={1}
          max={5}
          step={1}
          onChange={setMaxHops}
          suffix=""
        />
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={run}
          disabled={running || !query.trim()}
          className="inline-flex items-center gap-2 rounded-lg border border-quantum-400/40 bg-quantum-500/15 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.22em] text-quantum-200 transition hover:bg-quantum-500/25 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Play className="h-3.5 w-3.5" /> {running ? 'firing…' : 'fire activation'}
        </button>
        {result && !result.empty && (
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
            hops used · {result.hopsUsed} · activated · {result.activated.length}
          </span>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 font-mono text-[11px] text-rose-300">
          {error}
        </div>
      )}

      {result?.empty && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 font-mono text-[11px] text-amber-300">
          Brain silent — query has no overlap with current Second Brain nodes. Run{' '}
          <code className="rounded bg-white/5 px-1.5 py-0.5">scripts/research-cycle.ts</code> to
          grow the graph, or seed it from /app/case-library.
        </div>
      )}

      {result && !result.empty && (
        <>
          <div>
            <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
              activated nodes · sorted by activation
            </div>
            <div className="space-y-1.5">
              {result.activated.map((n) => (
                <div key={n.id} className="flex items-center gap-3">
                  <span
                    className={cn(
                      'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.22em]',
                      KIND_TONE[n.kind] ?? KIND_TONE.icd10,
                    )}
                  >
                    {n.kind}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-sans text-sm text-app-primary">
                    {n.label}
                  </span>
                  <span className="font-mono text-[11px] tabular-nums text-app-secondary">
                    {n.activation.toFixed(3)}
                  </span>
                  <div className="h-1.5 w-32 overflow-hidden rounded-full bg-white/5">
                    <div
                      className="h-full bg-gradient-to-r from-quantum-500/60 to-bio-500/60"
                      style={{ width: `${Math.min(100, n.activation * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
              prompt-grounding block · what the LLM sees
            </div>
            <pre className="overflow-x-auto rounded-lg border border-app-subtle bg-black/40 p-3 font-mono text-[11px] leading-relaxed text-app-secondary">
              {result.lines.join('\n') || '(no lines)'}
            </pre>
          </div>
        </>
      )}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────
//  2. Residual lookup — pretend a diagnosis was wrong, watch boost
// ─────────────────────────────────────────────────────────────────

interface BoostedDiff {
  condition: string;
  probability: number;
  basePrior: number;
  residual: number;
  evidenceCount: number;
}

interface BoostResp {
  count: number;
  boosted: BoostedDiff[];
}

function ResidualProbe() {
  const [complaint, setComplaint] = useState('crushing chest pain radiating to left arm');
  const [diffs, setDiffs] = useState([
    { condition: 'Acute MI', probability: 0.6 },
    { condition: 'GERD', probability: 0.25 },
    { condition: 'Pericarditis', probability: 0.15 },
  ]);
  const [resp, setResp] = useState<BoostResp | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/errors/boost`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ complaint: complaint.trim(), differentials: diffs }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setResp((await res.json()) as BoostResp);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'request failed');
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card className="space-y-4 p-4">
      <div>
        <label
          className="font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint"
          htmlFor="rp-c"
        >
          complaint
        </label>
        <textarea
          id="rp-c"
          value={complaint}
          onChange={(e) => setComplaint(e.target.value)}
          rows={2}
          className="mt-1 w-full rounded-lg border border-app-subtle bg-black/30 px-3 py-2 font-sans text-sm text-app-primary focus:border-quantum-400/60 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-quantum-400/70"
        />
      </div>

      <div>
        <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
          candidate differentials · probability vector
        </div>
        <div className="space-y-1.5">
          {diffs.map((d, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: candidate vector is index-stable
            <div key={i} className="flex items-center gap-2">
              <input
                value={d.condition}
                onChange={(e) =>
                  setDiffs((prev) =>
                    prev.map((p, j) => (j === i ? { ...p, condition: e.target.value } : p)),
                  )
                }
                className="flex-1 rounded-md border border-app-subtle bg-black/30 px-3 py-1.5 font-sans text-sm text-app-primary focus:border-quantum-400/60 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-quantum-400/70"
              />
              <input
                type="number"
                step={0.05}
                min={0}
                max={1}
                value={d.probability}
                onChange={(e) =>
                  setDiffs((prev) =>
                    prev.map((p, j) =>
                      j === i ? { ...p, probability: Number(e.target.value) } : p,
                    ),
                  )
                }
                className="w-20 rounded-md border border-app-subtle bg-black/30 px-2 py-1.5 text-right font-mono text-sm tabular-nums text-app-primary focus:border-quantum-400/60 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-quantum-400/70"
              />
            </div>
          ))}
        </div>
      </div>

      <button
        type="button"
        onClick={run}
        disabled={running}
        className="inline-flex items-center gap-2 rounded-lg border border-quantum-400/40 bg-quantum-500/15 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.22em] text-quantum-200 transition hover:bg-quantum-500/25 disabled:opacity-40"
      >
        <Play className="h-3.5 w-3.5" /> {running ? 'computing…' : 'apply boost'}
      </button>

      {error && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 font-mono text-[11px] text-rose-300">
          {error}
        </div>
      )}

      {resp && (
        <div>
          <div className="mb-2 flex items-baseline justify-between font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
            <span>after boost · journal events read · {resp.count}</span>
            <span>±0.3 cap · 0.97/day decay</span>
          </div>
          <div className="space-y-1.5">
            {resp.boosted.map((b) => {
              const delta = b.probability - b.basePrior;
              const deltaTone =
                delta > 0.001
                  ? 'text-bio-300'
                  : delta < -0.001
                    ? 'text-rose-300'
                    : 'text-app-faint';
              return (
                <div
                  key={b.condition}
                  className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 rounded-lg border border-app-subtle bg-white/2 px-3 py-2"
                >
                  <span className="truncate font-sans text-sm text-app-primary">{b.condition}</span>
                  <span className="font-mono text-[11px] tabular-nums text-app-muted">
                    {b.basePrior.toFixed(3)} →
                  </span>
                  <span className="font-mono text-[12px] font-bold tabular-nums text-app-primary">
                    {b.probability.toFixed(3)}
                  </span>
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 font-mono text-[11px] tabular-nums',
                      deltaTone,
                    )}
                  >
                    {delta > 0 ? (
                      <ArrowUp className="h-3 w-3" />
                    ) : delta < 0 ? (
                      <ArrowDown className="h-3 w-3" />
                    ) : null}
                    {delta >= 0 ? '+' : ''}
                    {delta.toFixed(3)}
                    <span className="ml-1 text-app-faint">· n={b.evidenceCount}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <p className="font-mono text-[10px] text-app-faint">
        Empty journal → all residuals 0 (zero events recorded). Hit ✓ / ✗ on a clinic diagnostic to
        start writing residuals; come back here and watch them light up.
      </p>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────
//  3. Learning trail — daily reports as a sparkline
// ─────────────────────────────────────────────────────────────────

interface ReportSummary {
  date: string;
  metrics: {
    memory: { kgNodes: number; kgEdges: number; kgSources: number };
    benchmarks: { medqa: { score: number | null } | null };
    boosting: { totalEvents: number; eventsToday: number };
    ingest: { pubmedCases: number };
  };
}

function LearningTrail() {
  const [dates, setDates] = useState<string[]>([]);
  const [series, setSeries] = useState<ReportSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const list = (await fetch(`${API_BASE}/reports`).then((r) => r.json())) as {
          dates: string[];
        };
        if (cancelled) return;
        setDates(list.dates);
        const rows = await Promise.all(
          list.dates.map((d) =>
            fetch(`${API_BASE}/reports/${d}`)
              .then((r) => r.json() as Promise<ReportSummary>)
              .catch(() => null),
          ),
        );
        if (cancelled) return;
        setSeries(
          rows
            .filter((r): r is ReportSummary => Boolean(r?.metrics))
            .sort((a, b) => a.date.localeCompare(b.date)),
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <Card className="p-6">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
          loading reports…
        </div>
      </Card>
    );
  }

  if (series.length === 0) {
    return (
      <Card className="p-6">
        <p className="font-sans text-sm text-app-muted">
          No reports yet. Run{' '}
          <code className="font-mono text-[11px]">bun run scripts/morbius-daily-report.ts</code>.
        </p>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <SparklineCard
        title="Knowledge-graph nodes"
        icon={Brain}
        unit=""
        values={series.map((r) => ({ x: r.date, y: r.metrics.memory.kgNodes }))}
      />
      <SparklineCard
        title="MedQA accuracy"
        icon={Cpu}
        unit="%"
        values={series.map((r) => ({ x: r.date, y: r.metrics.benchmarks.medqa?.score ?? 0 }))}
      />
      <SparklineCard
        title="PubMed cache (real records)"
        icon={Sparkles}
        unit=""
        values={series.map((r) => ({ x: r.date, y: r.metrics.ingest.pubmedCases }))}
      />
      <SparklineCard
        title="Boosting events recorded"
        icon={TrendingUp}
        unit=""
        values={series.map((r) => ({ x: r.date, y: r.metrics.boosting.totalEvents }))}
      />
      <Card className="p-4 lg:col-span-2">
        <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
          daily log · {series.length} day{series.length === 1 ? '' : 's'}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left font-mono text-[11px]">
            <thead>
              <tr className="border-app-subtle border-b text-app-faint">
                <th className="py-1.5 pr-3">date</th>
                <th className="py-1.5 pr-3">nodes</th>
                <th className="py-1.5 pr-3">edges</th>
                <th className="py-1.5 pr-3">medqa</th>
                <th className="py-1.5 pr-3">pubmed</th>
                <th className="py-1.5 pr-3">boost evts</th>
              </tr>
            </thead>
            <tbody>
              {[...series].reverse().map((r) => (
                <tr key={r.date} className="border-app-subtle border-b last:border-0">
                  <td className="py-1.5 pr-3 text-app-secondary">{r.date}</td>
                  <td className="py-1.5 pr-3 tabular-nums text-app-primary">
                    {r.metrics.memory.kgNodes}
                  </td>
                  <td className="py-1.5 pr-3 tabular-nums text-app-primary">
                    {r.metrics.memory.kgEdges}
                  </td>
                  <td className="py-1.5 pr-3 tabular-nums text-app-primary">
                    {r.metrics.benchmarks.medqa?.score
                      ? `${r.metrics.benchmarks.medqa.score.toFixed(1)}%`
                      : '—'}
                  </td>
                  <td className="py-1.5 pr-3 tabular-nums text-app-secondary">
                    {r.metrics.ingest.pubmedCases.toLocaleString()}
                  </td>
                  <td className="py-1.5 pr-3 tabular-nums text-app-secondary">
                    {r.metrics.boosting.totalEvents}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 font-mono text-[10px] text-app-faint">
          {dates.length} reports cached. Nightly research-cycle appends a new row at 04:23 once{' '}
          <code>install-windows-tasks.ps1</code> has armed the scheduler.
        </p>
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────

function Knob({
  label,
  value,
  min,
  max,
  step,
  onChange,
  suffix,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  suffix: string;
}) {
  return (
    <label className="block">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
          {label}
        </span>
        <span className="font-mono text-[11px] tabular-nums text-app-primary">
          {value}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full accent-quantum-400"
      />
    </label>
  );
}

function SparklineCard({
  title,
  icon: Icon,
  values,
  unit,
}: {
  title: string;
  icon: typeof Brain;
  values: Array<{ x: string; y: number }>;
  unit: string;
}) {
  const ys = values.map((v) => v.y);
  const max = Math.max(...ys, 1);
  const min = Math.min(...ys, 0);
  const range = max - min || 1;
  const last = ys[ys.length - 1] ?? 0;
  const first = ys[0] ?? 0;
  const delta = last - first;
  const W = 240;
  const H = 60;
  const path = values
    .map((v, i) => {
      const x = (i / Math.max(1, values.length - 1)) * W;
      const y = H - ((v.y - min) / range) * H;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <Card className="p-4">
      <div className="flex items-baseline justify-between">
        <div className="inline-flex items-center gap-2">
          <Icon className="h-3.5 w-3.5 text-quantum-300" />
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
            {title}
          </span>
        </div>
        <span className="font-syne text-xl font-bold tabular-nums text-app-primary">
          {Number.isInteger(last) ? last.toLocaleString() : last.toFixed(1)}
          {unit}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mt-2 w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label={`${title} sparkline`}
      >
        <title>{title}</title>
        <path
          d={path}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          className="text-quantum-300"
        />
        {values.map((v, i) => {
          const x = (i / Math.max(1, values.length - 1)) * W;
          const y = H - ((v.y - min) / range) * H;
          return <circle key={v.x} cx={x} cy={y} r={2} className="fill-quantum-300" />;
        })}
      </svg>
      <div className="mt-1 flex items-center justify-between font-mono text-[10px] text-app-faint">
        <span>{values[0]?.x}</span>
        <span
          className={cn(
            'tabular-nums',
            delta > 0 ? 'text-bio-300' : delta < 0 ? 'text-rose-300' : 'text-app-faint',
          )}
        >
          Δ {delta >= 0 ? '+' : ''}
          {Number.isInteger(delta) ? delta.toLocaleString() : delta.toFixed(1)}
          {unit}
        </span>
        <span>{values[values.length - 1]?.x}</span>
      </div>
    </Card>
  );
}
