/**
 * @dr-abc/db seed -- populate Postgres with the demo persistence layer.
 *
 * What lands:
 *   - 5 demo personas as app_user + patient + condition + allergy + coverage
 *   - 15 case_library entries (the synthetic seed cases)
 *   - sample imaging_analysis rows (1 normal + 1 with findings)
 *   - sample consult_analysis rows tied to the persona seeded consults
 *
 * Idempotent: every insert uses ON CONFLICT DO UPDATE so re-runs are safe.
 *
 * Privacy:
 *   - All personas are explicitly fictional (CLAUDE.md S 8).
 *   - userId stored on activity-side tables is the pseudonymous form
 *     `usr_demo_<persona-id>`, not raw email.
 *   - Passwords are argon2id-hashed (Bun.password.hash).
 *
 * Run via:
 *   bun run db:seed
 *
 * Requires DATABASE_URL pointing at a Postgres reachable by drizzle.
 */
import {
  allergyIntolerance,
  appUser,
  caseLibrary,
  condition,
  consultAnalysis,
  coverage,
  imagingAnalysis,
  patient,
} from './schema.ts';

// pg + drizzle-orm/node-postgres are optional peer deps of drizzle-orm —
// same lazy-import pattern as apps/api/src/activity-sink.ts so the
// monorepo typechecks without a hard pg dep. The seed CLI exits with a
// clear error if the runtime install is missing pg.
type PoolCtor = new (cfg: { connectionString: string; max?: number }) => {
  end(): Promise<void>;
};
type DrizzleCtor = (pool: unknown) => DrizzleDb;
interface DrizzleDb {
  insert(table: unknown): {
    values(row: Record<string, unknown>): {
      onConflictDoUpdate(opts: {
        target: unknown;
        set: Record<string, unknown>;
      }): Promise<unknown>;
      onConflictDoNothing(): Promise<unknown>;
    };
  };
}

async function loadPgDriver(databaseUrl: string): Promise<{
  db: DrizzleDb;
  close: () => Promise<void>;
} | null> {
  // pg / drizzle-orm/node-postgres are optional peers of drizzle-orm.
  // CI does NOT install them by default (would force an updated lockfile);
  // @ts-ignore suppresses the resulting TS2307. Runtime catch(() => null)
  // returns a clear error when pg is missing.
  // @ts-ignore optional peer dep
  const pgMod = (await import('pg').catch(() => null)) as { Pool: PoolCtor } | null;
  // @ts-ignore optional peer dep
  const drizzleMod = (await import('drizzle-orm/node-postgres').catch(() => null)) as {
    drizzle: DrizzleCtor;
  } | null;
  if (!pgMod || !drizzleMod) return null;
  const pool = new pgMod.Pool({ connectionString: databaseUrl, max: 4 });
  return { db: drizzleMod.drizzle(pool), close: () => pool.end() };
}

// ---------------------------------------------------------------
//  Demo personas (mirrors apps/web/src/lib/demo-personas.ts so the
//  web client and the database stay in lock-step).
// ---------------------------------------------------------------

interface PersonaSeed {
  id: string;
  email: string;
  displayName: string;
  /** Demo-mode default password -- any 6+ char string is accepted by the
   *  argon2id verifier; we still hash so the column never holds plaintext. */
  password: string;
  birthDate: string;
  gender: 'male' | 'female' | 'other';
  locale: string;
  payor: string;
  payorMemberId: string;
  conditions: Array<{
    icd10: string;
    display: string;
    clinicalStatus: 'active' | 'remission' | 'resolved' | 'inactive';
    onsetDateTime: string;
    severity?: 'mild' | 'moderate' | 'severe';
  }>;
  allergies: Array<{
    substance: string;
    severity: 'mild' | 'moderate' | 'severe';
    reaction: string;
    category: 'food' | 'medication' | 'environment' | 'biologic';
  }>;
  seededConsults: Array<{
    consultId: string;
    daysAgo: number;
    chiefComplaint: string;
    topCondition: string;
    topProb: number;
    icd10?: string;
    specialty: string;
    modelUsed: string;
    prescriptionIssued: boolean;
    elapsedSec: number;
  }>;
}

