import { Card } from '@dr-abc/ui';
import { ExternalLink, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { InsuranceRecommenderCard } from '../components/insurance/insurance-recommender-card.tsx';
import { useAuth } from '../lib/auth.tsx';
import { INSURANCE_PLANS } from '../lib/insurance-plans.ts';
import { type MedicalRecord, loadRecord } from '../lib/medical-record.ts';

/**
 * /app/insurance — Mörbius's German-plan picker.
 *
 * Provides the route backing the sidebar's /app/insurance link. This
 * page lists the German statutory + private plans Mörbius knows about
 * with TS-typed links to each plan's website, plus the
 * InsuranceRecommenderCard that ranks them against the patient's
 * MedicalRecord.
 */
export function InsurancePage() {
  const { user } = useAuth();
  const [record, setRecord] = useState<MedicalRecord | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    setRecord(loadRecord(user.id));
  }, [user?.id]);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="inline-flex items-center gap-2 rounded-full border border-bio-400/40 bg-bio-500/10 px-3 py-1">
          <ShieldCheck className="h-3.5 w-3.5 text-bio-300" />
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-bio-200">
            health plan picker
          </span>
        </div>
        <h1 className="font-display text-2xl font-bold text-app-primary sm:text-3xl">Insurance</h1>
        <p className="max-w-2xl font-grotesk text-sm leading-relaxed text-app-muted sm:text-base">
          Mörbius compares the German statutory and private health plans against your medical record
          + lifestyle to surface the top three. Numbers are realistic but synthetic — for the actual
          contribution rate, pull the current sheet from each insurer.
        </p>
      </header>

      <InsuranceRecommenderCard record={record} />

      <section className="space-y-3">
        <h2 className="font-display text-lg font-semibold text-app-primary">
          All plans Mörbius knows
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {INSURANCE_PLANS.map((p) => (
            <Card key={p.id} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-syne text-sm font-semibold text-app-primary">
                      {p.name}
                    </span>
                    <span
                      className={`rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.22em] ${
                        p.planType === 'statutory'
                          ? 'border-bio-400/40 bg-bio-500/10 text-bio-200'
                          : 'border-purple-400/40 bg-purple-500/10 text-purple-200'
                      }`}
                    >
                      {p.planType === 'statutory' ? 'GKV' : 'PKV'}
                    </span>
                  </div>
                  <p className="mt-1 font-grotesk text-xs leading-relaxed text-app-muted">
                    {p.notes}
                  </p>
                </div>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-app-subtle pt-3 font-mono text-[11px] tabular-nums">
                <dt className="text-app-faint">Contribution</dt>
                <dd className="text-right text-app-primary">
                  {p.contributionPct !== undefined
                    ? `${p.contributionPct.toFixed(1)}%`
                    : p.monthlyEur !== undefined
                      ? `€${p.monthlyEur}/mo`
                      : '—'}
                </dd>
                <dt className="text-app-faint">Specialist wait</dt>
                <dd className="text-right text-app-primary">{p.specialistWaitDays} days</dd>
                <dt className="text-app-faint">Co-pay</dt>
                <dd className="text-right text-app-primary">€{p.coPayEur}</dd>
                <dt className="text-app-faint">Mental-health</dt>
                <dd className="text-right text-app-primary">
                  {p.mentalHealthSessionsPerYear} / yr
                </dd>
                <dt className="text-app-faint">Dental</dt>
                <dd className="text-right text-app-primary">{p.dental}</dd>
                <dt className="text-app-faint">Vision (2y)</dt>
                <dd className="text-right text-app-primary">€{p.visionEurPer2Y}</dd>
              </dl>
              <a
                href={planWebsite(p.id)}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-quantum-300 transition hover:text-quantum-200"
              >
                <ExternalLink className="h-3 w-3" />
                Visit insurer
              </a>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}

/**
 * Plan-id → website map. Typed via the InsurancePlanId type so adding
 * a new plan to insurance-plans.ts forces this map to be updated.
 */
function planWebsite(id: string): string {
  const map: Record<string, string> = {
    'aok-bw': 'https://www.aok.de/pk/bw/',
    techniker: 'https://www.tk.de/',
    barmer: 'https://www.barmer.de/',
    dak: 'https://www.dak.de/',
    'bkk-mobil': 'https://www.bkk-mobil-oil.de/',
    kkh: 'https://www.kkh.de/',
    private: 'https://www.pkv.de/',
  };
  return map[id] ?? 'https://www.gkv-spitzenverband.de/';
}
