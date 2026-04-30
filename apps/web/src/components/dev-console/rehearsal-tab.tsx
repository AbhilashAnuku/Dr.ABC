import { Card, cn } from '@dr-abc/ui';
import {
  Activity,
  Check,
  Copy,
  Database,
  GitBranch,
  Loader2,
  Tag,
  Terminal,
  Upload,
  Zap,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { API_BASE } from '../../lib/config.ts';

/**
 * RehearsalTab — pre-flight cockpit surfacing advanced UI/UX metrics
 * in the dev console with rich visualisations.
 *
 * Layers:
 *   1. Status grid          backends · agents · git ahead-count · data on disk
 *   2. MedQA accuracy trend sparkline of last 8 runs · % + delta
 *   3. Per-specialty heat   colour-graded grid (latest medqa run)
 *   4. Latency histogram    8-bucket SVG bar chart from per-question latencyMs
 *   5. Persona triad        3-up bar chart (patient · doctor · student)
 *   6. Data inventory       row + image counts per corpus, with bar chart
 *   7. Rehearsal commands   click-to-copy each command (medqa · persona · push · tag)
 *
 * Backed by GET /research/rehearsal which aggregates docs/status/*.json
 * and a quick git probe.
 */

interface RehearsalResponse {
  ts: number;
  medqaTrend: Array<{
    file: string;
    ranAt?: string;
    accuracy?: number;
    questionCount?: number;
    perSpecialty?: Record<string, { count: number; correct: number; rate: number }>;
    durationMs?: number;
    perQuestion?: Array<{ id?: string; specialty?: string; latencyMs?: number; correct?: boolean }>;
  }>;
  personaSummary: {
    ranAt?: string;
    perPersona?: Array<{
      id: string;
      name?: string;
      role?: string;
      caseCount?: number;
      weightedScore: number;
      topConditionRate: number;
      gauntletPassRate: number;
      p50LatencyMs?: number;
    }>;
  } | null;
  git: { branch: string; ahead: number; dirty: boolean; lastSha?: string } | null;
  dataInventory: {
    hfBench: Array<{ id: string; rows: number; sizeBytes: number }>;
    kaggleImaging: Array<{ id: string; files: number; sizeBytes: number }>;
    kaggleTabular: Array<{ id: string; sizeBytes: number }>;
    isicSample: { images: number; sizeBytes: number };
    totalSizeBytes: number;
  };
  rehearsalCommands: Array<{
    id: string;
    label: string;
    cmd: string;
    desc: string;
    eta: string;
  }>;
}

const FMT_PCT = (n: number | undefined): string =>
  n === undefined ? '—' : `${(n * 100).toFixed(1)}%`;
const FMT_GB = (b: number): string => `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
const FMT_MB = (b: number): string => `${(b / 1024 / 1024).toFixed(1)} MB`;

export function RehearsalTab() {
  const [data, setData] = useState<RehearsalResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${API_BASE}/research/rehearsal`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as RehearsalResponse;
      setData(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'fetch failed');
    } finally {
      setLoading(false);
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh() reads from API_BASE which is module-level
  useEffect(() => {
    void refresh();
  }, []);

  const copy = async (id: string, text: string) => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    await navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied((c) => (c === id ? null : c)), 1500);
  };

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center p-12 font-mono text-xs text-app-faint">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> loading rehearsal snapshot…
      </div>
    );
  }
  if (error && !data) {
    return (
      <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 font-mono text-xs text-rose-200">
        {error}
      </div>
    );
  }
  if (!data) return null;

  const latestMedqa = data.medqaTrend[data.medqaTrend.length - 1];
  const priorMedqa = data.medqaTrend[data.medqaTrend.length - 2];
  const medqaDelta =
    latestMedqa?.accuracy !== undefined && priorMedqa?.accuracy !== undefined
      ? latestMedqa.accuracy - priorMedqa.accuracy
      : null;

  // Persona triad bars
  const personas = data.personaSummary?.perPersona ?? [];

  return (
    <div className="space-y-5 p-4 sm:p-5">
      {/* Hero */}
      <div className="rounded-2xl border border-quantum-400/30 bg-gradient-to-br from-quantum-500/10 via-purple-500/8 to-bio-500/10 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.32em] text-quantum-300">
              <Zap className="h-3 w-3" /> · defense pre-flight · live metrics
            </div>
            <h3 className="mt-2 font-display text-2xl font-bold text-app-primary sm:text-3xl">
              Rehearsal cockpit.
            </h3>
            <p className="mt-1 max-w-2xl font-sans text-sm text-app-muted">
              Everything you need to confirm the live stack is defense-ready · accuracy trend ·
              demographic skew · per-specialty heat · data on disk · click-to-copy harness commands.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-full border border-quantum-400/40 bg-quantum-500/15 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.22em] text-quantum-200 transition hover:bg-quantum-500/25 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Activity className="h-3 w-3" />
            )}{' '}
            refresh
          </button>
        </div>
      </div>

      {/* Status grid */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatusTile
          label="Latest MedQA"
          value={FMT_PCT(latestMedqa?.accuracy)}
          subline={
            medqaDelta === null
              ? `${data.medqaTrend.length} runs on file`
              : `${medqaDelta >= 0 ? '+' : ''}${(medqaDelta * 100).toFixed(1)} pp vs prior`
          }
          tone={
            latestMedqa?.accuracy === undefined
              ? 'neutral'
              : latestMedqa.accuracy >= 0.9
                ? 'success'
                : latestMedqa.accuracy >= 0.7
                  ? 'accent'
                  : 'warning'
          }
        />
        <StatusTile
          label="Persona avg"
          value={
            personas.length > 0
              ? `${((personas.reduce((s, p) => s + p.weightedScore, 0) / personas.length) * 100).toFixed(0)}%`
              : '—'
          }
          subline={personas.length > 0 ? `${personas.length} personas` : 'no run yet'}
          tone={personas.length > 0 ? 'accent' : 'neutral'}
        />
        <StatusTile
          label="Data on disk"
          value={FMT_GB(data.dataInventory.totalSizeBytes)}
          subline={`${data.dataInventory.hfBench.length + data.dataInventory.kaggleImaging.length + data.dataInventory.kaggleTabular.length} corpora`}
          tone="success"
        />
        <StatusTile
          label="Git"
          value={data.git ? `${data.git.lastSha ?? '?'}` : '—'}
          subline={
            data.git
              ? `${data.git.branch} · ${data.git.ahead > 0 ? `${data.git.ahead} ahead` : 'in sync'}${data.git.dirty ? ' · dirty' : ''}`
              : 'no git probe'
          }
          tone={data.git?.dirty ? 'warning' : data.git ? 'success' : 'neutral'}
        />
      </div>

      {/* MedQA trend sparkline + per-specialty heat */}
      <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        <Card className="p-5">
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <div className="font-mono text-[10px] uppercase tracking-[0.32em] text-quantum-300">
              MedQA trend · last {data.medqaTrend.length} runs
            </div>
            {latestMedqa?.ranAt && (
              <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-app-faint">
                {new Date(latestMedqa.ranAt).toISOString().slice(0, 10)}
              </div>
            )}
          </div>
          <Sparkline
            values={data.medqaTrend
              .map((r) => r.accuracy)
              .filter((v): v is number => typeof v === 'number')}
            height={80}
          />
          <div className="mt-3 flex items-baseline justify-between gap-2">
            <div className="font-display text-3xl font-bold text-quantum-200 tabular-nums">
              {FMT_PCT(latestMedqa?.accuracy)}
            </div>
            <div className="text-right font-mono text-[10px] uppercase tracking-[0.18em] text-app-muted">
              {latestMedqa?.questionCount ?? '?'} q ·{' '}
              {((latestMedqa?.durationMs ?? 0) / 1000).toFixed(0)}s
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.32em] text-purple-300">
            Per-specialty heat · latest run
          </div>
          {latestMedqa?.perSpecialty ? (
            <SpecialtyHeat perSpecialty={latestMedqa.perSpecialty} />
          ) : (
            <p className="font-sans text-xs text-app-faint">no specialty breakdown in latest run</p>
          )}
        </Card>
      </div>

      {/* Latency histogram + Persona triad */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.32em] text-bio-300">
            Per-question latency · 8 buckets · ms
          </div>
          {latestMedqa?.perQuestion && latestMedqa.perQuestion.length > 0 ? (
            <LatencyHistogram
              latencies={latestMedqa.perQuestion
                .map((q) => q.latencyMs)
                .filter((n): n is number => typeof n === 'number' && n >= 0)}
            />
          ) : (
            <p className="font-sans text-xs text-app-faint">no per-question data</p>
          )}
        </Card>

        <Card className="p-5">
          <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.32em] text-purple-300">
            Persona triad · weighted score
          </div>
          {personas.length > 0 ? (
            <PersonaBars personas={personas} />
          ) : (
            <p className="font-sans text-xs text-app-faint">
              run <code className="text-quantum-300">bun run morbius:persona</code> to populate
            </p>
          )}
        </Card>
      </div>

      {/* Data inventory */}
      <Card className="p-5">
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <div className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.32em] text-bio-300">
            <Database className="h-3 w-3" /> · data on disk · `data/`
          </div>
          <div className="font-display text-2xl font-bold text-bio-300 tabular-nums">
            {FMT_GB(data.dataInventory.totalSizeBytes)}
          </div>
        </div>
        <DataInventoryView inv={data.dataInventory} />
      </Card>

      {/* Rehearsal commands */}
      <Card className="p-5">
        <div className="mb-3 inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.32em] text-quantum-300">
          <Terminal className="h-3 w-3" /> · rehearsal commands · click to copy
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {data.rehearsalCommands.map((c) => {
            const Icon =
              c.id === 'push'
                ? Upload
                : c.id === 'tag'
                  ? Tag
                  : c.id === 'page-audit'
                    ? Activity
                    : Zap;
            const isCopied = copied === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => void copy(c.id, c.cmd)}
                className={cn(
                  'group flex flex-col gap-1.5 rounded-xl border p-3 text-left transition',
                  isCopied
                    ? 'border-bio-400/60 bg-bio-500/10'
                    : 'border-app-subtle bg-white/5 hover:border-quantum-400/40 hover:bg-quantum-500/5',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 font-display text-sm font-medium text-app-primary">
                    <Icon className="h-3.5 w-3.5 text-quantum-300" /> {c.label}
                  </span>
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.18em]',
                      isCopied ? 'text-bio-300' : 'text-app-faint group-hover:text-quantum-300',
                    )}
                  >
                    {isCopied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}{' '}
                    {isCopied ? 'copied' : c.eta}
                  </span>
                </div>
                <code className="block overflow-x-auto rounded bg-black/30 px-2 py-1 font-mono text-[10px] text-app-secondary">
                  {c.cmd}
                </code>
                <p className="font-sans text-[11px] text-app-muted">{c.desc}</p>
              </button>
            );
          })}
        </div>
      </Card>

      {data.git?.dirty && (
        <Card className="p-4 border-amber-400/40 bg-amber-500/5">
          <div className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-amber-300">
            <GitBranch className="h-3 w-3" /> · uncommitted changes detected
          </div>
          <p className="mt-1 font-sans text-xs text-amber-100/90">
            Working tree has uncommitted changes. Either commit them or stash before tagging the
            defense state.
          </p>
        </Card>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
//  Visualisations · pure SVG · no third-party chart lib
// ────────────────────────────────────────────────────────────────────

function StatusTile({
  label,
  value,
  subline,
  tone,
}: {
  label: string;
  value: string;
  subline: string;
  tone: 'success' | 'warning' | 'accent' | 'neutral';
}) {
  const TONE: Record<typeof tone, string> = {
    success: 'border-bio-400/40 bg-bio-500/8 text-bio-200',
    warning: 'border-amber-400/40 bg-amber-500/8 text-amber-200',
    accent: 'border-quantum-400/40 bg-quantum-500/8 text-quantum-200',
    neutral: 'border-app-subtle bg-white/3 text-app-muted',
  };
  return (
    <div className={cn('rounded-xl border p-4', TONE[tone])}>
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] opacity-80">{label}</div>
      <div className="mt-1 font-display text-2xl font-bold tabular-nums">{value}</div>
      <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] opacity-70">
        {subline}
      </div>
    </div>
  );
}

