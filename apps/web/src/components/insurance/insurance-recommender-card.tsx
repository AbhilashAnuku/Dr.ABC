import { Card, cn } from '@dr-abc/ui';
import { Coins, HeartPulse, ShieldCheck, Sparkles, Stethoscope } from 'lucide-react';
import { useMemo } from 'react';
import { type PersonaForRecommendation, recommendInsurance } from '../../lib/insurance-plans.ts';
import type { ConditionEntry, MedicalRecord } from '../../lib/medical-record.ts';

/**
 * InsuranceRecommenderCard -- Morbius compares the German statutory +
 * private plans against the patient's medical profile and surfaces the
 * top-3 with a fit score + rationale.
 *
 * Helps the user choose the right health insurance plan, surfacing
 * real plans alongside appointment booking with a doctor or insurance
 * provider.
 *
 * Inputs
 * - record: the patient's MedicalRecord (or null on first sign-up).
 *
 * Inference
 * - hasChronicCondition: any active condition flag in the record
 * - mentalHealthPriority: any F-code condition
 * - travelsInternationally: false by default (not yet tracked in record)
 * - ageYears: derived from birthDate, default 35 when missing
 * - conditionCodes: ICD-10s of every active condition
 *
 * Output: three InsurancePlan cards with score bars + rationale lines.
 * Click "More info" -> opens the plan's website in a new tab. Pure
 * read-only -- the picker does NOT change the user's insurance field.
 * The user sets it manually in the Profile form.
 */

function ageFromBirthDate(birth: string | undefined | null): number {
  if (!birth) return 35;
  const d = new Date(birth);
  if (Number.isNaN(d.getTime())) return 35;
  const diffMs = Date.now() - d.getTime();
  return Math.max(0, Math.floor(diffMs / (365.25 * 24 * 60 * 60 * 1000)));
}

function isChronic(c: ConditionEntry): boolean {
  return c.status === 'active' || c.status === 'remission';
}

function isMentalHealth(c: ConditionEntry): boolean {
  return (c.icd10 ?? '').toUpperCase().startsWith('F');
}

function personaFromRecord(record: MedicalRecord | null): PersonaForRecommendation {
  if (!record) {
    return {
      ageYears: 35,
      hasChronicCondition: false,
      prefersTelehealth: true,
      mentalHealthPriority: false,
      travelsInternationally: false,
      conditionCodes: [],
    };
  }
  const conditions = record.conditions ?? [];
  return {
    ageYears: ageFromBirthDate(record.birthDate),
    hasChronicCondition: conditions.some(isChronic),
    prefersTelehealth: true,
    mentalHealthPriority: conditions.some(isMentalHealth),
    travelsInternationally: false,
    conditionCodes: conditions.map((c) => c.icd10).filter((s): s is string => !!s),
  };
}

const PLAN_TIER_COLOUR: Record<'statutory' | 'private', { ring: string; chip: string }> = {
  statutory: { ring: 'border-bio-500/30', chip: 'bg-bio-500/15 text-bio-300' },
  private: { ring: 'border-purple-500/30', chip: 'bg-purple-500/15 text-purple-300' },
};

export function InsuranceRecommenderCard({ record }: { record: MedicalRecord | null }) {
  const persona = useMemo(() => personaFromRecord(record), [record]);
  const top3 = useMemo(() => recommendInsurance(persona), [persona]);

  return (
    <Card className="p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.32em] text-quantum-300">
            <ShieldCheck className="h-3 w-3" /> · insurance · Mörbius picks
          </div>
          <h2 className="mt-1 font-display text-xl font-bold text-app-primary">
            Best-fit health plans for your profile.
          </h2>
          <p className="mt-1 font-sans text-xs text-app-muted">
            Scored on specialist access · mental-health depth · chronic-disease support · dental +
            vision · international cover · cost. ICD-10 codes in your record bias the ranking.
          </p>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        {top3.map((entry, i) => {
          const { plan, fitScore, rationale } = entry;
          const tone = PLAN_TIER_COLOUR[plan.planType];
          const pct = Math.round(fitScore * 100);
          return (
            <div
              key={plan.id}
              className={cn(
                'flex flex-col gap-2 rounded-xl border bg-white/2 p-3 transition hover:-translate-y-0.5 hover:bg-white/[0.05]',
                tone.ring,
                i === 0 ? 'shadow-[0_0_30px_-15px_rgba(56,189,248,0.55)]' : '',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 font-display text-sm font-semibold text-app-primary">
                  <Stethoscope className="h-3.5 w-3.5 text-app-faint" />
                  {plan.name}
                </span>
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.22em]',
                    tone.chip,
                  )}
                >
                  {plan.planType}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <div className="h-1 w-full overflow-hidden rounded-full bg-app-subtle/30">
                  <div
                    className={cn(
                      'h-full transition-all',
                      i === 0 ? 'bg-bio-400' : 'bg-quantum-400',
                    )}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="font-mono text-[10px] tabular-nums text-app-secondary">
                  {pct}%
                </span>
              </div>

              <ul className="space-y-1 font-sans text-[11px] text-app-muted">
                {rationale.slice(0, 3).map((r) => (
                  <li key={r} className="flex items-start gap-1">
                    <Sparkles className="mt-0.5 h-2.5 w-2.5 shrink-0 text-bio-400" />
                    <span>{r}</span>
                  </li>
                ))}
              </ul>

              <div className="grid grid-cols-2 gap-1 border-t border-app-subtle pt-2 font-mono text-[10px] tabular-nums text-app-faint">
                <div className="flex items-center gap-1">
                  <HeartPulse className="h-2.5 w-2.5" />
                  <span>{plan.specialistWaitDays}d wait</span>
                </div>
                <div className="flex items-center gap-1 justify-end">
                  <Coins className="h-2.5 w-2.5" />
                  <span>
                    {plan.planType === 'statutory'
                      ? `${plan.contributionPct?.toFixed(1)}%`
                      : `€${plan.monthlyEur}/mo`}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
        Synthetic plan numbers · current rates from GKV-Spitzenverband / insurer offer sheets
      </p>
    </Card>
  );
}
