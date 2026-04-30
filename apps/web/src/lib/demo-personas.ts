/**
 * demo-personas — five pre-seeded patient identities for the
 * defense demo. Each carries a full FHIR-shaped medical record +
 * a few seeded consult-history entries so reviewers see a realistic
 * patient using Mörbius daily, not an empty new-account.
 *
 * Each demo account carries complete, end-to-end medical records
 * (type 2 diabetes, cancer, PCOS, and more) so the accounts read like
 * real patients using Mörbius to manage their health.
 *
 * Five personas:
 *   1. arjun       T2DM · 52M · daily insulin + metformin · BP control
 *   2. priya       PCOS · 28F · cycle tracking + hormonal mgmt
 *   3. mariana     Breast-CA in remission · 47F · post-surgical surveillance
 *   4. felix       Post-MI cardiac rehab · 61M · DAPT + statin
 *   5. zoe         Healthy young adult · 24F · annual check-in
 *
 * A real-name identity created via the standard sign-up flow is the
 * 6th implicit identity — it is not seeded here; it is registered at
 * /signup.
 *
 * Security note: every persona is ENTIRELY FICTIONAL. No PHI here.
 * Every name + dob + mrn is invented. AGENTS.md §8 prohibits PHI in
 * the repo and these comply.
 */

import type { MedicalRecord } from './medical-record.ts';

export type DemoPersonaId = 'arjun' | 'priya' | 'mariana' | 'felix' | 'zoe';

export interface DemoPersona {
  id: DemoPersonaId;
  /** Title-cased label for UI. */
  label: string;
  /** Short tagline shown under the icon. */
  tagline: string;
  /** Single-emoji avatar — keeps the picker compact. */
  glyph: string;
  /** Login email for the demo flow. Stored, never sent off-device. */
  email: string;
  /** Tone the avatar should pick (clinical / warm / cautious). */
  toneHint: 'reassuring' | 'clinical' | 'empathetic' | 'conversational';
  /** Recommended voice preset — auto-selected on persona sign-in.
   *  Defaults to whatever the user already had if undefined. */
  recommendedVoicePreset?:
    | 'aria'
    | 'vera'
    | 'nova'
    | 'daniel'
    | 'davis'
    | 'atlas'
    | 'morbius'
    | 'echo';
  record: MedicalRecord;
  /** Latest measured vitals — populates the left panel of /app/clinic
   *  + /app/scribe so the demo opens "patient is already in the room",
   *  not "fill out a blank form first." */
  seededVitals: {
    hrBpm: string;
    systolic: string;
    diastolic: string;
    spo2Pct: string;
    tempC: string;
    rrPerMin: string;
  };
  /** Today's chief complaint — opens the consult chat with this primed
   *  in the input so the demo flow can be sent in one click. */
  seededChiefComplaint: string;
  /** Pre-seeded consult-history entries for the dashboard recent list. */
  seededConsults: Array<{
    id: string;
    daysAgo: number;
    complaint: string;
    topCondition?: string;
    topProb?: number;
    specialty?: string;
    modelUsed?: string;
    prescriptionIssued: boolean;
    elapsedSec: number;
  }>;
}

const today = (offsetDays = 0): string => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};

