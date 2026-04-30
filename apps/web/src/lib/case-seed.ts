/**
 * case-seed — populate Mörbius's per-user memory with 15 synthetic
 * historical consults on first sign-in.
 *
 * Why? A fresh user has an empty IndexedDB, which means the brain
 * map shows no cluster activity, the clinic memory pillar surfaces
 * zero recalls, and the dashboard recent-consults strip is bare.
 * That makes the demo land flat. Seeding 15 well-shaped cases gives
 * Mörbius a real history to surface from turn one.
 *
 * Contract:
 *
 *   - Idempotent: a sentinel localStorage key (`dr-abc:case-seed:<userId>:v1`)
 *     records that we've seeded this user; subsequent calls are no-ops.
 *   - Non-destructive: never deletes existing memory entries.
 *   - Cheap: ~150 ms total (15 × IndexedDB put with TF embedding).
 *   - Versioned: bumping `SEED_VERSION` re-seeds (legacy entries stay).
 *
 * Source-of-truth case list lives in `docs/vault/clinical/case-history.md`. Keep
 * the two in lock-step.
 */

import { saveTranscript } from './consult-transcript.ts';
import { storeMemory } from './morbius-memory.ts';

// Bumped from 1 → 2 in v0.7 to attach a deterministic consultId to
// each seeded MemoryEntry plus a synthetic 3-turn transcript, so
// "Mörbius resume" works on day 1 without the user having to finish
// a live consult first. Existing v1 entries are preserved; v2 just
// adds new ones with the consultId field populated.
const SEED_VERSION = 2;
const SENTINEL_PREFIX = 'dr-abc:case-seed';

export interface SeedCase {
  /** Stable id from docs/vault/clinical/case-history.md (C001…C015). */
  id: string;
  chiefComplaint: string;
  diagnosis: string;
  icd10: string;
  specialty: string;
  drugs: string[];
  outcome: string;
  /** Approximate days-ago to back-date the memory entry — surfaces a
   *  realistic "you saw this 3 weeks ago" recall string. */
  daysAgo: number;
}

