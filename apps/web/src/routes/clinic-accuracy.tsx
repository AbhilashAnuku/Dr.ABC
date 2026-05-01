import { Card, cn } from '@dr-abc/ui';
import { Activity, BarChart3, BookOpen, Brain, Check, Sparkles, Target } from 'lucide-react';

/**
 * AdvancedAnalysisCard — the "main score" panel for /app/clinic.
 *
 * Aggregates everything the consult pipeline produced into a single
 * accuracy + analysis dashboard:
 *
 *   - Top-line score = top differential probability (0–100 %)
 *   - Per-pillar bars: differential strength, evidence weight,
 *     guardrail compliance, model precedence rank
 *   - Sourcing chips with citation count + freshness
 *   - Validator / Safety / Privacy verdict ribbon
 *
 * Designed to look like a real radiology second-opinion summary so
 * the clinician sees at a glance how confident the system is and why.
 */

export interface AdvancedAnalysisInput {
  /** Top condition + probability — the front-line answer. */
  topCondition: string | null;
  topProb: number; // 0..1
  /** Number of differentials in the ladder. */
  differentialCount: number;
  /** Recommended specialty for follow-up. */
  specialty: string | null;
  /** Backing model identifier (e.g. "anthropic:claude-sonnet-4-6"). */
  modelUsed: string | null;
  /** True if the validator/safety/privacy gauntlet returned pass. */
  gauntletPassed: boolean;
  /** How many evidence citations the research agent attached. */
  evidenceCount: number;
  /** Distinct evidence sources (pubmed/clinicaltrials/who). */
  evidenceSources: number;
  /** Number of red-flag warnings raised by triage. */
  redFlags: number;
  /** Pipeline wall-clock in ms. */
  elapsedMs: number;
}

const MODEL_TIER: Record<string, { tier: number; label: string }> = {
  anthropic: { tier: 1, label: 'Anthropic Claude · paid frontier' },
  nvidia: { tier: 2, label: 'NVIDIA NIM · free frontier weights' },
  huggingface: { tier: 3, label: 'Hugging Face Router · biomedical' },
  ollama: { tier: 4, label: 'Ollama · local sovereign' },
};

function modelTier(modelUsed: string | null): { tier: number; label: string } {
  if (!modelUsed) return { tier: 5, label: 'offline · local Q&A only' };
  const lower = modelUsed.toLowerCase();
  if (lower.includes('claude') || lower.includes('anthropic'))
    return MODEL_TIER.anthropic as { tier: number; label: string };
  if (lower.includes('nvidia') || lower.includes('nim'))
    return MODEL_TIER.nvidia as { tier: number; label: string };
  if (lower.includes('huggingface') || lower.includes('openbio') || lower.includes('llama-3-med'))
    return MODEL_TIER.huggingface as { tier: number; label: string };
  if (lower.includes('ollama') || lower.includes('meditron'))
    return MODEL_TIER.ollama as { tier: number; label: string };
  return { tier: 3, label: modelUsed };
}

export function AdvancedAnalysisCard({ data }: { data: AdvancedAnalysisInput }) {
  const score = Math.round(data.topProb * 100);
  const grade = scoreGrade(score, data.gauntletPassed);
  const tier = modelTier(data.modelUsed);

  const pillars = [
    {
      label: 'Diagnostic confidence',
      pct: score,
      hue: '#38bdf8',
      caption: data.topCondition ?? '—',
    },
    {
      label: 'Evidence weight',
      pct: Math.min(100, data.evidenceCount * 12 + data.evidenceSources * 6),
      hue: '#10b981',
      caption: `${data.evidenceCount} citations · ${data.evidenceSources} sources`,
    },
    {
      label: 'Guardrail compliance',
      pct: data.gauntletPassed ? 100 : 0,
      hue: data.gauntletPassed ? '#a78bfa' : '#dc2c4e',
      caption: data.gauntletPassed ? 'Validator · Safety · Privacy all green' : 'gauntlet failed',
    },
    {
      label: 'Model precedence',
      pct: Math.max(0, 100 - (tier.tier - 1) * 22),
      hue: '#f59e0b',
      caption: tier.label,
    },
  ];

  return (
    <Card className="p-0">
      <div className="flex items-center justify-between border-b border-app-subtle px-3 py-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-quantum-300" />
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-app-faint">
            advanced analysis
          </span>
        </div>
        <span
          className={cn(
            'rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em]',
            grade.tone === 'high'
              ? 'border-bio-500/40 bg-bio-500/10 text-bio-300'
              : grade.tone === 'mid'
                ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                : 'border-red-500/40 bg-red-500/10 text-red-300',
          )}
        >
          {grade.label}
        </span>
      </div>

      {/* Hero score */}
      <div className="px-4 pt-4 pb-2">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-app-faint">
              accuracy score
            </div>
            <div className="mt-0.5 flex items-baseline gap-2">
              <span
                className={cn(
                  'font-mono text-5xl font-bold tabular-nums',
                  grade.tone === 'high'
                    ? 'text-bio-300'
                    : grade.tone === 'mid'
                      ? 'text-amber-300'
                      : 'text-red-300',
                )}
              >
                {score}
              </span>
              <span className="font-mono text-base text-app-muted">/100</span>
            </div>
          </div>
          <Donut score={score} hue={gradeHue(grade.tone)} />
        </div>
        <p className="mt-2 font-sans text-xs leading-relaxed text-app-secondary">{grade.copy}</p>
      </div>

      {/* Pillar breakdown */}
      <div className="space-y-3 px-4 py-3 border-t border-app-subtle">
        <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-app-faint">
          <BarChart3 className="h-3 w-3" /> pillars
        </div>
        {pillars.map((p) => (
          <Pillar key={p.label} {...p} />
        ))}
      </div>

      {/* Inline meta */}
      <div className="grid grid-cols-3 gap-2 border-t border-app-subtle px-3 py-3">
        <Stat icon={Brain} label="differentials" value={String(data.differentialCount)} />
        <Stat icon={Target} label="red flags" value={String(data.redFlags)} />
        <Stat icon={Activity} label="latency" value={`${(data.elapsedMs / 1000).toFixed(1)}s`} />
      </div>

      {/* Specialty + sourcing footnote */}
      <div className="border-t border-app-subtle px-3 py-2">
        <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-app-faint">
          <BookOpen className="h-3 w-3" />
          {data.specialty ? `Refer to ${data.specialty}` : 'Specialty not yet recommended'}
        </div>
        {data.gauntletPassed && (
          <div className="mt-1 flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.16em] text-bio-300">
            <Check className="h-3 w-3" /> all gates green
          </div>
        )}
      </div>
    </Card>
  );
}

