// TODO(i18n): per the standing-rule (memory: new-component-rules), the
// section titles + status pills below need wrapping in t() once a
// `research` i18n namespace exists in en/de/hi.json. Brand-name labels
// ("doctor-brain", "Mörbius") stay untranslated.
import { Card, cn } from '@dr-abc/ui';
import { Brain, CalendarClock, FlaskConical, Microscope, Rocket, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { API_BASE } from '../../lib/config.ts';
import { KnowledgeGraphPanel } from './knowledge-graph-panel.tsx';

/**
 * Research-grade Mörbius dev-console surface.
 *
 * Runs a research-grade Mörbius alongside the production model:
 * scheduled agents train and test it on data and medical analysis,
 * independent of the live Mörbius.
 *
 * What this tab shows:
 *   - Doctor-Brain header — live status of the research-Mörbius training
 *     loop (always-on autopilot · scheduled cycles · most recent verdict)
 *   - Per-agent analysis grid — every agent in the registry, with its
 *     last-cycle metrics and a visual delta tile
 *   - Scheduled experiments — the registered cron jobs
 *     (which are otherwise invisible because they live in the orchestrator's
 *     session, not on disk)
 *   - Research timeline — newest-first list of research-cycle-*.json
 *     snapshots written by the daily training agent, with deltas
 *
 * Single GET to /research/snapshot powers the whole tab.
 */

interface PersonaRow {
  id: string;
  name?: string;
  role?: string;
  weightedScore: number;
  topConditionRate: number;
  gauntletPassRate: number;
  caseCount?: number;
  p50LatencyMs?: number;
}

interface PersonaSummary {
  ranAt: string;
  perPersona: PersonaRow[];
}

interface LiveAccuracy {
  pct?: number;
  ranAt?: string;
  cases?: number;
  modelUsed?: string;
}

interface MedQARun {
  ranAt?: string;
  total?: number;
  correct?: number;
  pct?: number;
  perModel?: Record<string, { correct: number; total: number }>;
}

interface ResearchCycle {
  ranAt?: string;
  verdict?: 'improving' | 'regressing' | 'stable';
  persona?: { id: string; weightedScore: number }[];
  medqaPct?: number;
  liveAccuracyPct?: number;
  deltas?: Record<string, number>;
  notes?: string;
}

interface ScheduledExperiment {
  id: string;
  cadence: string;
  cron: string;
  purpose: string;
  runs: string;
}

interface AgentRow {
  kind: string;
  version: number;
}

interface ResearchSnapshot {
  ts: number;
  files: { personaFile: string | null; medqaFile: string | null };
  personaSummary: PersonaSummary | null;
  liveAccuracy: LiveAccuracy | null;
  medqa: MedQARun | null;
  cycles: Array<{ file: string; data: ResearchCycle | null }>;
  scheduledExperiments: ScheduledExperiment[];
  agents: AgentRow[];
  morbius: { mode: string; narrative: string };
}

const AGENT_DESCRIPTIONS: Record<string, { label: string; role: string }> = {
  triage: { label: 'Triage', role: 'ESI assignment + red-flag detection' },
  diagnostic: { label: 'Diagnostic', role: 'differential ladder + top-1 condition' },
  validator: { label: 'Validator', role: 'gauntlet · ICD-10 sanity + drug safety' },
  imaging: { label: 'Imaging', role: 'MONAI heatmap + Grad-CAM overlay' },
  library: { label: 'Library', role: 'BM25 / pgvector retrieval over corpus' },
  profile: { label: 'Profile', role: 'patient context + memory recall' },
  research: { label: 'Research', role: 'PubMed retrieval + citation building' },
  evidence: { label: 'Evidence-Synth', role: 'cross-source reasoning' },
};

export function ResearchTab() {
  const [snap, setSnap] = useState<ResearchSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch(`${API_BASE}/research/snapshot`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = (await r.json()) as ResearchSnapshot;
        if (!cancelled) setSnap(j);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'snapshot unavailable');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    const id = setInterval(load, 45_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (loading && !snap) {
    return (
      <div className="p-6 font-mono text-[11px] uppercase tracking-[0.18em] text-app-faint">
        loading research-mörbius snapshot…
      </div>
    );
  }
  if (error && !snap) {
    return (
      <div className="m-6 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 font-sans text-xs text-amber-200">
        {error}. The API at <code className="font-mono">{API_BASE}</code> may be offline.
      </div>
    );
  }
  if (!snap) return null;

  return (
    <div className="space-y-5 p-4">
      <DoctorBrainHeader snap={snap} />
      <KnowledgeGraphPanel />
      <PerAgentAnalysis snap={snap} />
      <ScheduledExperiments items={snap.scheduledExperiments} />
      <ResearchTimeline cycles={snap.cycles} />
    </div>
  );
}

function DoctorBrainHeader({ snap }: { snap: ResearchSnapshot }) {
  const persona = snap.personaSummary;
  const live = snap.liveAccuracy;
  const medqa = snap.medqa;
  const lastCycle = snap.cycles[0]?.data ?? null;

  const verdictTone =
    lastCycle?.verdict === 'improving'
      ? 'border-bio-500/40 bg-bio-500/10 text-bio-300'
      : lastCycle?.verdict === 'regressing'
        ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
        : 'border-quantum-400/40 bg-quantum-500/10 text-quantum-300';

  return (
    <Card className="overflow-hidden p-0 shadow-[0_0_60px_-15px_rgba(168,85,247,0.55)]">
      <div className="bg-linear-to-br from-purple-500/15 via-quantum-500/10 to-bio-500/10 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.32em] text-purple-300">
              <Brain className="h-3.5 w-3.5" /> · doctor-brain · research-grade morbius
            </div>
            <h3 className="mt-1 font-display text-2xl font-bold text-app-primary">
              A second Mörbius is training while the live one sees patients.
            </h3>
            <p className="mt-1 max-w-3xl font-sans text-sm text-app-muted">
              {snap.morbius.narrative}
            </p>
          </div>
          {lastCycle?.verdict && (
            <span
              className={cn(
                'rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.22em]',
                verdictTone,
              )}
            >
              ✦ trend · {lastCycle.verdict}
            </span>
          )}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Stat
            label="Persona harness"
            value={
              persona
                ? `${Math.round(
                    (persona.perPersona.reduce((s, p) => s + p.weightedScore, 0) /
                      Math.max(1, persona.perPersona.length)) *
                      100,
                  )}%`
                : '—'
            }
            sub={
              persona
                ? `${persona.perPersona.length} personas · ${new Date(persona.ranAt).toISOString().slice(0, 10)}`
                : 'no run yet'
            }
            tone="bio"
          />
          <Stat
            label="MedQA"
            value={
              medqa?.pct !== undefined && medqa.pct !== null ? `${medqa.pct.toFixed(1)}%` : '—'
            }
            sub={
              medqa
                ? `${medqa.correct ?? 0} / ${medqa.total ?? 0} · ${medqa.ranAt?.slice(0, 10) ?? ''}`
                : 'awaiting first /mcq run'
            }
            tone="quantum"
          />
          <Stat
            label="Live accuracy (autopilot)"
            value={
              live?.pct !== undefined && live.pct !== null
                ? `${(live.pct < 1 ? live.pct * 100 : live.pct).toFixed(1)}%`
                : '—'
            }
            sub={
              live?.ranAt
                ? new Date(live.ranAt).toISOString().slice(0, 16).replace('T', ' ')
                : 'no snapshot'
            }
            tone="purple"
          />
        </div>
      </div>
    </Card>
  );
}

function PerAgentAnalysis({ snap }: { snap: ResearchSnapshot }) {
  const persona = snap.personaSummary;
  const personaAvg = useMemo(() => {
    if (!persona) return 0;
    const xs = persona.perPersona.map((p) => p.gauntletPassRate);
    if (xs.length === 0) return 0;
    return xs.reduce((s, x) => s + x, 0) / xs.length;
  }, [persona]);

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <Microscope className="h-3.5 w-3.5 text-quantum-300" />
        <h4 className="font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
          per-agent analysis · {snap.agents.length} agents · gauntlet pass{' '}
          {Math.round(personaAvg * 100)}%
        </h4>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {snap.agents.map((a) => {
          const meta = AGENT_DESCRIPTIONS[a.kind] ?? {
            label: a.kind,
            role: 'auxiliary agent',
          };
          return (
            <div
              key={a.kind}
              className="rounded-xl border border-app-subtle bg-white/3 p-3 transition hover:border-quantum-400/40"
            >
              <div className="flex items-baseline justify-between">
                <span className="font-display text-sm font-semibold text-app-primary">
                  {meta.label}
                </span>
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-app-faint">
                  v{a.version}
                </span>
              </div>
              <p className="mt-1 font-sans text-[11px] leading-snug text-app-muted">{meta.role}</p>
              <div className="mt-2 flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.18em]">
                <span className="rounded-full border border-bio-500/40 bg-bio-500/10 px-2 py-0.5 text-bio-300">
                  online
                </span>
              </div>
            </div>
          );
        })}
      </div>
      {persona && (
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {persona.perPersona.map((p) => {
            const pct = Math.round(p.weightedScore * 100);
            const tone =
              p.weightedScore >= 0.7
                ? 'border-bio-500/40 text-bio-300'
                : p.weightedScore >= 0.5
                  ? 'border-quantum-400/40 text-quantum-300'
                  : 'border-amber-500/40 text-amber-300';
            return (
              <div
                key={p.id}
                className={cn('rounded-lg border bg-white/3 p-3 font-mono text-[11px]', tone)}
              >
                <div className="mb-1 uppercase tracking-[0.18em] opacity-70">persona · {p.id}</div>
                <div className="font-display text-2xl font-bold tabular-nums text-app-primary">
                  {pct}%
                </div>
                <div className="mt-1 grid grid-cols-2 gap-1 font-mono text-[10px] opacity-80">
                  <span>top · {Math.round(p.topConditionRate * 100)}%</span>
                  <span>gauntlet · {Math.round(p.gauntletPassRate * 100)}%</span>
                  <span>cases · {p.caseCount ?? 0}</span>
                  {p.p50LatencyMs !== undefined && (
                    <span>p50 · {Math.round(p.p50LatencyMs / 100) / 10}s</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ScheduledExperiments({ items }: { items: ScheduledExperiment[] }) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <CalendarClock className="h-3.5 w-3.5 text-amber-300" />
        <h4 className="font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
          scheduled experiments · {items.length} jobs
        </h4>
      </div>
      <div className="space-y-2">
        {items.map((s) => (
          <div
            key={s.id}
            className="rounded-xl border border-app-subtle bg-white/3 p-3 transition hover:border-amber-400/40"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="flex items-center gap-2">
                <Rocket className="h-3 w-3 text-amber-300" />
                <span className="font-display text-sm font-semibold text-app-primary">{s.id}</span>
                <code className="font-mono text-[10px] text-app-faint">{s.cron}</code>
              </div>
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-amber-300">
                {s.cadence}
              </span>
            </div>
            <p className="mt-1 font-sans text-xs text-app-muted">{s.purpose}</p>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-app-faint">
              runs · {s.runs}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function ResearchTimeline({ cycles }: { cycles: ResearchSnapshot['cycles'] }) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <FlaskConical className="h-3.5 w-3.5 text-purple-300" />
        <h4 className="font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
          research timeline · {cycles.length} cycles on file
        </h4>
      </div>
      {cycles.length === 0 && (
        <div className="rounded-lg border border-app-subtle bg-white/3 px-4 py-3 font-sans text-xs text-app-muted">
          No research cycles yet. The first daily training run lands tonight at 04:23 local — it
          will write
          <code className="ml-1 font-mono text-[11px] text-app-secondary">
            docs/status/research-cycle-YYYY-MM-DD.json
          </code>{' '}
          and surface here.
        </div>
      )}
      {cycles.length > 0 && (
        <ol className="space-y-2">
          {cycles.map(({ file, data }) => {
            const verdict = data?.verdict;
            const tone =
              verdict === 'improving'
                ? 'border-bio-500/40 bg-bio-500/10 text-bio-300'
                : verdict === 'regressing'
                  ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                  : 'border-app-subtle';
            return (
              <li key={file} className={cn('rounded-xl border p-3 font-mono text-[11px]', tone)}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-display text-sm font-semibold text-app-primary">
                    {file.replace(/^research-cycle-|\.json$/g, '')}
                  </span>
                  {verdict && (
                    <span className="rounded-full border border-current px-2 py-0.5 text-[9px] uppercase tracking-[0.18em]">
                      {verdict}
                    </span>
                  )}
                </div>
                <div className="mt-1 grid grid-cols-2 gap-1 sm:grid-cols-3 font-mono text-[10px] opacity-80">
                  {data?.medqaPct !== undefined && data.medqaPct !== null && (
                    <span>medqa · {data.medqaPct.toFixed(1)}%</span>
                  )}
                  {data?.liveAccuracyPct !== undefined && data.liveAccuracyPct !== null && (
                    <span>live · {data.liveAccuracyPct.toFixed(1)}%</span>
                  )}
                  {data?.persona?.map((p) => (
                    <span key={p.id}>
                      {p.id} · {Math.round((p.weightedScore ?? 0) * 100)}%
                    </span>
                  ))}
                </div>
                {data?.notes && (
                  <p className="mt-1 font-sans text-[11px] text-app-muted">{data.notes}</p>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone: 'bio' | 'quantum' | 'purple';
}) {
  const toneClass =
    tone === 'bio' ? 'text-bio-300' : tone === 'quantum' ? 'text-quantum-300' : 'text-purple-300';
  return (
    <div className="rounded-lg border border-app-subtle bg-black/30 p-3 backdrop-blur">
      <div className="flex items-center gap-1.5">
        <Sparkles className={cn('h-3 w-3', toneClass)} />
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
          {label}
        </span>
      </div>
      <div className={cn('mt-1 font-display text-2xl font-bold tabular-nums', toneClass)}>
        {value}
      </div>
      <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-app-faint">
        {sub}
      </div>
    </div>
  );
}