export const SEED_CASES: readonly SeedCase[] = [
  {
    id: 'C001',
    chiefComplaint:
      'Crushing substernal chest pain for 30 minutes radiating to left arm and jaw, diaphoretic and nauseous',
    diagnosis: 'Acute ST-elevation MI · anterior wall',
    icd10: 'I21.0',
    specialty: 'Cardiology',
    drugs: ['Aspirin', 'Ticagrelor', 'Heparin'],
    outcome: 'Door-to-balloon 74 min · TIMI 3 flow restored · uneventful 48h CCU stay',
    daysAgo: 92,
  },
  {
    id: 'C002',
    chiefComplaint:
      'Throbbing left-sided headache for 6 hours with photophobia and nausea, no aura',
    diagnosis: 'Migraine without aura',
    icd10: 'G43.909',
    specialty: 'Neurology',
    drugs: ['Sumatriptan', 'Acetaminophen'],
    outcome: 'Pain 8/10 to 2/10 at 2 hours · returned to work same day',
    daysAgo: 71,
  },
  {
    id: 'C003',
    chiefComplaint:
      '8-year-old male with sore throat for 2 days and fever 39.1C, no cough, tender anterior cervical nodes',
    diagnosis: 'Group A strep pharyngitis',
    icd10: 'J02.0',
    specialty: 'Pediatrics',
    drugs: ['Amoxicillin'],
    outcome: 'Fever resolved at 48 hours · no rheumatic complications',
    daysAgo: 64,
  },
  {
    id: 'C004',
    chiefComplaint: 'Dysuria and urinary urgency for 2 days, no flank pain, no fever',
    diagnosis: 'Uncomplicated cystitis',
    icd10: 'N39.0',
    specialty: 'Internal medicine',
    drugs: ['Nitrofurantoin'],
    outcome: 'Symptom-free at 72 hours · no recurrence at 1 month',
    daysAgo: 58,
  },
  {
    id: 'C005',
    chiefComplaint: 'Wheeze, dyspnea and chest tightness for 4 hours, mildly toxic-looking',
    diagnosis: 'Acute asthma exacerbation',
    icd10: 'J45.901',
    specialty: 'Pulmonology',
    drugs: ['Albuterol MDI', 'Prednisone'],
    outcome: 'SpO2 97% at discharge · PEFR 380 L/min at 1-week follow-up',
    daysAgo: 50,
  },
  {
    id: 'C006',
    chiefComplaint: 'Polyuria, polydipsia, 5 kg weight loss over 6 weeks, blurred vision',
    diagnosis: 'Type 2 diabetes with hyperglycaemia',
    icd10: 'E11.65',
    specialty: 'Endocrinology',
    drugs: ['Metformin'],
    outcome: 'A1c 7.1% at 3 months · no hypoglycaemia events',
    daysAgo: 44,
  },
  {
    id: 'C007',
    chiefComplaint: 'Routine annual physical, asymptomatic, BP 162/98 confirmed on 3 readings',
    diagnosis: 'Essential hypertension stage 2',
    icd10: 'I10',
    specialty: 'Cardiology',
    drugs: ['Lisinopril'],
    outcome: 'BP 132/82 at 6 weeks · creatinine stable · no ACE-i cough',
    daysAgo: 38,
  },
  {
    id: 'C008',
    chiefComplaint:
      'Burning chest pain post-meals and acid regurgitation for 4 weeks, no alarm features',
    diagnosis: 'Gastro-oesophageal reflux disease',
    icd10: 'K21.0',
    specialty: 'Internal medicine',
    drugs: ['Omeprazole'],
    outcome: 'Symptom-free at 2 weeks · no H. pylori workup needed',
    daysAgo: 31,
  },
  {
    id: 'C009',
    chiefComplaint: 'Palpitations and fatigue for 12 hours, irregularly irregular pulse, HR 138',
    diagnosis: 'Atrial fibrillation new-onset · CHADS-VASc 4',
    icd10: 'I48.0',
    specialty: 'Cardiology',
    drugs: ['Apixaban', 'Metoprolol'],
    outcome: 'Sinus rhythm restored at 4 weeks via DCCV · no bleed',
    daysAgo: 27,
  },
  {
    id: 'C010',
    chiefComplaint: 'Productive cough for 5 days with low-grade fever and mild chest discomfort',
    diagnosis: 'Acute viral bronchitis',
    icd10: 'J20.9',
    specialty: 'Pulmonology',
    drugs: [],
    outcome: 'Cough resolved at 10 days · no antibiotics needed',
    daysAgo: 22,
  },
  {
    id: 'C011',
    chiefComplaint: 'Persistent worry and sleep disruption for 6 months with intermittent panic',
    diagnosis: 'Generalized anxiety disorder',
    icd10: 'F41.1',
    specialty: 'Psychiatry',
    drugs: ['Sertraline'],
    outcome: 'GAD-7 16 to 7 at 12 weeks · CBT engaged · no SSRI side effects',
    daysAgo: 18,
  },
  {
    id: 'C012',
    chiefComplaint: 'Fatigue, 3 kg weight gain and cold intolerance over 3 months',
    diagnosis: 'Primary hypothyroidism',
    icd10: 'E03.9',
    specialty: 'Endocrinology',
    drugs: ['Levothyroxine'],
    outcome: 'TSH 2.4 at 8 weeks · symptoms resolved · annual monitoring',
    daysAgo: 14,
  },
  {
    id: 'C013',
    chiefComplaint:
      'RLQ abdominal pain migrating from periumbilical, anorexia, low-grade fever for 18 hours',
    diagnosis: 'Acute appendicitis',
    icd10: 'K35.80',
    specialty: 'Surgery',
    drugs: ['Cefoxitin'],
    outcome: 'Discharged POD1 · no complications · back to training in 4 weeks',
    daysAgo: 10,
  },
  {
    id: 'C014',
    chiefComplaint: '4-year-old male with right ear pain and fever for 36 hours, tugging at ear',
    diagnosis: 'Acute otitis media',
    icd10: 'H66.92',
    specialty: 'Pediatrics',
    drugs: ['Amoxicillin'],
    outcome: 'Afebrile at 48 hours · TM normal at 2 weeks',
    daysAgo: 6,
  },
  {
    id: 'C015',
    chiefComplaint: 'Right shin redness, warmth and swelling for 3 days following a minor abrasion',
    diagnosis: 'Non-purulent cellulitis',
    icd10: 'L03.116',
    specialty: 'Dermatology',
    drugs: ['Cephalexin'],
    outcome: 'Erythema regressed inside marked border at 48 hours · resolved at 7 days',
    daysAgo: 3,
  },
];

