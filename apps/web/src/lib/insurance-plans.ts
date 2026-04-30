/**
 * insurance-plans -- German statutory + private health plans with their
 * coverage shape. Powers Mörbius's "help me choose a health plan" path
 * and the appointments-page insurance filter.
 *
 * Numbers below are realistic but synthetic. Real plan parameters change
 * yearly and per-region; nothing here is a substitute for current rates
 * pulled from GKV-Spitzenverband (statutory) or each private insurer's
 * offer sheet (private). The Mörbius UI surfaces a disclaimer to that
 * effect.
 *
 * Why a separate lib (not just hard-coded in the route)
 *   - The `german-clinicians.ts` directory references plan IDs for
 *     `acceptsInsurance`. Single source of truth keeps the two in sync.
 *   - The recommendation function (`recommendInsurance`) is plain TS so
 *     it can be reused server-side (orchestrator) or in a worker.
 *   - The demo-personas data already names AOK / Techniker / Barmer --
 *     this file is the catalogue those choices reference.
 */
import type { InsurancePlanId } from './german-clinicians.ts';

export type { InsurancePlanId } from './german-clinicians.ts';

export type PlanType = 'statutory' | 'private';

export interface InsurancePlan {
  id: InsurancePlanId;
  name: string;
  /** GKV (statutory) vs PKV (private). */
  planType: PlanType;
  /** Monthly base contribution as % of gross salary (statutory) or flat
   *  premium estimate in EUR (private, single 35-year-old healthy
   *  reference). */
  contributionPct?: number;
  monthlyEur?: number;
  /** Typical waiting time to see a specialist, in days. Lower = better. */
  specialistWaitDays: number;
  /** Per-visit co-pay in EUR (statutory plans use the 10 EUR/quarter
   *  Praxisgebühr model; private plans typically zero). */
  coPayEur: number;
  /** Annual out-of-pocket cap (statutory) or deductible (private). */
  annualCapEur: number;
  /** Dental coverage tier: standard | enhanced | premium. */
  dental: 'standard' | 'enhanced' | 'premium';
  /** Vision: glasses subsidy in EUR / 2 years. */
  visionEurPer2Y: number;
  /** Mental-health sessions covered per year (CBT-grade). */
  mentalHealthSessionsPerYear: number;
  /** International coverage rating (1..5). */
  international: number;
  /** Family / dependents coverage. */
  familyIncluded: boolean;
  /** Mörbius confidence the plan suits the average German resident. */
  morbiusGeneralFitScore: number;
  /** Free-form caveats Mörbius surfaces in the recommendation prose. */
  notes: string;
}

export const INSURANCE_PLANS: InsurancePlan[] = [
  {
    id: 'aok-bw',
    name: 'AOK Baden-Württemberg',
    planType: 'statutory',
    contributionPct: 15.7,
    specialistWaitDays: 14,
    coPayEur: 10,
    annualCapEur: 280,
    dental: 'standard',
    visionEurPer2Y: 100,
    mentalHealthSessionsPerYear: 26,
    international: 3,
    familyIncluded: true,
    morbiusGeneralFitScore: 0.78,
    notes:
      'Strong primary-care + paediatrics network in BW. Specialist wait can stretch in Stuttgart-Mitte; book early for cardiology + endocrinology.',
  },
  {
    id: 'techniker',
    name: 'Techniker Krankenkasse (TK)',
    planType: 'statutory',
    contributionPct: 15.8,
    specialistWaitDays: 11,
    coPayEur: 10,
    annualCapEur: 280,
    dental: 'enhanced',
    visionEurPer2Y: 180,
    mentalHealthSessionsPerYear: 30,
    international: 4,
    familyIncluded: true,
    morbiusGeneralFitScore: 0.85,
    notes:
      'Best digital-first experience (TK-App), strong mental-health network, and the widest telehealth reimbursement in the GKV. Slightly above average contribution.',
  },
  {
    id: 'barmer',
    name: 'Barmer GEK',
    planType: 'statutory',
    contributionPct: 16.1,
    specialistWaitDays: 13,
    coPayEur: 10,
    annualCapEur: 280,
    dental: 'standard',
    visionEurPer2Y: 130,
    mentalHealthSessionsPerYear: 26,
    international: 3,
    familyIncluded: true,
    morbiusGeneralFitScore: 0.74,
    notes:
      'Long-standing reputation for oncology surveillance and survivorship support. Highest contribution among the four big statutories.',
  },
  {
    id: 'dak',
    name: 'DAK-Gesundheit',
    planType: 'statutory',
    contributionPct: 16.2,
    specialistWaitDays: 15,
    coPayEur: 10,
    annualCapEur: 280,
    dental: 'standard',
    visionEurPer2Y: 110,
    mentalHealthSessionsPerYear: 24,
    international: 3,
    familyIncluded: true,
    morbiusGeneralFitScore: 0.7,
    notes:
      'Solid coverage; chronic-care programs (T2DM, COPD) are well-organised. Specialist wait similar to AOK.',
  },
  {
    id: 'bkk-mobil',
    name: 'BKK Mobil Oil',
    planType: 'statutory',
    contributionPct: 15.4,
    specialistWaitDays: 12,
    coPayEur: 10,
    annualCapEur: 280,
    dental: 'enhanced',
    visionEurPer2Y: 160,
    mentalHealthSessionsPerYear: 26,
    international: 3,
    familyIncluded: true,
    morbiusGeneralFitScore: 0.82,
    notes:
      'Lowest GKV contribution in this cohort, with a surprisingly strong dental + vision tier. Smaller network of premium clinics.',
  },
  {
    id: 'kkh',
    name: 'KKH Kaufmännische Krankenkasse',
    planType: 'statutory',
    contributionPct: 16.4,
    specialistWaitDays: 14,
    coPayEur: 10,
    annualCapEur: 280,
    dental: 'standard',
    visionEurPer2Y: 120,
    mentalHealthSessionsPerYear: 25,
    international: 3,
    familyIncluded: true,
    morbiusGeneralFitScore: 0.69,
    notes: 'Standard statutory coverage; rebate program for active prevention (gym, swim, run).',
  },
  {
    id: 'private',
    name: 'PKV · Allianz / Debeka tier',
    planType: 'private',
    monthlyEur: 480,
    specialistWaitDays: 3,
    coPayEur: 0,
    annualCapEur: 800,
    dental: 'premium',
    visionEurPer2Y: 600,
    mentalHealthSessionsPerYear: 50,
    international: 5,
    familyIncluded: false,
    morbiusGeneralFitScore: 0.66,
    notes:
      'Fast specialist access, premium hospital rooms, full vision + dental. Eligibility limited (high income or civil service); premiums rise with age and are not refundable if you switch back to GKV.',
  },
];

