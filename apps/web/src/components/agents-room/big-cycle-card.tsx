// Big-cycle card — pinned to the agents-room top-right.
//
// One button runs the full training pipeline end-to-end:
//   accuracy harness  →  meta-agent  →  KG fine-tune
//
// The result lands as a visual report (no JSON dumps) — stage timings,
// accuracy ring, meta-agent candidates, KG strengthened-edge bars. All
// rendered as inline SVG so the agents-room bundle stays light.
//
// Endpoints (apps/api/src/server.ts):
//   POST /cycle/big/start      developer-gated, blocks while the
//                              pipeline runs (~3 minutes warm).
//   GET  /cycle/big/last       returns the most recent report from
//                              docs/status/big-cycle-last.json.

import { Brain, CircleCheck, CircleX, Loader2, Play, TrendingUp, Zap } from 'lucide-react';
import { useEffect, useState } from 'react';
import { API_BASE } from '../../lib/config.ts';

interface StageSummary {
  topConditionRate?: number | null;
  gauntletPassRate?: number | null;
  p50LatencyMs?: number | null;
  caseCount?: number | null;
  snapshot?: string;
  // MedQA
  accuracy?: number | null;
  nonErrorAccuracy?: number | null;
  answeredCount?: number | null;
  questionCount?: number | null;
  // Meta-agent
  candidateCount?: number;
  promotedCount?: number;
  baseline?: number | null;
  // KG fine-tune
  cycleSeq?: number | null;
  signalsConsumed?: number;
  edgesUpdated?: number;
  totalAbsoluteShift?: number;
  redFlagsGuarded?: number;
  decayedEdges?: number;
  topStrengthened?: Array<{ sourceLabel: string; targetLabel: string; delta: number }>;
}

interface Stage {
  name: string;
  ok: boolean | null;
  durationMs: number;
  exitCode: number | null;
  summary: StageSummary;
}

interface BigCycleReport {
  ranAt: string | null;
  durationMs: number;
  running?: boolean;
  stages: Stage[];
}

const STAGE_LABELS: Record<string, string> = {
  accuracy: 'Seed cases',
  medqa: 'MedQA-USMLE',
  'meta-agent': 'Meta-agent',
  'kg-finetune': 'KG fine-tune',
};

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return `${(n * 100).toFixed(1)}%`;
}

function fmtNum(n: number | null | undefined, d = 2): string {
  if (n === null || n === undefined) return '—';
  return n.toFixed(d);
}

// SVG accuracy ring — visual indicator of topConditionRate.
function AccuracyRing({ value }: { value: number | null | undefined }) {
  const v = value ?? 0;
  const radius = 24;
  const circ = 2 * Math.PI * radius;
  const dash = Math.max(0, Math.min(1, v)) * circ;
  return (
    <svg viewBox="0 0 60 60" className="h-14 w-14" aria-label={`accuracy ${fmtPct(value)}`}>
      <title>top-condition accuracy</title>
      <circle
        cx="30"
        cy="30"
        r={radius}
        fill="none"
        className="stroke-app-subtle"
        strokeWidth="6"
      />
      <circle
        cx="30"
        cy="30"
        r={radius}
        fill="none"
        className="stroke-bio-400"
        strokeWidth="6"
        strokeDasharray={`${dash} ${circ - dash}`}
        strokeDashoffset={circ / 4}
        strokeLinecap="round"
        transform="rotate(-90 30 30)"
      />
      <text
        x="30"
        y="34"
        textAnchor="middle"
        className="fill-app-primary font-mono text-[10px] tabular-nums"
      >
        {fmtPct(value)}
      </text>
    </svg>
  );
}