const PERSONAS: PersonaSeed[] = [
  {
    id: 'arjun',
    email: 'arjun.mehra@dr-abc.local',
    displayName: 'Arjun Mehra',
    password: 'demo-arjun-2026',
    birthDate: '1973-08-14',
    gender: 'male',
    locale: 'en',
    payor: 'AOK Baden-Württemberg',
    payorMemberId: 'AOK-DE-7740-9842',
    conditions: [
      {
        icd10: 'E11.42',
        display: 'Type 2 diabetes mellitus, with diabetic polyneuropathy',
        clinicalStatus: 'active',
        onsetDateTime: '2017-03-22T00:00:00Z',
        severity: 'moderate',
      },
      {
        icd10: 'I10',
        display: 'Essential hypertension',
        clinicalStatus: 'active',
        onsetDateTime: '2019-06-10T00:00:00Z',
      },
      {
        icd10: 'E78.2',
        display: 'Mixed hyperlipidaemia',
        clinicalStatus: 'active',
        onsetDateTime: '2019-06-10T00:00:00Z',
      },
    ],
    allergies: [
      {
        substance: 'Sulfa drugs',
        severity: 'moderate',
        reaction: 'urticaria',
        category: 'medication',
      },
    ],
    seededConsults: [
      {
        consultId: 'cn_arjun_seed_1',
        daysAgo: 0,
        chiefComplaint: 'morning fasting glucose was 168 today, slightly higher than usual',
        topCondition: 'Diabetic glycaemic excursion',
        topProb: 0.68,
        icd10: 'E11.65',
        specialty: 'Endocrinology',
        modelUsed: 'nvidia:meta/llama-3.3-70b-instruct',
        prescriptionIssued: false,
        elapsedSec: 42,
      },
      {
        consultId: 'cn_arjun_seed_2',
        daysAgo: 4,
        chiefComplaint:
          'tingling in toes worse at night, want to check it is not the diabetes acting up',
        topCondition: 'Diabetic peripheral neuropathy (worsening)',
        topProb: 0.74,
        icd10: 'E11.42',
        specialty: 'Neurology',
        modelUsed: 'nvidia:meta/llama-3.3-70b-instruct',
        prescriptionIssued: true,
        elapsedSec: 87,
      },
    ],
  },
  {
    id: 'priya',
    email: 'priya.sharma@dr-abc.local',
    displayName: 'Priya Sharma',
    password: 'demo-priya-2026',
    birthDate: '1997-12-03',
    gender: 'female',
    locale: 'en',
    payor: 'Techniker Krankenkasse',
    payorMemberId: 'TK-DE-3318-2701',
    conditions: [
      {
        icd10: 'E28.2',
        display: 'Polycystic ovary syndrome',
        clinicalStatus: 'active',
        onsetDateTime: '2019-11-04T00:00:00Z',
      },
    ],
    allergies: [],
    seededConsults: [
      {
        consultId: 'cn_priya_seed_1',
        daysAgo: 1,
        chiefComplaint: 'period was 3 days late but came today, is the inositol working',
        topCondition: 'PCOS cycle regularisation in progress',
        topProb: 0.62,
        icd10: 'E28.2',
        specialty: 'Endocrinology',
        modelUsed: 'nvidia:meta/llama-3.3-70b-instruct',
        prescriptionIssued: false,
        elapsedSec: 38,
      },
    ],
  },
  {
    id: 'mariana',
    email: 'mariana.costa@dr-abc.local',
    displayName: 'Mariana Costa',
    password: 'demo-mariana-2026',
    birthDate: '1978-04-29',
    gender: 'female',
    locale: 'en',
    payor: 'Barmer GEK',
    payorMemberId: 'BARMER-DE-8810-4423',
    conditions: [
      {
        icd10: 'Z85.3',
        display: 'Personal history of malignant neoplasm of breast',
        clinicalStatus: 'active',
        onsetDateTime: '2022-01-15T00:00:00Z',
      },
      {
        icd10: 'C50.412',
        display: 'Malignant neoplasm of breast, upper-outer quadrant (left)',
        clinicalStatus: 'remission',
        onsetDateTime: '2021-08-17T00:00:00Z',
      },
    ],
    allergies: [
      {
        substance: 'Penicillin',
        severity: 'severe',
        reaction: 'anaphylaxis (1992)',
        category: 'medication',
      },
    ],
    seededConsults: [
      {
        consultId: 'cn_mariana_seed_1',
        daysAgo: 2,
        chiefComplaint: 'mammogram appointment is in 4 weeks -- what should I track until then',
        topCondition: 'Routine surveillance',
        topProb: 0.95,
        icd10: 'Z85.3',
        specialty: 'Oncology',
        modelUsed: 'nvidia:meta/llama-3.3-70b-instruct',
        prescriptionIssued: false,
        elapsedSec: 29,
      },
    ],
  },
  {
    id: 'felix',
    email: 'felix.brandt@dr-abc.local',
    displayName: 'Felix Brandt',
    password: 'demo-felix-2026',
    birthDate: '1964-02-08',
    gender: 'male',
    locale: 'en',
    payor: 'AOK Baden-Württemberg',
    payorMemberId: 'AOK-DE-6602-3315',
    conditions: [
      {
        icd10: 'I25.10',
        display: 'Atherosclerotic heart disease of native coronary artery',
        clinicalStatus: 'active',
        onsetDateTime: '2025-12-18T00:00:00Z',
      },
      {
        icd10: 'I21.09',
        display: 'Anterior ST-elevation myocardial infarction (recent)',
        clinicalStatus: 'resolved',
        onsetDateTime: '2025-12-18T00:00:00Z',
      },
    ],
    allergies: [],
    seededConsults: [
      {
        consultId: 'cn_felix_seed_1',
        daysAgo: 0,
        chiefComplaint: 'mild chest tightness this morning while walking up stairs -- worried',
        topCondition: 'Atypical chest pain post-PCI',
        topProb: 0.58,
        icd10: 'I25.10',
        specialty: 'Cardiology',
        modelUsed: 'nvidia:meta/llama-3.3-70b-instruct',
        prescriptionIssued: false,
        elapsedSec: 71,
      },
    ],
  },
  {
    id: 'zoe',
    email: 'zoe.lindgren@dr-abc.local',
    displayName: 'Zoe Lindgren',
    password: 'demo-zoe-2026',
    birthDate: '2001-07-21',
    gender: 'female',
    locale: 'en',
    payor: 'Techniker Krankenkasse',
    payorMemberId: 'TK-DE-9921-1144',
    conditions: [
      {
        icd10: 'J30.1',
        display: 'Allergic rhinitis (seasonal)',
        clinicalStatus: 'active',
        onsetDateTime: '2015-04-02T00:00:00Z',
      },
    ],
    allergies: [
      {
        substance: 'Pollen (birch)',
        severity: 'mild',
        reaction: 'rhinitis',
        category: 'environment',
      },
    ],
    seededConsults: [
      {
        consultId: 'cn_zoe_seed_1',
        daysAgo: 1,
        chiefComplaint: 'sniffles started this week -- is this allergies starting early or a cold',
        topCondition: 'Seasonal allergic rhinitis early flare',
        topProb: 0.69,
        icd10: 'J30.1',
        specialty: 'Internal medicine',
        modelUsed: 'nvidia:meta/llama-3.3-70b-instruct',
        prescriptionIssued: false,
        elapsedSec: 27,
      },
    ],
  },
];