// ────────────────────────────────────────────────────────────────────
//  1 · Arjun · T2DM long-term management
// ────────────────────────────────────────────────────────────────────
const arjunRecord: MedicalRecord = {
  userId: 'usr_demo_arjun',
  fullName: 'Arjun Mehra',
  preferredName: 'Arjun',
  birthDate: '1973-08-14',
  sex: 'M',
  bloodType: 'B+',
  weightKg: '82',
  heightCm: '174',
  phone: '+49 711 4444 0001',
  emergencyContactName: 'Kavya Mehra (spouse)',
  emergencyContactPhone: '+49 711 4444 0002',
  address: 'Stuttgart-Mitte, Germany',
  smoker: 'never',
  alcohol: 'occasional',
  exerciseFrequency: '3× / week · brisk walking 30 min',
  insurancePayor: 'AOK Baden-Württemberg',
  insurancePlan: 'Standard',
  insuranceMemberId: 'AOK-DE-7740-9842',
  allergies: [
    {
      id: 'a-arj-1',
      substance: 'Sulfa drugs',
      severity: 'moderate',
      reaction: 'urticaria',
    },
  ],
  conditions: [
    {
      id: 'c-arj-1',
      display: 'Type 2 diabetes mellitus, with diabetic polyneuropathy',
      icd10: 'E11.42',
      status: 'active',
      onsetDate: '2017-03-22',
      notes: 'Diagnosed at routine check-up · A1c 8.7 % at dx; latest 7.1 %.',
    },
    {
      id: 'c-arj-2',
      display: 'Essential hypertension',
      icd10: 'I10',
      status: 'active',
      onsetDate: '2019-06-10',
    },
    {
      id: 'c-arj-3',
      display: 'Mixed hyperlipidaemia',
      icd10: 'E78.2',
      status: 'active',
      onsetDate: '2019-06-10',
    },
  ],
  medications: [
    {
      id: 'm-arj-1',
      drug: 'Metformin',
      dose: '1000 mg',
      frequency: 'BID',
      startedOn: '2017-04-01',
    },
    {
      id: 'm-arj-2',
      drug: 'Insulin glargine (Lantus)',
      dose: '24 units',
      frequency: 'qHS subcutaneous',
      startedOn: '2021-09-15',
    },
    { id: 'm-arj-3', drug: 'Ramipril', dose: '5 mg', frequency: 'qDay', startedOn: '2019-06-15' },
    {
      id: 'm-arj-4',
      drug: 'Atorvastatin',
      dose: '40 mg',
      frequency: 'qHS',
      startedOn: '2019-06-15',
    },
    {
      id: 'm-arj-5',
      drug: 'Empagliflozin',
      dose: '10 mg',
      frequency: 'qDay',
      startedOn: '2023-01-10',
    },
  ],
  immunizations: [
    { id: 'i-arj-1', vaccine: 'Influenza (annual)', date: '2025-10-12' },
    { id: 'i-arj-2', vaccine: 'Pneumococcal PPSV23', date: '2024-04-08' },
    { id: 'i-arj-3', vaccine: 'COVID-19 booster', date: '2025-11-22' },
  ],
  familyHistory: [
    { id: 'f-arj-1', relationship: 'father', condition: 'Type 2 diabetes', ageAtDiagnosis: '49' },
    {
      id: 'f-arj-2',
      relationship: 'mother',
      condition: 'Coronary artery disease',
      ageAtDiagnosis: '62',
    },
  ],
  notes:
    'Long-term T2DM under good control. Mörbius has been tracking morning glucose, weekly A1c trend, foot exam quarterly.',
  updatedAt: Date.now(),
};

// ────────────────────────────────────────────────────────────────────
//  2 · Priya · PCOS / hormonal management
// ────────────────────────────────────────────────────────────────────
const priyaRecord: MedicalRecord = {
  userId: 'usr_demo_priya',
  fullName: 'Priya Sharma',
  preferredName: 'Priya',
  birthDate: '1997-12-03',
  sex: 'F',
  bloodType: 'O+',
  weightKg: '71',
  heightCm: '163',
  phone: '+49 711 4444 0003',
  emergencyContactName: 'Anita Sharma (sister)',
  emergencyContactPhone: '+49 711 4444 0004',
  address: 'Stuttgart-West, Germany',
  smoker: 'never',
  alcohol: 'occasional',
  exerciseFrequency: '4× / week · yoga + Pilates',
  insurancePayor: 'Techniker Krankenkasse',
  insurancePlan: 'Standard',
  insuranceMemberId: 'TK-DE-3318-2701',
  allergies: [],
  conditions: [
    {
      id: 'c-pri-1',
      display: 'Polycystic ovary syndrome (Rotterdam criteria)',
      icd10: 'E28.2',
      status: 'active',
      onsetDate: '2019-11-04',
      notes:
        'Diagnosed at age 21 · oligomenorrhoea + biochemical hyperandrogenism + polycystic ovaries on US.',
    },
    {
      id: 'c-pri-2',
      display: 'Insulin resistance (subclinical)',
      icd10: 'E88.81',
      status: 'active',
      onsetDate: '2020-02-18',
    },
    {
      id: 'c-pri-3',
      display: 'Acne vulgaris',
      icd10: 'L70.0',
      status: 'remission',
      onsetDate: '2020-02-18',
    },
  ],
  medications: [
    {
      id: 'm-pri-1',
      drug: 'Combined oral contraceptive (drospirenone / EE)',
      dose: '3 mg / 30 µg',
      frequency: 'qDay',
      startedOn: '2020-03-15',
    },
    { id: 'm-pri-2', drug: 'Metformin', dose: '500 mg', frequency: 'BID', startedOn: '2022-08-01' },
    {
      id: 'm-pri-3',
      drug: 'Inositol (myo + d-chiro 40:1)',
      dose: '2 g',
      frequency: 'BID',
      startedOn: '2024-06-12',
    },
  ],
  immunizations: [
    { id: 'i-pri-1', vaccine: 'HPV (Gardasil-9)', date: '2018-04-22' },
    { id: 'i-pri-2', vaccine: 'COVID-19 booster', date: '2025-11-09' },
  ],
  familyHistory: [
    { id: 'f-pri-1', relationship: 'mother', condition: 'PCOS', ageAtDiagnosis: '23' },
    {
      id: 'f-pri-2',
      relationship: 'paternal aunt',
      condition: 'Type 2 diabetes',
      ageAtDiagnosis: '44',
    },
  ],
  notes:
    'Cycle tracking via the dashboard · last LMP 18 d ago · regular cycles since starting COC. Weight stable at 71 kg.',
  updatedAt: Date.now(),
};