function Sparkline({ values, height }: { values: number[]; height: number }) {
  if (values.length < 2) {
    return (
      <div className="flex h-20 items-center justify-center font-mono text-[10px] uppercase tracking-[0.18em] text-app-faint">
        need ≥ 2 runs for trend
      </div>
    );
  }
  const w = 240;
  const h = height;
  const pad = 4;
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const span = max - min || 1;
  const xStep = (w - pad * 2) / (values.length - 1);
  const y = (v: number) => pad + (1 - (v - min) / span) * (h - pad * 2);
  const path = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${pad + i * xStep},${y(v)}`).join(' ');
  const lastX = pad + (values.length - 1) * xStep;
  const lastY = y(values[values.length - 1] ?? 0);
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width="100%"
      height={h}
      role="img"
      aria-label="MedQA accuracy trend"
    >
      <defs>
        <linearGradient id="spark-fade" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="rgba(34, 211, 238, 0.4)" />
          <stop offset="100%" stopColor="rgba(34, 211, 238, 0)" />
        </linearGradient>
      </defs>
      <path d={`${path} L ${lastX},${h - pad} L ${pad},${h - pad} Z`} fill="url(#spark-fade)" />
      <path d={path} fill="none" stroke="rgb(103, 232, 249)" strokeWidth="2" />
      {values.map((v, i) => (
        <circle
          // biome-ignore lint/suspicious/noArrayIndexKey: stable per-index
          key={i}
          cx={pad + i * xStep}
          cy={y(v)}
          r={i === values.length - 1 ? 4 : 2}
          fill={i === values.length - 1 ? 'rgb(103, 232, 249)' : 'rgba(103, 232, 249, 0.55)'}
        />
      ))}
      <text
        x={lastX}
        y={lastY - 8}
        textAnchor="end"
        fontSize="10"
        fontFamily="JetBrains Mono, monospace"
        fill="rgb(165, 243, 252)"
      >
        {(values[values.length - 1] ?? 0 * 100).toFixed(0)}%
      </text>
    </svg>
  );
}

function SpecialtyHeat({
  perSpecialty,
}: {
  perSpecialty: Record<string, { count: number; correct: number; rate: number }>;
}) {
  const rows = Object.entries(perSpecialty)
    .filter(([, v]) => v.count > 0)
    .sort((a, b) => b[1].count - a[1].count);
  if (rows.length === 0) {
    return <div className="font-mono text-[10px] text-app-faint">empty</div>;
  }
  const maxCount = Math.max(...rows.map(([, v]) => v.count), 1);
  return (
    <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map(([name, v]) => {
        const sat = Math.min(1, v.rate);
        const bg =
          sat >= 0.8
            ? 'rgba(16, 185, 129, 0.2)'
            : sat >= 0.5
              ? 'rgba(34, 211, 238, 0.2)'
              : sat >= 0.25
                ? 'rgba(245, 158, 11, 0.2)'
                : 'rgba(244, 63, 94, 0.2)';
        const border =
          sat >= 0.8
            ? 'rgb(52, 211, 153)'
            : sat >= 0.5
              ? 'rgb(103, 232, 249)'
              : sat >= 0.25
                ? 'rgb(252, 211, 77)'
                : 'rgb(251, 113, 133)';
        return (
          <div
            key={name}
            className="rounded-md border px-2 py-1.5 transition"
            style={{ background: bg, borderColor: `${border}55` }}
          >
            <div className="flex items-baseline justify-between gap-1">
              <span className="font-sans text-xs text-app-primary">{name}</span>
              <span className="font-mono text-[10px] tabular-nums" style={{ color: border }}>
                {(v.rate * 100).toFixed(0)}%
              </span>
            </div>
            <div className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.18em] text-app-faint">
              {v.correct}/{v.count} · {Math.round((v.count / maxCount) * 100)}% of run
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LatencyHistogram({ latencies }: { latencies: number[] }) {
  if (latencies.length === 0) {
    return <div className="font-mono text-[10px] text-app-faint">no samples</div>;
  }
  const min = Math.min(...latencies);
  const max = Math.max(...latencies);
  const buckets = 8;
  const range = max - min || 1;
  const step = range / buckets;
  const counts = new Array<number>(buckets).fill(0);
  for (const v of latencies) {
    const idx = Math.min(buckets - 1, Math.floor((v - min) / step));
    counts[idx] = (counts[idx] ?? 0) + 1;
  }
  const maxCount = Math.max(...counts, 1);
  const w = 240;
  const h = 100;
  const pad = 8;
  const barW = (w - pad * 2) / buckets - 2;
  const median = [...latencies].sort((a, b) => a - b)[Math.floor(latencies.length / 2)] ?? 0;
  return (
    <div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        width="100%"
        height={h}
        role="img"
        aria-label="latency histogram"
      >
        {counts.map((c, i) => {
          const bh = (c / maxCount) * (h - pad * 2);
          return (
            <rect
              // biome-ignore lint/suspicious/noArrayIndexKey: stable per-index
              key={i}
              x={pad + i * (barW + 2)}
              y={h - pad - bh}
              width={barW}
              height={bh}
              fill={
                i === 0
                  ? 'rgb(110, 231, 183)'
                  : i < buckets / 2
                    ? 'rgb(52, 211, 153)'
                    : 'rgb(252, 211, 77)'
              }
              rx="1"
            />
          );
        })}
      </svg>
      <div className="mt-1 grid grid-cols-3 gap-2 font-mono text-[10px] tabular-nums text-app-muted">
        <div>min · {min.toFixed(0)} ms</div>
        <div className="text-center">p50 · {median.toFixed(0)} ms</div>
        <div className="text-right">max · {max.toFixed(0)} ms</div>
      </div>
    </div>
  );
}

function PersonaBars({
  personas,
}: {
  personas: Array<{
    id: string;
    name?: string;
    role?: string;
    weightedScore: number;
    topConditionRate: number;
    gauntletPassRate: number;
  }>;
}) {
  return (
    <div className="space-y-2.5">
      {personas.map((p) => {
        const pct = Math.round(p.weightedScore * 100);
        return (
          <div key={p.id}>
            <div className="flex items-baseline justify-between gap-2 font-mono text-[10px] uppercase tracking-[0.18em]">
              <span className="text-app-secondary">
                {p.id} {p.role ? `· ${p.role}` : ''}
              </span>
              <span className="text-purple-200 tabular-nums">{pct}%</span>
            </div>
            <div className="mt-1 h-3 overflow-hidden rounded-full border border-app-subtle bg-white/5">
              <div
                className="h-full rounded-full bg-gradient-to-r from-purple-400 to-quantum-400 transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="mt-1 flex items-baseline justify-between gap-2 font-mono text-[9px] uppercase tracking-[0.18em] text-app-faint">
              <span>top · {Math.round(p.topConditionRate * 100)}%</span>
              <span>gauntlet · {Math.round(p.gauntletPassRate * 100)}%</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DataInventoryView({
  inv,
}: {
  inv: RehearsalResponse['dataInventory'];
}) {
  const allRows = inv.hfBench.reduce((s, r) => s + r.rows, 0);
  const allImages = inv.kaggleImaging.reduce((s, r) => s + r.files, 0) + inv.isicSample.images;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCell label="Q&A rows" value={allRows.toLocaleString()} note="across HF bench" />
        <MetricCell
          label="Medical images"
          value={allImages.toLocaleString()}
          note="ISIC + Kaggle imaging"
        />
        <MetricCell label="Total size" value={FMT_GB(inv.totalSizeBytes)} note="data/ on disk" />
      </div>

      {inv.hfBench.length > 0 && (
        <div>
          <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-app-muted">
            HuggingFace Q&A
          </div>
          <div className="space-y-1">
            {inv.hfBench.map((r) => (
              <BarRow
                key={r.id}
                label={r.id}
                value={r.rows}
                max={Math.max(...inv.hfBench.map((x) => x.rows), 1)}
                trailing={`${r.rows.toLocaleString()} rows · ${FMT_MB(r.sizeBytes)}`}
              />
            ))}
          </div>
        </div>
      )}

      {inv.kaggleImaging.length > 0 && (
        <div>
          <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-app-muted">
            Kaggle imaging
          </div>
          <div className="space-y-1">
            {inv.kaggleImaging.map((r) => (
              <BarRow
                key={r.id}
                label={r.id}
                value={r.files}
                max={Math.max(...inv.kaggleImaging.map((x) => x.files), 1)}
                trailing={`${r.files.toLocaleString()} files · ${FMT_MB(r.sizeBytes)}`}
              />
            ))}
          </div>
        </div>
      )}

      {inv.kaggleTabular.length > 0 && (
        <div>
          <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-app-muted">
            Kaggle tabular
          </div>
          <ul className="grid gap-1 sm:grid-cols-2 font-mono text-[10px] text-app-secondary">
            {inv.kaggleTabular.map((r) => (
              <li
                key={r.id}
                className="flex items-baseline justify-between rounded border border-app-subtle bg-white/3 px-2 py-1"
              >
                <span>{r.id}</span>
                <span className="tabular-nums text-app-muted">{FMT_MB(r.sizeBytes)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function MetricCell({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-lg border border-app-subtle bg-white/3 p-3">
      <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-app-faint">{label}</div>
      <div className="mt-1 font-display text-xl font-bold text-bio-300 tabular-nums">{value}</div>
      <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-app-faint">{note}</div>
    </div>
  );
}

function BarRow({
  label,
  value,
  max,
  trailing,
}: {
  label: string;
  value: number;
  max: number;
  trailing: string;
}) {
  const pct = Math.round((value / max) * 100);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 font-mono text-[10px] text-app-secondary">
        <span>{label}</span>
        <span className="text-app-faint">{trailing}</span>
      </div>
      <div className="mt-0.5 h-1.5 overflow-hidden rounded-full border border-app-subtle bg-white/5">
        <div
          className="h-full rounded-full bg-gradient-to-r from-bio-400 to-quantum-400"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