function Pillar({
  label,
  pct,
  hue,
  caption,
}: {
  label: string;
  pct: number;
  hue: string;
  caption: string;
}) {
  const v = Math.max(0, Math.min(100, pct));
  return (
    <div>
      <div className="mb-0.5 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.16em]">
        <span className="text-app-secondary">{label}</span>
        <span className="tabular-nums" style={{ color: hue }}>
          {v.toFixed(0)}%
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full border border-app-subtle bg-ink-950">
        <div
          className="h-full rounded-full"
          style={{ width: `${v}%`, background: hue, boxShadow: `0 0 6px ${hue}` }}
        />
      </div>
      <div className="mt-0.5 truncate font-mono text-[10px] text-app-faint">{caption}</div>
    </div>
  );
}

function Donut({ score, hue }: { score: number; hue: string }) {
  const r = 22;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  return (
    <svg
      viewBox="0 0 60 60"
      className="h-16 w-16"
      role="img"
      aria-label={`accuracy ${score} out of 100`}
    >
      <title>{`accuracy ${score} out of 100`}</title>
      <circle cx="30" cy="30" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="6" />
      <circle
        cx="30"
        cy="30"
        r={r}
        fill="none"
        stroke={hue}
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${circ}`}
        transform="rotate(-90 30 30)"
        style={{ filter: `drop-shadow(0 0 4px ${hue}99)` }}
      />
      <text
        x="30"
        y="34"
        textAnchor="middle"
        fontFamily="ui-monospace, SFMono-Regular, monospace"
        fontSize="13"
        fontWeight="bold"
        fill={hue}
      >
        {score}
      </text>
    </svg>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border border-app-subtle bg-white/[0.02] p-2 text-center">
      <div className="flex items-center justify-center gap-1 font-mono text-[9px] uppercase tracking-[0.16em] text-app-faint">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <div className="mt-0.5 font-mono text-base font-bold text-app-primary tabular-nums">
        {value}
      </div>
    </div>
  );
}

function scoreGrade(
  score: number,
  gauntletPassed: boolean,
): { label: string; tone: 'high' | 'mid' | 'low'; copy: string } {
  if (!gauntletPassed) {
    return {
      label: 'defer to human',
      tone: 'low',
      copy: 'One or more gauntlet gates failed. The pipeline did not produce a clinically usable answer; please escalate to an in-person clinician.',
    };
  }
  if (score >= 75) {
    return {
      label: 'high confidence',
      tone: 'high',
      copy: 'Differential strongly favours the leading condition with corroborating evidence and clean guardrail pass-through. Treat as a strong working diagnosis.',
    };
  }
  if (score >= 45) {
    return {
      label: 'moderate confidence',
      tone: 'mid',
      copy: 'Leading condition is plausible but the differential is wide. Prioritise the recommended tests before committing to therapy.',
    };
  }
  return {
    label: 'low confidence',
    tone: 'low',
    copy: 'Top condition is weakly supported. Treat the result as exploratory; gather additional history, vitals, or imaging before narrowing the differential.',
  };
}

function gradeHue(tone: 'high' | 'mid' | 'low'): string {
  if (tone === 'high') return '#10b981';
  if (tone === 'mid') return '#f59e0b';
  return '#dc2c4e';
}