// ---------------------------------------------------------------
//  Case library -- mirrors apps/web/src/lib/case-seed.ts SEED_CASES.
//  Keep the IDs (C001..C015) and chief complaints aligned so the web
//  client's per-user IndexedDB seed can deduplicate against the
//  global library if needed.
// ---------------------------------------------------------------

interface CaseSeed {
  id: string;
  chiefComplaint: string;
  diagnosis: string;
  icd10: string;
  specialty: string;
  severity: 'low' | 'moderate' | 'high' | 'critical';
  drugs: string[];
  outcome: string;
}

const CASE_LIBRARY_SEED: CaseSeed[] = [
  {
    id: 'C001',
    chiefComplaint:
      'Crushing substernal chest pain for 30 minutes radiating to left arm and jaw, diaphoretic and nauseous',
    diagnosis: 'Acute ST-elevation MI -- anterior wall',
    icd10: 'I21.0',
    specialty: 'Cardiology',
    severity: 'critical',
    drugs: ['Aspirin', 'Ticagrelor', 'Heparin'],
    outcome: 'Door-to-balloon 74 min -- TIMI 3 flow restored -- uneventful 48h CCU stay',
  },
  {
    id: 'C002',
    chiefComplaint:
      'Throbbing left-sided headache for 6 hours with photophobia and nausea, no aura',
    diagnosis: 'Migraine without aura',
    icd10: 'G43.909',
    specialty: 'Neurology',
    severity: 'moderate',
    drugs: ['Sumatriptan', 'Acetaminophen'],
    outcome: 'Pain 8/10 to 2/10 at 2 hours -- returned to work same day',
  },
  {
    id: 'C003',
    chiefComplaint:
      '8-year-old male with sore throat for 2 days and fever 39.1C, no cough, tender anterior cervical nodes',
    diagnosis: 'Group A strep pharyngitis',
    icd10: 'J02.0',
    specialty: 'Pediatrics',
    severity: 'moderate',
    drugs: ['Amoxicillin'],
    outcome: 'Fever resolved at 48 hours -- no rheumatic complications',
  },
  {
    id: 'C004',
    chiefComplaint: 'Dysuria and urinary urgency for 2 days, no flank pain, no fever',
    diagnosis: 'Uncomplicated cystitis',
    icd10: 'N39.0',
    specialty: 'Internal medicine',
    severity: 'low',
    drugs: ['Nitrofurantoin'],
    outcome: 'Symptom-free at 72 hours -- no recurrence at 1 month',
  },
  {
    id: 'C005',
    chiefComplaint: 'Wheeze, dyspnea and chest tightness for 4 hours, mildly toxic-looking',
    diagnosis: 'Acute asthma exacerbation',
    icd10: 'J45.901',
    specialty: 'Pulmonology',
    severity: 'high',
    drugs: ['Albuterol MDI', 'Prednisone'],
    outcome: 'SpO2 97% at discharge -- PEFR 380 L/min at 1-week follow-up',
  },
  {
    id: 'C006',
    chiefComplaint: 'Polyuria, polydipsia, 5 kg weight loss over 6 weeks, blurred vision',
    diagnosis: 'Type 2 diabetes with hyperglycaemia',
    icd10: 'E11.65',
    specialty: 'Endocrinology',
    severity: 'moderate',
    drugs: ['Metformin'],
    outcome: 'A1c 7.1% at 3 months -- no hypoglycaemia events',
  },
  {
    id: 'C007',
    chiefComplaint: 'Routine annual physical, asymptomatic, BP 162/98 confirmed on 3 readings',
    diagnosis: 'Essential hypertension stage 2',
    icd10: 'I10',
    specialty: 'Cardiology',
    severity: 'moderate',
    drugs: ['Lisinopril'],
    outcome: 'BP 132/82 at 6 weeks -- creatinine stable -- no ACE-i cough',
  },
  {
    id: 'C008',
    chiefComplaint:
      'Burning chest pain post-meals and acid regurgitation for 4 weeks, no alarm features',
    diagnosis: 'Gastro-oesophageal reflux disease',
    icd10: 'K21.0',
    specialty: 'Internal medicine',
    severity: 'low',
    drugs: ['Omeprazole'],
    outcome: 'Symptom-free at 2 weeks -- no H. pylori workup needed',
  },
  {
    id: 'C009',
    chiefComplaint: 'Palpitations and fatigue for 12 hours, irregularly irregular pulse, HR 138',
    diagnosis: 'Atrial fibrillation new-onset',
    icd10: 'I48.0',
    specialty: 'Cardiology',
    severity: 'high',
    drugs: ['Apixaban', 'Metoprolol'],
    outcome: 'Sinus rhythm restored at 4 weeks via DCCV -- no bleed',
  },
  {
    id: 'C010',
    chiefComplaint: 'Productive cough for 5 days with low-grade fever and mild chest discomfort',
    diagnosis: 'Acute viral bronchitis',
    icd10: 'J20.9',
    specialty: 'Pulmonology',
    severity: 'low',
    drugs: [],
    outcome: 'Cough resolved at 10 days -- no antibiotics needed',
  },
  {
    id: 'C011',
    chiefComplaint: 'Persistent worry and sleep disruption for 6 months with intermittent panic',
    diagnosis: 'Generalized anxiety disorder',
    icd10: 'F41.1',
    specialty: 'Psychiatry',
    severity: 'moderate',
    drugs: ['Sertraline'],
    outcome: 'GAD-7 16 to 7 at 12 weeks -- CBT engaged -- no SSRI side effects',
  },
  {
    id: 'C012',
    chiefComplaint: 'Fatigue, 3 kg weight gain and cold intolerance over 3 months',
    diagnosis: 'Primary hypothyroidism',
    icd10: 'E03.9',
    specialty: 'Endocrinology',
    severity: 'low',
    drugs: ['Levothyroxine'],
    outcome: 'TSH 2.4 at 8 weeks -- symptoms resolved -- annual monitoring',
  },
  {
    id: 'C013',
    chiefComplaint:
      'RLQ abdominal pain migrating from periumbilical, anorexia, low-grade fever for 18 hours',
    diagnosis: 'Acute appendicitis',
    icd10: 'K35.80',
    specialty: 'Surgery',
    severity: 'high',
    drugs: ['Cefoxitin'],
    outcome: 'Discharged POD1 -- no complications -- back to training in 4 weeks',
  },
  {
    id: 'C014',
    chiefComplaint: '4-year-old male with right ear pain and fever for 36 hours, tugging at ear',
    diagnosis: 'Acute otitis media',
    icd10: 'H66.92',
    specialty: 'Pediatrics',
    severity: 'low',
    drugs: ['Amoxicillin'],
    outcome: 'Afebrile at 48 hours -- TM normal at 2 weeks',
  },
  {
    id: 'C015',
    chiefComplaint: 'Right shin redness, warmth and swelling for 3 days following a minor abrasion',
    diagnosis: 'Non-purulent cellulitis',
    icd10: 'L03.116',
    specialty: 'Dermatology',
    severity: 'moderate',
    drugs: ['Cephalexin'],
    outcome: 'Erythema regressed inside marked border at 48 hours -- resolved at 7 days',
  },
];