// ────────────────────────────────────────────────────────────────────
//  3 · Mariana · Breast cancer in remission · post-surgical surveillance
// ────────────────────────────────────────────────────────────────────
const marianaRecord: MedicalRecord = {
  userId: 'usr_demo_mariana',
  fullName: 'Mariana Costa',
  preferredName: 'Mariana',
  birthDate: '1978-04-29',
  sex: 'F',
  bloodType: 'A+',
  weightKg: '64',
  heightCm: '167',
  phone: '+49 711 4444 0005',
  emergencyContactName: 'Tomás Costa (husband)',
  emergencyContactPhone: '+49 711 4444 0006',
  address: 'Stuttgart-Vaihingen, Germany',
  smoker: 'former',
  alcohol: 'none',
  exerciseFrequency: '5× / week · walking + light resistance',
  insurancePayor: 'Barmer GEK',
  insurancePlan: 'Standard',
  insuranceMemberId: 'BARMER-DE-8810-4423',
  allergies: [
    {
      id: 'a-mar-1',
      substance: 'Penicillin',
      severity: 'severe',
      reaction: 'anaphylaxis (1992)',
    },
  ],
  conditions: [
    {
      id: 'c-mar-1',
      display: 'Malignant neoplasm of breast, upper-outer quadrant (left)',
      icd10: 'C50.412',
      status: 'remission',
      onsetDate: '2021-08-17',
      notes:
        'Stage IIA invasive ductal carcinoma · ER+/PR+/HER2− · BCS + SLNB 2021-09-04 · adjuvant RT 2021-11→12 · adjuvant tamoxifen ongoing.',
    },
    {
      id: 'c-mar-2',
      display: 'Personal history of malignant neoplasm of breast',
      icd10: 'Z85.3',
      status: 'active',
      onsetDate: '2022-01-15',
    },
    {
      id: 'c-mar-3',
      display: 'Hot flushes (treatment-related)',
      icd10: 'N95.1',
      status: 'active',
      onsetDate: '2022-04-02',
    },
  ],
  medications: [
    { id: 'm-mar-1', drug: 'Tamoxifen', dose: '20 mg', frequency: 'qDay', startedOn: '2021-12-20' },
    {
      id: 'm-mar-2',
      drug: 'Calcium + Vitamin D3',
      dose: '600 mg / 800 IU',
      frequency: 'qDay',
      startedOn: '2022-01-10',
    },
    {
      id: 'm-mar-3',
      drug: 'Venlafaxine',
      dose: '37.5 mg',
      frequency: 'qDay',
      startedOn: '2022-05-14',
    },
  ],
  immunizations: [
    { id: 'i-mar-1', vaccine: 'Influenza (annual)', date: '2025-09-30' },
    { id: 'i-mar-2', vaccine: 'COVID-19 booster', date: '2025-10-15' },
  ],
  familyHistory: [
    {
      id: 'f-mar-1',
      relationship: 'mother',
      condition: 'Breast cancer (postmenopausal)',
      ageAtDiagnosis: '58',
    },
    {
      id: 'f-mar-2',
      relationship: 'maternal grandmother',
      condition: 'Ovarian cancer',
      ageAtDiagnosis: '64',
    },
  ],
  notes:
    'BRCA1/2 negative (germline panel 2021-10). Surveillance: annual mammogram + breast MRI alternating every 6 months. Next mammogram due in 4 weeks.',
  updatedAt: Date.now(),
};