function StageStrip({
  report,
  running,
  activeStage,
}: {
  report: BigCycleReport | null;
  running: boolean;
  activeStage: string | null;
}) {
  const names = ['accuracy', 'medqa', 'meta-agent', 'kg-finetune'];
  return (
    <div className="grid grid-cols-4 gap-2">
      {names.map((n) => {
        const stage = report?.stages?.find((s) => s.name === n) ?? null;
        const isActive = running && activeStage === n;
        const passed = stage?.ok === true;
        const failed = stage?.ok === false;
        return (
          <div
            key={n}
            className={[
              'rounded-lg border px-3 py-2 transition',
              isActive
                ? 'border-quantum-400/60 bg-quantum-500/15'
                : passed
                  ? 'border-bio-400/40 bg-bio-500/8'
                  : failed
                    ? 'border-rose-400/40 bg-rose-500/8'
                    : 'border-app-subtle bg-app-surface-strong/60',
            ].join(' ')}
          >
            <div className="flex items-center gap-1.5">
              {isActive ? (
                <Loader2 className="h-3 w-3 animate-spin text-quantum-200" aria-hidden="true" />
              ) : passed ? (
                <CircleCheck className="h-3 w-3 text-bio-300" aria-hidden="true" />
              ) : failed ? (
                <CircleX className="h-3 w-3 text-rose-300" aria-hidden="true" />
              ) : (
                <span className="h-2 w-2 rounded-full bg-app-faint" />
              )}
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-app-primary">
                {STAGE_LABELS[n] ?? n}
              </span>
            </div>
            <div className="mt-1 font-mono text-[10px] tabular-nums text-app-muted">
              {stage ? fmtDuration(stage.durationMs) : isActive ? '…' : '—'}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function BigCycleCard() {
  const [report, setReport] = useState<BigCycleReport | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeStage, setActiveStage] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let alive = true;
    const fetchLast = async () => {
      try {
        const r = await fetch(`${API_BASE}/cycle/big/last`);
        if (!r.ok) return;
        const j = (await r.json()) as BigCycleReport;
        if (alive) setReport(j);
      } catch {
        /* swallow */
      }
    };
    fetchLast();
    return () => {
      alive = false;
    };
  }, []);

  const startBigCycle = async () => {
    setRunning(true);
    setError(null);
    setActiveStage('accuracy');
    // The endpoint is fire-and-forget: it returns immediately with
    // { started: true } and writes the live report file as each stage
    // exits. We poll /cycle/big/last every 5 s and watch the stages
    // turn ok=true one by one.
    try {
      const kick = await fetch(`${API_BASE}/cycle/big/start`, {
        method: 'POST',
        headers: { 'X-Dr-Abc-Role': 'developer' },
      });
      const kj = (await kick.json()) as { started?: boolean; error?: string; reason?: string };
      if (kj.error) {
        setError(kj.error);
        setRunning(false);
        setActiveStage(null);
        return;
      }
      if (kj.started === false && kj.reason) {
        setError(`Already running — ${kj.reason}`);
      }
      // Poll the status file every 5 s; stop when running === false.
      const poll = window.setInterval(async () => {
        try {
          const r = await fetch(`${API_BASE}/cycle/big/last`);
          if (!r.ok) return;
          const j = (await r.json()) as BigCycleReport;
          setReport(j);
          // Move the active-stage marker to the next not-yet-ok stage.
          const next = j.stages?.find((s) => s.ok === null);
          setActiveStage(next?.name ?? null);
          if (j.running === false) {
            window.clearInterval(poll);
            setRunning(false);
            setActiveStage(null);
          }
        } catch {
          /* swallow — keep polling */
        }
      }, 5_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRunning(false);
      setActiveStage(null);
    }
  };

  const accStage = report?.stages?.find((s) => s.name === 'accuracy');
  const medqaStage = report?.stages?.find((s) => s.name === 'medqa');
  const metaStage = report?.stages?.find((s) => s.name === 'meta-agent');
  const kgStage = report?.stages?.find((s) => s.name === 'kg-finetune');
  const topStrengthened = (kgStage?.summary?.topStrengthened ?? []) as Array<{
    sourceLabel: string;
    targetLabel: string;
    delta: number;
  }>;

  return (
    <div className="pointer-events-auto absolute right-4 top-4 z-20 flex w-[min(22rem,90vw)] flex-col gap-3 rounded-xl border border-app-subtle bg-app-surface/85 p-4 shadow-[0_6px_30px_-12px_rgba(0,0,0,0.4)] backdrop-blur-md">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-quantum-300" aria-hidden="true" />
          <h3 className="font-mono text-[12px] uppercase tracking-[0.18em] text-app-primary">
            Big training cycle
          </h3>
        </div>
        <button
          type="button"
          onClick={() => void startBigCycle()}
          disabled={running}
          className="inline-flex items-center gap-1.5 rounded-full border border-quantum-400/50 bg-quantum-500/20 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-quantum-100 transition hover:border-quantum-400/80 hover:bg-quantum-500/30 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {running ? (
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
          ) : (
            <Play className="h-3 w-3" aria-hidden="true" />
          )}
          {running ? 'running…' : 'start'}
        </button>
      </header>

      <StageStrip report={report} running={running} activeStage={activeStage} />

      {report?.ranAt && (
        <div className="flex flex-col gap-3 rounded-lg border border-app-subtle bg-app-surface-strong/40 p-3">
          {/* Two accuracy rings — seed cases (open-ended) and MedQA-USMLE
              (4-option). Two measurements of two different things; the
              examiner sees both. */}
          <div className="flex items-center gap-3">
            <div className="flex flex-col items-center gap-1">
              <AccuracyRing value={accStage?.summary?.topConditionRate ?? null} />
              <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-app-muted">
                seed · open-end
              </span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <AccuracyRing value={medqaStage?.summary?.accuracy ?? null} />
              <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-app-muted">
                MedQA · 4-opt
              </span>
            </div>
            <div className="flex flex-1 flex-col gap-1 font-mono text-[10px] tabular-nums text-app-muted">
              <div className="flex justify-between">
                <span>gauntlet pass</span>
                <span className="text-app-primary">
                  {fmtPct(accStage?.summary?.gauntletPassRate)}
                </span>
              </div>
              <div className="flex justify-between">
                <span>seed p50</span>
                <span className="text-app-primary">
                  {accStage?.summary?.p50LatencyMs
                    ? `${(accStage.summary.p50LatencyMs / 1000).toFixed(1)} s`
                    : '—'}
                </span>
              </div>
              <div className="flex justify-between">
                <span>MedQA</span>
                <span className="text-app-primary">
                  {medqaStage?.summary?.answeredCount ?? '—'}/
                  {medqaStage?.summary?.questionCount ?? '—'}
                </span>
              </div>
              <div className="flex justify-between">
                <span>total time</span>
                <span className="text-app-primary">{fmtDuration(report.durationMs)}</span>
              </div>
            </div>
          </div>

          {/* Meta + KG mini-summary */}
          <div className="grid grid-cols-2 gap-2 font-mono text-[10px] tabular-nums">
            <div className="flex flex-col gap-1 rounded border border-app-subtle p-2">
              <span className="flex items-center gap-1 text-[9px] uppercase tracking-[0.16em] text-app-muted">
                <Brain className="h-2.5 w-2.5" aria-hidden="true" /> meta-agent
              </span>
              <span className="text-app-primary">
                {metaStage?.summary?.promotedCount ?? 0}/{metaStage?.summary?.candidateCount ?? 0}
              </span>
              <span className="text-[9px] text-app-muted">promoted / proposed</span>
            </div>
            <div className="flex flex-col gap-1 rounded border border-app-subtle p-2">
              <span className="flex items-center gap-1 text-[9px] uppercase tracking-[0.16em] text-app-muted">
                <TrendingUp className="h-2.5 w-2.5" aria-hidden="true" /> KG cycle
              </span>
              <span className="text-app-primary">
                #{kgStage?.summary?.cycleSeq ?? '—'} · {kgStage?.summary?.edgesUpdated ?? 0} edges
              </span>
              <span className="text-[9px] text-app-muted">
                shift {fmtNum(kgStage?.summary?.totalAbsoluteShift)}
              </span>
            </div>
          </div>

          {/* Top strengthened edges */}
          {topStrengthened.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <button
                type="button"
                onClick={() => setExpanded((e) => !e)}
                className="flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.16em] text-app-muted hover:text-app-primary"
              >
                <span>top strengthened paths</span>
                <span>{expanded ? '−' : '+'}</span>
              </button>
              {expanded && (
                <ul className="flex flex-col gap-1">
                  {topStrengthened.map((e) => {
                    const max = Math.max(...topStrengthened.map((x) => x.delta));
                    const w = (e.delta / max) * 100;
                    return (
                      <li
                        key={`${e.sourceLabel}->${e.targetLabel}`}
                        className="flex flex-col gap-0.5"
                      >
                        <div className="flex items-center justify-between font-mono text-[9px]">
                          <span className="truncate text-app-primary">
                            {e.sourceLabel.slice(0, 22)} → {e.targetLabel.slice(0, 14)}
                          </span>
                          <span className="text-bio-300">+{fmtNum(e.delta, 3)}</span>
                        </div>
                        <div className="h-1 w-full rounded bg-app-surface-strong">
                          <div
                            className="h-full rounded bg-bio-500/70"
                            style={{ width: `${w}%` }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 font-mono text-[9px] uppercase tracking-[0.14em] text-app-muted">
            <span>backend: nvidia (free)</span>
            <span>·</span>
            <span>red-flags guarded: {kgStage?.summary?.redFlagsGuarded ?? 0}</span>
          </div>
        </div>
      )}

      {error && (
        <p className="rounded border border-rose-400/40 bg-rose-500/10 p-2 font-mono text-[10px] text-rose-200">
          {error}
        </p>
      )}

      <p className="font-sans text-[10px] leading-relaxed text-app-muted">
        One click chains the accuracy harness → meta-agent → KG fine-tune. Bounded gradient updates,
        red-flag guard, NVIDIA-only inference. ~3 minutes warm on free tier.
      </p>
    </div>
  );
}