// ---------------------------------------------------------------
//  Sample imaging analyses -- one normal + one with findings, both
//  belonging to Felix (post-MI persona) so the imaging route demos
//  the cardiac surveillance arc.
// ---------------------------------------------------------------

const IMAGING_SEED = [
  {
    id: 'img_seed_felix_cxr_normal',
    userId: 'usr_demo_felix',
    consultId: 'cn_felix_seed_1',
    modality: 'xray' as const,
    bodyRegion: 'chest',
    stage: 'roboflow' as const,
    verdict: 'normal' as const,
    findings: [
      { label: 'no acute cardiopulmonary process', confidence: 0.91 },
      { label: 'heart size within normal limits', confidence: 0.87 },
    ],
    payload: {
      model: 'roboflow/chest-xray-v3',
      verdictRationale: 'No focal consolidation, no pneumothorax, mediastinum stable post-PCI.',
    },
    latencyMs: 384,
  },
  {
    id: 'img_seed_zoe_skin_findings',
    userId: 'usr_demo_zoe',
    consultId: 'cn_zoe_seed_1',
    modality: 'dermatoscope' as const,
    bodyRegion: 'skin-forearm',
    stage: 'claude-vision' as const,
    verdict: 'possible-findings' as const,
    findings: [
      {
        label: 'benign nevus -- compound',
        confidence: 0.78,
        bbox: [42, 58, 110, 132] as [number, number, number, number],
      },
      { label: 'symmetric pigment network', confidence: 0.83 },
    ],
    payload: {
      model: 'claude-sonnet-4-6:vision',
      verdictRationale:
        'Symmetric pigment network, no chaos or asymmetry. Routine f/u in 12 months.',
    },
    latencyMs: 1820,
  },
];