// ────────────────────────────────────────────────────────────────────
//  4 · Felix · Post-MI cardiac rehab
// ────────────────────────────────────────────────────────────────────
const felixRecord: MedicalRecord = {
  userId: 'usr_demo_felix',
  fullName: 'Felix Brandt',
  preferredName: 'Felix',
  birthDate: '1964-02-08',
  sex: 'M',
  bloodType: 'A-',
  weightKg: '88',
  heightCm: '178',
  phone: '+49 711 4444 0007',
  emergencyContactName: 'Lena Brandt (daughter)',
  emergencyContactPhone: '+49 711 4444 0008',
  address: 'Stuttgart-Bad Cannstatt, Germany',
  smoker: 'former',
  alcohol: 'occasional',
  exerciseFrequency: 'cardiac-rehab program · 4× / week · supervised',
  insurancePayor: 'AOK Baden-Württemberg',
  insurancePlan: 'Premium',
  insuranceMemberId: 'AOK-DE-6602-3315',
  allergies: [],
  conditions: [
    {
      id: 'c-fel-1',
      display: 'Anterior ST-elevation myocardial infarction (recent)',
      icd10: 'I21.09',
      status: 'resolved',
      onsetDate: '2025-12-18',
      notes:
        'Door-to-balloon 47 min · primary PCI to proximal LAD · drug-eluting stent. EF 42 % at discharge.',
    },
    {
      id: 'c-fel-2',
      display: 'Atherosclerotic heart disease of native coronary artery',
      icd10: 'I25.10',
      status: 'active',
      onsetDate: '2025-12-18',
    },
    {
      id: 'c-fel-3',
      display: 'Essential hypertension',
      icd10: 'I10',
      status: 'active',
      onsetDate: '2018-01-14',
    },
    {
      id: 'c-fel-4',
      display: 'Mixed hyperlipidaemia',
      icd10: 'E78.2',
      status: 'active',
      onsetDate: '2018-01-14',
    },
  ],
  medications: [
    {
      id: 'm-fel-1',
      drug: 'Aspirin',
      dose: '100 mg',
      frequency: 'qDay (lifelong)',
      startedOn: '2025-12-19',
    },
    {
      id: 'm-fel-2',
      drug: 'Ticagrelor',
      dose: '90 mg',
      frequency: 'BID (12 months DAPT)',
      startedOn: '2025-12-19',
    },
    {
      id: 'm-fel-3',
      drug: 'Atorvastatin',
      dose: '80 mg',
      frequency: 'qHS',
      startedOn: '2025-12-19',
    },
    { id: 'm-fel-4', drug: 'Metoprolol succinate', dose: '50 mg', frequency: 'qDay' },
    { id: 'm-fel-5', drug: 'Ramipril', dose: '5 mg', frequency: 'qDay' },
  ],
  immunizations: [
    { id: 'i-fel-1', vaccine: 'Influenza (annual)', date: '2025-09-15' },
    { id: 'i-fel-2', vaccine: 'COVID-19 booster', date: '2025-11-04' },
  ],
  familyHistory: [
    {
      id: 'f-fel-1',
      relationship: 'father',
      condition: 'Acute MI (fatal at 67)',
      ageAtDiagnosis: '67',
    },
    {
      id: 'f-fel-2',
      relationship: 'brother',
      condition: 'CABG ×3',
      ageAtDiagnosis: '58',
    },
  ],
  notes:
    'Recovering well · 2 months post-PCI · LDL on target · BP 124/78 · weight down 4 kg via cardiac rehab. Mörbius prompts daily medication confirmation + weekly weight log.',
  updatedAt: Date.now(),
};