function sentinelKey(userId: string): string {
  return `${SENTINEL_PREFIX}:${userId}:v${SEED_VERSION}`;
}

export function isSeeded(userId: string): boolean {
  if (typeof window === 'undefined') return true;
  return window.localStorage.getItem(sentinelKey(userId)) === 'true';
}

function markSeeded(userId: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(sentinelKey(userId), 'true');
  } catch {
    // localStorage quota or disabled — silently skip the sentinel
    // (next call will re-seed but storeMemory uses unique IDs so we
    // get duplicates rather than corruption).
  }
}

/**
 * Mark this user as seeded without writing any cases. Used by the
 * "Reset memory" action so the next sign-in doesn't repopulate the
 * 15 demo cases — Mörbius starts from a blank slate.
 */
export function skipSeedForUser(userId: string): void {
  markSeeded(userId);
}

/**
 * Seed the demo cases for `userId` if not already done. Safe to call
 * multiple times; the sentinel guards against duplicate writes.
 *
 * Returns the number of cases actually written (0 when already seeded
 * or when IndexedDB is unavailable).
 */
export async function seedCaseHistory(userId: string): Promise<number> {
  if (!userId) return 0;
  if (isSeeded(userId)) return 0;

  let written = 0;
  for (const c of SEED_CASES) {
    try {
      // Deterministic consultId per seed case so this stays stable
      // across re-seeds and matches the transcript stored below.
      const consultId = `seed_${c.id}`;
      await storeMemory({
        userId,
        chiefComplaint: c.chiefComplaint,
        diagnosis: c.diagnosis,
        icd10: c.icd10,
        specialty: c.specialty,
        drugs: c.drugs,
        outcome: c.outcome,
        source: 'consult',
        consultId,
      });
      // Synthetic transcript so "Mörbius resume" lands on a real
      // conversation (3 turns: greeting · patient complaint · summary).
      // The transcript is back-dated to match the memory's daysAgo so
      // the timeline stays coherent.
      const startedAt = Date.now() - c.daysAgo * 24 * 60 * 60 * 1000;
      saveTranscript(userId, consultId, [
        {
          id: `${consultId}_t0`,
          role: 'mörbius',
          ts: startedAt,
          text: 'Welcome back. Walk me through what brought you in today.',
        },
        {
          id: `${consultId}_t1`,
          role: 'patient',
          ts: startedAt + 5_000,
          text: c.chiefComplaint,
        },
        {
          id: `${consultId}_t2`,
          role: 'mörbius',
          ts: startedAt + 12_000,
          text: `Working diagnosis: ${c.diagnosis} (${c.icd10}). Plan: ${c.drugs.join(' · ') || 'supportive care'}. ${c.outcome}`,
        },
      ]);
      written++;
    } catch {
      // IndexedDB blocked or unavailable — bail without the sentinel
      // so the next sign-in can try again.
      return written;
    }
  }

  markSeeded(userId);

  // v0.7 day-1 KG seed — best-effort POST so neural-core renders the
  // demo mesh on first sign-in instead of an empty Fibonacci sphere.
  // Idempotent server-side (mergeGraph keys by sourceHash) so re-runs
  // never duplicate; if the api is unreachable we just skip — the user
  // can run scripts/research-cycle.ts later for the full pipeline.
  void seedKnowledgeGraph().catch(() => {
    // intentional swallow — KG seed is decorative, not load-bearing
  });

  return written;
}

async function seedKnowledgeGraph(): Promise<void> {
  const base = (import.meta.env.VITE_API_BASE_URL ?? '/api').toString();
  const cases = SEED_CASES.map((c) => ({
    consultId: `seed_${c.id}`,
    complaint: c.chiefComplaint,
    topCondition: c.diagnosis,
    differentials: [{ condition: c.diagnosis, probability: 0.82, icd10: c.icd10 }],
    specialty: c.specialty,
    drugs: c.drugs,
  }));
  await fetch(`${base}/knowledge-graph/seed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cases }),
  });
}

/** Test-only helper: clear the sentinel so a subsequent call re-seeds. */
export function _resetSeedSentinelForTests(userId: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(sentinelKey(userId));
}