// ---------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------

async function argon2Hash(password: string): Promise<string> {
  // Bun.password.hash is available at runtime. Fall back to a stub when
  // running in non-Bun environments (e.g. node test runner).
  const bunPassword = (
    globalThis as { Bun?: { password?: { hash?: (p: string) => Promise<string> } } }
  ).Bun?.password?.hash;
  if (typeof bunPassword === 'function') {
    return bunPassword(password);
  }
  // Fallback only used in pure-node environments (none in production).
  return `$argon2id$stub$${Buffer.from(password).toString('base64')}`;
}

function patientIdHashOf(personaId: string): string {
  // Deterministic hash placeholder. Production hashing happens in the
  // auth middleware where the per-instance pepper lands.
  return `phash_${personaId}_v1`;
}

function nowMinusDays(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

// ---------------------------------------------------------------
//  Main
// ---------------------------------------------------------------

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is required for db:seed');
  }
  const driver = await loadPgDriver(url);
  if (!driver) {
    throw new Error(
      'pg / drizzle-orm/node-postgres not installed -- run `bun add pg @types/pg drizzle-orm/node-postgres` in packages/db',
    );
  }
  const { db, close } = driver;

  console.log('[db:seed] Seeding 5 demo personas + 15 case_library + sample imaging/analysis');

  // ---- personas ----
  for (const p of PERSONAS) {
    const passwordHash = await argon2Hash(p.password);
    const userId = `usr_demo_${p.id}`;
    const patientId = `pat_demo_${p.id}`;
    const patientHash = patientIdHashOf(p.id);

    await db
      .insert(appUser)
      .values({
        id: userId,
        email: p.email,
        passwordHash,
        displayName: p.displayName,
        locale: p.locale,
        patientIdHash: patientHash,
        active: true,
      })
      .onConflictDoUpdate({
        target: appUser.email,
        set: { displayName: p.displayName, patientIdHash: patientHash },
      });

    await db
      .insert(patient)
      .values({
        id: patientId,
        patientIdHash: patientHash,
        displayName: p.displayName,
        gender: p.gender,
        birthDate: p.birthDate,
        active: true,
        preferredLanguage: p.locale === 'de' ? 'de-DE' : 'en-US',
      })
      .onConflictDoUpdate({
        target: patient.id,
        set: { displayName: p.displayName },
      });

    await db
      .insert(coverage)
      .values({
        id: `cov_demo_${p.id}`,
        patientId,
        status: 'active',
        payor: p.payor,
        subscriberId: p.payorMemberId,
      })
      .onConflictDoNothing();

    for (const c of p.conditions) {
      await db
        .insert(condition)
        .values({
          id: `cond_${p.id}_${c.icd10}`,
          patientId,
          clinicalStatus: c.clinicalStatus,
          verificationStatus: 'confirmed',
          code: c.icd10,
          display: c.display,
          severity: c.severity,
          onsetDateTime: new Date(c.onsetDateTime),
        })
        .onConflictDoNothing();
    }

    for (const [idx, a] of p.allergies.entries()) {
      await db
        .insert(allergyIntolerance)
        .values({
          id: `alg_${p.id}_${idx}`,
          patientId,
          clinicalStatus: 'active',
          verificationStatus: 'confirmed',
          category: a.category,
          criticality: a.severity === 'severe' ? 'high' : 'low',
          substance: a.substance,
          reactions: [{ manifestation: a.reaction, severity: a.severity }],
        })
        .onConflictDoNothing();
    }

    for (const c of p.seededConsults) {
      const createdAt = nowMinusDays(c.daysAgo);
      await db
        .insert(consultAnalysis)
        .values({
          consultId: c.consultId,
          userId,
          chiefComplaint: c.chiefComplaint,
          topCondition: c.topCondition,
          topProbX1000: Math.round(c.topProb * 1000),
          icd10: c.icd10,
          specialty: c.specialty,
          differentials: [{ condition: c.topCondition, probability: c.topProb, icd10: c.icd10 }],
          modelUsed: c.modelUsed,
          gauntletPassed: true,
          validatorScoreX1000: 720,
          safetyScoreX1000: 850,
          privacyScoreX1000: 940,
          prescriptionIssued: c.prescriptionIssued,
          elapsedMs: c.elapsedSec * 1000,
          createdAt,
          updatedAt: createdAt,
        })
        .onConflictDoUpdate({
          target: consultAnalysis.consultId,
          set: {
            topCondition: c.topCondition,
            topProbX1000: Math.round(c.topProb * 1000),
            updatedAt: new Date(),
          },
        });
    }
  }

  // ---- case library ----
  for (const c of CASE_LIBRARY_SEED) {
    await db
      .insert(caseLibrary)
      .values({
        id: `lib_${c.id}`,
        scope: 'demo',
        sourceRef: c.id,
        sourceHash: `seedhash_${c.id}`,
        chiefComplaint: c.chiefComplaint,
        diagnosis: c.diagnosis,
        icd10: c.icd10,
        specialty: c.specialty,
        severity: c.severity,
        drugs: c.drugs,
        outcome: c.outcome,
        payload: { source: 'docs/vault/clinical/case-history.md' },
      })
      .onConflictDoUpdate({
        target: caseLibrary.sourceHash,
        set: { diagnosis: c.diagnosis, outcome: c.outcome },
      });
  }

  // ---- imaging ----
  for (const img of IMAGING_SEED) {
    await db
      .insert(imagingAnalysis)
      .values({
        ...img,
        id: img.id,
      })
      .onConflictDoNothing();
  }

  console.log('[db:seed] ok');
  console.log(`[db:seed]   ${PERSONAS.length} personas`);
  console.log(`[db:seed]   ${CASE_LIBRARY_SEED.length} case library entries`);
  console.log(`[db:seed]   ${IMAGING_SEED.length} imaging analyses`);
  console.log(
    `[db:seed]   ${PERSONAS.reduce((acc, p) => acc + p.seededConsults.length, 0)} consult analyses`,
  );

  await close();
}

main().catch((err) => {
  console.error('[db:seed] failed:', err);
  process.exit(1);
});