// ────────────────────────────────────────────────────────────────────
//  5 · Zoe · Healthy young adult · annual check-in
// ────────────────────────────────────────────────────────────────────
const zoeRecord: MedicalRecord = {
  userId: 'usr_demo_zoe',
  fullName: 'Zoe Lindgren',
  preferredName: 'Zoe',
  birthDate: '2001-07-21',
  sex: 'F',
  bloodType: 'O+',
  weightKg: '58',
  heightCm: '169',
  phone: '+49 711 4444 0009',
  emergencyContactName: 'Mira Lindgren (mother)',
  emergencyContactPhone: '+49 711 4444 0010',
  address: 'Stuttgart-Süd, Germany',
  smoker: 'never',
  alcohol: 'occasional',
  exerciseFrequency: '5× / week · running 5 km + climbing',
  insurancePayor: 'Techniker Krankenkasse',
  insurancePlan: 'Standard',
  insuranceMemberId: 'TK-DE-9921-1144',
  allergies: [
    {
      id: 'a-zoe-1',
      substance: 'Pollen (birch)',
      severity: 'mild',
      reaction: 'rhinitis',
    },
  ],
  conditions: [
    {
      id: 'c-zoe-1',
      display: 'Allergic rhinitis (seasonal)',
      icd10: 'J30.1',
      status: 'active',
      onsetDate: '2015-04-02',
    },
  ],
  medications: [
    {
      id: 'm-zoe-1',
      drug: 'Loratadine',
      dose: '10 mg',
      frequency: 'qDay (April–June)',
      startedOn: '2015-04-15',
    },
  ],
  immunizations: [
    { id: 'i-zoe-1', vaccine: 'HPV (Gardasil-9)', date: '2014-09-04' },
    { id: 'i-zoe-2', vaccine: 'MMR booster', date: '2014-09-04' },
    { id: 'i-zoe-3', vaccine: 'COVID-19 booster', date: '2025-10-28' },
    { id: 'i-zoe-4', vaccine: 'Influenza (annual)', date: '2025-10-28' },
  ],
  familyHistory: [],
  notes: 'Healthy 24-year-old. Annual check-in. Uses Mörbius for symptom triage + nutrition Q&A.',
  updatedAt: Date.now(),
};

// ────────────────────────────────────────────────────────────────────