export interface PersonaForRecommendation {
  ageYears: number;
  hasChronicCondition: boolean;
  prefersTelehealth: boolean;
  mentalHealthPriority: boolean;
  travelsInternationally: boolean;
  /** Optional ICD-10 codes that bias the recommendation (e.g. F41.1 -> mental health, E11.* -> chronic). */
  conditionCodes?: string[];
}

export interface InsuranceRecommendation {
  plan: InsurancePlan;
  fitScore: number;
  rationale: string[];
}

/**
 * Score every plan against a persona and return the top-3.
 *
 * The score is a weighted sum:
 *   0.30 * specialist-access (faster wait -> higher score)
 *   0.20 * mental-health depth (sessions/year, capped at 30)
 *   0.20 * chronic-disease support (Mörbius general fit)
 *   0.10 * dental + vision tier
 *   0.10 * international coverage
 *   0.10 * cost (lower contribution -> higher score)
 *
 * Mörbius surfaces the top-3 in `/app/appointments` and on the
 * dashboard "compare plans" card. The weights can be tuned via a
 * future tune queue entry (the deterministic refiner picks up json
 * proposals in docs/status/tune-clinical-review-*.json).
 */
export function recommendInsurance(p: PersonaForRecommendation): InsuranceRecommendation[] {
  const codeBoost = (plan: InsurancePlan): number => {
    if (!p.conditionCodes?.length) return 0;
    let boost = 0;
    // PCOS / endocrine -> Techniker (best digital coaching + mental health)
    if (p.conditionCodes.some((c) => c.startsWith('E28') || c.startsWith('E11'))) {
      if (plan.id === 'techniker') boost += 0.05;
      if (plan.id === 'aok-bw') boost += 0.02;
    }
    // Oncology surveillance -> Barmer (historical strength)
    if (p.conditionCodes.some((c) => c.startsWith('C') || c.startsWith('Z85'))) {
      if (plan.id === 'barmer') boost += 0.04;
    }
    // Mental health -> Techniker or private
    if (p.conditionCodes.some((c) => c.startsWith('F'))) {
      if (plan.id === 'techniker') boost += 0.03;
      if (plan.id === 'private') boost += 0.05;
    }
    return boost;
  };

  return INSURANCE_PLANS.map((plan) => {
    const waitScore = Math.max(0, 1 - plan.specialistWaitDays / 30); // 30+ days -> 0
    const mhScore = Math.min(1, plan.mentalHealthSessionsPerYear / 30);
    const chronicScore = plan.morbiusGeneralFitScore;
    const dentalVision =
      (plan.dental === 'premium' ? 1 : plan.dental === 'enhanced' ? 0.7 : 0.4) * 0.6 +
      Math.min(1, plan.visionEurPer2Y / 400) * 0.4;
    const intl = plan.international / 5;
    const cost =
      plan.planType === 'statutory'
        ? Math.max(0, 1 - ((plan.contributionPct ?? 16) - 15) / 2)
        : Math.max(0, 1 - ((plan.monthlyEur ?? 500) - 300) / 500);

    let score =
      0.3 * waitScore +
      (p.mentalHealthPriority ? 0.3 : 0.15) * mhScore +
      (p.hasChronicCondition ? 0.25 : 0.1) * chronicScore +
      0.1 * dentalVision +
      (p.travelsInternationally ? 0.15 : 0.05) * intl +
      0.1 * cost +
      codeBoost(plan);

    score = Math.max(0, Math.min(1, score));

    const rationale: string[] = [];
    if (plan.specialistWaitDays <= 8) rationale.push('fast specialist access');
    if (p.mentalHealthPriority && plan.mentalHealthSessionsPerYear >= 26) {
      rationale.push('full mental-health coverage');
    }
    if (p.hasChronicCondition && plan.morbiusGeneralFitScore >= 0.8) {
      rationale.push('strong chronic-disease programs');
    }
    if (plan.planType === 'private' && p.ageYears < 35) {
      rationale.push('low entry premium for under-35 healthy applicants');
    }
    if (plan.planType === 'statutory' && plan.contributionPct && plan.contributionPct <= 15.7) {
      rationale.push('below-average contribution rate');
    }
    if (rationale.length === 0) rationale.push('solid baseline coverage');

    return { plan, fitScore: score, rationale };
  })
    .sort((a, b) => b.fitScore - a.fitScore)
    .slice(0, 3);
}

export function findPlanById(id: InsurancePlanId): InsurancePlan | undefined {
  return INSURANCE_PLANS.find((p) => p.id === id);
}