export const DEMO_PERSONAS: DemoPersona[] = [
  {
    id: 'arjun',
    label: 'Arjun · Type 2 diabetes',
    tagline: '52 M · daily glucose + insulin · Mörbius coaches',
    glyph: '🩺',
    email: 'arjun.mehra@dr-abc.local',
    toneHint: 'reassuring',
    recommendedVoicePreset: 'davis', // American warm — explains things twice
    record: arjunRecord,
    seededVitals: {
      hrBpm: '78',
      systolic: '136',
      diastolic: '84',
      spo2Pct: '98',
      tempC: '36.6',
      rrPerMin: '14',
    },
    seededChiefComplaint:
      'morning fasting glucose was 168 today, slightly higher than usual — should I adjust insulin?',
    seededConsults: [
      {
        id: 'cn_arjun_seed_1',
        daysAgo: 0,
        complaint: 'morning fasting glucose was 168 today, slightly higher than usual',
        topCondition: 'Diabetic glycaemic excursion',
        topProb: 0.68,
        specialty: 'Endocrinology',
        modelUsed: 'nvidia:meta/llama-3.3-70b-instruct',
        prescriptionIssued: false,
        elapsedSec: 42,
      },
      {
        id: 'cn_arjun_seed_2',
        daysAgo: 4,
        complaint:
          'tingling in toes worse at night, want to check it is not the diabetes acting up',
        topCondition: 'Diabetic peripheral neuropathy (worsening)',
        topProb: 0.74,
        specialty: 'Neurology',
        modelUsed: 'nvidia:meta/llama-3.3-70b-instruct',
        prescriptionIssued: true,
        elapsedSec: 87,
      },
      {
        id: 'cn_arjun_seed_3',
        daysAgo: 11,
        complaint: 'A1c result is in — went from 7.4 to 7.1, what next',
        topCondition: 'Improving glycaemic control',
        topProb: 0.91,
        specialty: 'Endocrinology',
        modelUsed: 'anthropic:claude-sonnet-4-6',
        prescriptionIssued: false,
        elapsedSec: 33,
      },
    ],
  },
  {
    id: 'priya',
    label: 'Priya · PCOS',
    tagline: '28 F · cycle + hormonal · Mörbius tracks',
    glyph: '🌸',
    email: 'priya.sharma@dr-abc.local',
    toneHint: 'empathetic',
    recommendedVoicePreset: 'aria', // calm doctor-bedside warmth for hormonal-symptom convos
    record: priyaRecord,
    seededVitals: {
      hrBpm: '74',
      systolic: '118',
      diastolic: '76',
      spo2Pct: '99',
      tempC: '36.4',
      rrPerMin: '14',
    },
    seededChiefComplaint:
      'period was 3 days late but came today, is the inositol working — and should I worry about cycle changes?',
    seededConsults: [
      {
        id: 'cn_priya_seed_1',
        daysAgo: 1,
        complaint: 'period was 3 days late but came today, is the inositol working',
        topCondition: 'PCOS · cycle regularisation in progress',
        topProb: 0.62,
        specialty: 'Endocrinology / GYN',
        modelUsed: 'nvidia:meta/llama-3.3-70b-instruct',
        prescriptionIssued: false,
        elapsedSec: 38,
      },
      {
        id: 'cn_priya_seed_2',
        daysAgo: 6,
        complaint: 'two acne breakouts on chin this week, was clear for 3 months',
        topCondition: 'PCOS-associated hyperandrogenic acne flare',
        topProb: 0.58,
        specialty: 'Dermatology',
        modelUsed: 'nvidia:meta/llama-3.3-70b-instruct',
        prescriptionIssued: false,
        elapsedSec: 51,
      },
      {
        id: 'cn_priya_seed_3',
        daysAgo: 14,
        complaint: 'family history meeting — father just diagnosed with diabetes, am I at risk',
        topCondition: 'PCOS + family history → elevated T2DM risk',
        topProb: 0.83,
        specialty: 'Endocrinology',
        modelUsed: 'anthropic:claude-sonnet-4-6',
        prescriptionIssued: false,
        elapsedSec: 64,
      },
    ],
  },
  {
    id: 'mariana',
    label: 'Mariana · Breast-CA remission',
    tagline: '47 F · 4 yrs post-surgery · surveillance',
    glyph: '🎗️',
    email: 'mariana.costa@dr-abc.local',
    toneHint: 'reassuring',
    recommendedVoicePreset: 'aria', // warm, unhurried — the surveillance-window voice
    record: marianaRecord,
    seededVitals: {
      hrBpm: '72',
      systolic: '122',
      diastolic: '78',
      spo2Pct: '99',
      tempC: '36.7',
      rrPerMin: '14',
    },
    seededChiefComplaint:
      'mammogram is in 4 weeks — what should I track until then? Also some hot flushes again at night.',
    seededConsults: [
      {
        id: 'cn_mariana_seed_1',
        daysAgo: 2,
        complaint: 'mammogram appointment is in 4 weeks — what should I track until then',
        topCondition: 'Routine surveillance · Z85.3',
        topProb: 0.95,
        specialty: 'Oncology',
        modelUsed: 'nvidia:meta/llama-3.3-70b-instruct',
        prescriptionIssued: false,
        elapsedSec: 29,
      },
      {
        id: 'cn_mariana_seed_2',
        daysAgo: 5,
        complaint: 'hot flushes at night again, the venlafaxine helped — should I increase',
        topCondition: 'Tamoxifen-related vasomotor symptoms',
        topProb: 0.72,
        specialty: 'Oncology / GYN',
        modelUsed: 'nvidia:meta/llama-3.3-70b-instruct',
        prescriptionIssued: false,
        elapsedSec: 44,
      },
      {
        id: 'cn_mariana_seed_3',
        daysAgo: 9,
        complaint: 'palpable nodule in left breast at the surgical-scar — concerned',
        topCondition: 'Post-surgical change vs recurrence — escalate',
        topProb: 0.55,
        specialty: 'Oncology',
        modelUsed: 'anthropic:claude-sonnet-4-6',
        prescriptionIssued: false,
        elapsedSec: 92,
      },
    ],
  },
  {
    id: 'felix',
    label: 'Felix · Post-MI rehab',
    tagline: '61 M · 2 mo post-PCI · DAPT',
    glyph: '❤️',
    email: 'felix.brandt@dr-abc.local',
    toneHint: 'clinical',
    recommendedVoicePreset: 'daniel', // British baritone calm for chronic-care + hard-news pacing
    record: felixRecord,
    seededVitals: {
      hrBpm: '64',
      systolic: '124',
      diastolic: '78',
      spo2Pct: '97',
      tempC: '36.5',
      rrPerMin: '15',
    },
    seededChiefComplaint:
      'mild chest tightness this morning while walking up stairs — not the same as before but I want to check.',
    seededConsults: [
      {
        id: 'cn_felix_seed_1',
        daysAgo: 0,
        complaint: 'mild chest tightness this morning while walking up stairs — worried',
        topCondition: 'Atypical chest pain · post-PCI · stable angina vs musculoskeletal',
        topProb: 0.58,
        specialty: 'Cardiology',
        modelUsed: 'nvidia:meta/llama-3.3-70b-instruct',
        prescriptionIssued: false,
        elapsedSec: 71,
      },
      {
        id: 'cn_felix_seed_2',
        daysAgo: 3,
        complaint: 'forgot ticagrelor evening dose, what should I do',
        topCondition: 'Missed DAPT dose · recovery guidance',
        topProb: 0.91,
        specialty: 'Cardiology',
        modelUsed: 'nvidia:meta/llama-3.3-70b-instruct',
        prescriptionIssued: false,
        elapsedSec: 22,
      },
      {
        id: 'cn_felix_seed_3',
        daysAgo: 8,
        complaint: 'cardiac-rehab session — can I push to 7 METs target this week',
        topCondition: 'Exercise-tolerance progression · post-MI',
        topProb: 0.78,
        specialty: 'Cardiology',
        modelUsed: 'nvidia:meta/llama-3.3-70b-instruct',
        prescriptionIssued: false,
        elapsedSec: 38,
      },
    ],
  },
  {
    id: 'zoe',
    label: 'Zoe · healthy 24',
    tagline: '24 F · annual check-in + symptom triage',
    glyph: '🌿',
    email: 'zoe.lindgren@dr-abc.local',
    toneHint: 'conversational',
    recommendedVoicePreset: 'nova', // bright + encouraging for a healthy young adult
    record: zoeRecord,
    seededVitals: {
      hrBpm: '62',
      systolic: '108',
      diastolic: '68',
      spo2Pct: '99',
      tempC: '36.5',
      rrPerMin: '12',
    },
    seededChiefComplaint:
      'sniffles started this week — is this allergies starting early or a cold?',
    seededConsults: [
      {
        id: 'cn_zoe_seed_1',
        daysAgo: 1,
        complaint: 'sniffles started this week — is this allergies starting early or a cold',
        topCondition: 'Seasonal allergic rhinitis · early flare',
        topProb: 0.69,
        specialty: 'Internal medicine',
        modelUsed: 'nvidia:meta/llama-3.3-70b-instruct',
        prescriptionIssued: false,
        elapsedSec: 27,
      },
      {
        id: 'cn_zoe_seed_2',
        daysAgo: 7,
        complaint: 'hit a 5K running PR — what should I focus on for next month',
        topCondition: 'Health-coaching · endurance progression',
        topProb: 0.94,
        specialty: 'General wellness',
        modelUsed: 'nvidia:meta/llama-3.3-70b-instruct',
        prescriptionIssued: false,
        elapsedSec: 48,
      },
    ],
  },
];

export function findPersona(id: string): DemoPersona | null {
  return DEMO_PERSONAS.find((p) => p.id === id) ?? null;
}

/**
 * True when the given user-id matches one of the seeded demo personas
 * (T2DM / PCOS / cancer-remission / post-MI / healthy). Used by the
 * sidebar + AppShell to hide developer-only surfaces (dev console ·
 * neural core · api-keys · architecture) when a patient persona is
 * signed in. A sign-up-flow identity is NOT a persona, so it sees the
 * full developer surface.
 */
export function isPatientPersona(userId: string | undefined | null): boolean {
  if (!userId) return false;
  return DEMO_PERSONAS.some((p) => userId === `usr_demo_${p.id}`);
}
