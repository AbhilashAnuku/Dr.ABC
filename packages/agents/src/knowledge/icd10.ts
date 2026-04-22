/**
 * icd10 — curated subset of the 2026 ICD-10-CM codeset.
 *
 * The full ICD-10-CM is ~70,000 codes. For Mörbius's offline-safe
 * grounding we only need the high-frequency conditions the demo + the
 * 15 seed cases + the standing-order Rx engine actually touch.
 * Anything not in this table can still be reasoned about by the LLM
 * — this just gives the deterministic side of the brain a real
 * lookup so it can validate / reject hallucinated codes.
 *
 * Source: ICD-10-CM 2026 (CMS official), filtered to chapter heads +
 * the per-specialty top-20 by frequency in primary care + ED settings
 * (HCUP NEDS 2024 baseline).
 *
 * Shape:
 *   - `code` — 3-7 char ICD-10-CM string. We keep dotted format
 *     (`I21.0`) since that's what the LLM emits and what FHIR uses.
 *   - `display` — the human-readable description.
 *   - `chapter` — Roman-numeral chapter (e.g. 'IX' = circulatory).
 *   - `specialty` — routing hint that maps to one of our six
 *     specialist agents (or `general` when no specialist owns it).
 *   - `synonyms` — common spellings the parser should accept.
 */

import type { SpecialtyId } from '../specialists/prompts.ts';

export type Icd10Specialty = SpecialtyId | 'general' | 'pediatrics' | 'psychiatry' | 'surgery';

export interface Icd10Entry {
  code: string;
  display: string;
  chapter: string;
  specialty: Icd10Specialty;
  synonyms?: readonly string[];
}

export const ICD10_TABLE: readonly Icd10Entry[] = [
  // ────────────────────────────────────────────────────────────────
  //  Chapter I — Infectious + parasitic (A00-B99)
  // ────────────────────────────────────────────────────────────────
  {
    code: 'A09',
    display: 'Infectious gastroenteritis',
    chapter: 'I',
    specialty: 'general',
    synonyms: ['gastro', 'stomach bug'],
  },
  {
    code: 'A41.9',
    display: 'Sepsis, unspecified organism',
    chapter: 'I',
    specialty: 'general',
    synonyms: ['sepsis'],
  },
  {
    code: 'A49.9',
    display: 'Bacterial infection, unspecified',
    chapter: 'I',
    specialty: 'general',
  },
  {
    code: 'B34.9',
    display: 'Viral infection, unspecified',
    chapter: 'I',
    specialty: 'general',
    synonyms: ['viral uri', 'viral infection'],
  },
  {
    code: 'B97.29',
    display: 'Other coronavirus as the cause of diseases',
    chapter: 'I',
    specialty: 'general',
    synonyms: ['covid', 'covid-19'],
  },

  // ────────────────────────────────────────────────────────────────
  //  Chapter II — Neoplasms (C00-D49)
  // ────────────────────────────────────────────────────────────────
  {
    code: 'C18.9',
    display: 'Malignant neoplasm of colon, unspecified',
    chapter: 'II',
    specialty: 'oncology',
    synonyms: ['colon cancer'],
  },
  {
    code: 'C34.90',
    display: 'Malignant neoplasm of unspecified part of bronchus or lung',
    chapter: 'II',
    specialty: 'oncology',
    synonyms: ['lung cancer'],
  },
  {
    code: 'C50.911',
    display: 'Malignant neoplasm of unspecified site of right female breast',
    chapter: 'II',
    specialty: 'oncology',
    synonyms: ['breast cancer'],
  },
  {
    code: 'C61',
    display: 'Malignant neoplasm of prostate',
    chapter: 'II',
    specialty: 'oncology',
    synonyms: ['prostate cancer'],
  },
  {
    code: 'C92.10',
    display: 'Chronic myeloid leukemia, BCR/ABL-positive, not in remission',
    chapter: 'II',
    specialty: 'oncology',
    synonyms: ['cml'],
  },
  {
    code: 'D50.9',
    display: 'Iron deficiency anemia, unspecified',
    chapter: 'III',
    specialty: 'general',
    synonyms: ['iron deficiency', 'anaemia'],
  },

  // ────────────────────────────────────────────────────────────────
  //  Chapter IV — Endocrine / nutritional / metabolic (E00-E89)
  // ────────────────────────────────────────────────────────────────
  {
    code: 'E03.9',
    display: 'Hypothyroidism, unspecified',
    chapter: 'IV',
    specialty: 'endocrinology',
  },
  {
    code: 'E05.90',
    display: 'Thyrotoxicosis, unspecified without thyrotoxic crisis or storm',
    chapter: 'IV',
    specialty: 'endocrinology',
    synonyms: ['hyperthyroidism', 'graves'],
  },
  {
    code: 'E10.9',
    display: 'Type 1 diabetes mellitus without complications',
    chapter: 'IV',
    specialty: 'endocrinology',
    synonyms: ['t1dm', 'iddm'],
  },
  {
    code: 'E11.65',
    display: 'Type 2 diabetes mellitus with hyperglycemia',
    chapter: 'IV',
    specialty: 'endocrinology',
    synonyms: ['t2dm with hyperglycaemia'],
  },
  {
    code: 'E11.9',
    display: 'Type 2 diabetes mellitus without complications',
    chapter: 'IV',
    specialty: 'endocrinology',
    synonyms: ['t2dm'],
  },
  {
    code: 'E66.9',
    display: 'Obesity, unspecified',
    chapter: 'IV',
    specialty: 'general',
    synonyms: ['obesity'],
  },
  {
    code: 'E78.5',
    display: 'Hyperlipidemia, unspecified',
    chapter: 'IV',
    specialty: 'general',
    synonyms: ['high cholesterol', 'dyslipidaemia'],
  },
  { code: 'E86.0', display: 'Dehydration', chapter: 'IV', specialty: 'general' },

  // ────────────────────────────────────────────────────────────────
  //  Chapter V — Mental + behavioural (F01-F99)
  // ────────────────────────────────────────────────────────────────
  {
    code: 'F32.9',
    display: 'Major depressive disorder, single episode, unspecified',
    chapter: 'V',
    specialty: 'psychiatry',
    synonyms: ['depression'],
  },
  {
    code: 'F33.9',
    display: 'Major depressive disorder, recurrent, unspecified',
    chapter: 'V',
    specialty: 'psychiatry',
  },
  {
    code: 'F41.0',
    display: 'Panic disorder without agoraphobia',
    chapter: 'V',
    specialty: 'psychiatry',
    synonyms: ['panic'],
  },
  {
    code: 'F41.1',
    display: 'Generalized anxiety disorder',
    chapter: 'V',
    specialty: 'psychiatry',
    synonyms: ['gad', 'anxiety'],
  },
  {
    code: 'F43.10',
    display: 'Post-traumatic stress disorder, unspecified',
    chapter: 'V',
    specialty: 'psychiatry',
    synonyms: ['ptsd'],
  },
  {
    code: 'F51.01',
    display: 'Primary insomnia',
    chapter: 'V',
    specialty: 'psychiatry',
    synonyms: ['insomnia'],
  },

  // ────────────────────────────────────────────────────────────────
  //  Chapter VI — Nervous system (G00-G99)
  // ────────────────────────────────────────────────────────────────
  {
    code: 'G40.909',
    display: 'Epilepsy, unspecified, not intractable, without status epilepticus',
    chapter: 'VI',
    specialty: 'neurology',
    synonyms: ['epilepsy', 'seizure disorder'],
  },
  {
    code: 'G43.001',
    display: 'Migraine without aura, not intractable, with status migrainosus',
    chapter: 'VI',
    specialty: 'neurology',
  },
  {
    code: 'G43.909',
    display: 'Migraine, unspecified, not intractable, without status migrainosus',
    chapter: 'VI',
    specialty: 'neurology',
    synonyms: ['migraine'],
  },
  {
    code: 'G44.1',
    display: 'Vascular headache, not elsewhere classified',
    chapter: 'VI',
    specialty: 'neurology',
  },
  {
    code: 'G45.9',
    display: 'Transient cerebral ischemic attack, unspecified',
    chapter: 'VI',
    specialty: 'neurology',
    synonyms: ['tia'],
  },
  { code: 'G47.00', display: 'Insomnia, unspecified', chapter: 'VI', specialty: 'neurology' },
  {
    code: 'G47.33',
    display: 'Obstructive sleep apnea (adult) (pediatric)',
    chapter: 'VI',
    specialty: 'pulmonology',
    synonyms: ['osa', 'sleep apnea'],
  },
  {
    code: 'G56.00',
    display: 'Carpal tunnel syndrome, unspecified upper limb',
    chapter: 'VI',
    specialty: 'neurology',
    synonyms: ['carpal tunnel'],
  },

  // ────────────────────────────────────────────────────────────────
  //  Chapter VII — Eye + adnexa (H00-H59)
  // ────────────────────────────────────────────────────────────────
  {
    code: 'H10.9',
    display: 'Unspecified conjunctivitis',
    chapter: 'VII',
    specialty: 'general',
    synonyms: ['conjunctivitis', 'pink eye'],
  },
  {
    code: 'H53.9',
    display: 'Unspecified visual disturbance',
    chapter: 'VII',
    specialty: 'general',
  },

  // ────────────────────────────────────────────────────────────────
  //  Chapter VIII — Ear + mastoid (H60-H95)
  // ────────────────────────────────────────────────────────────────
  {
    code: 'H60.90',
    display: 'Unspecified otitis externa, unspecified ear',
    chapter: 'VIII',
    specialty: 'general',
    synonyms: ['swimmer ear'],
  },
  {
    code: 'H66.90',
    display: 'Otitis media, unspecified, unspecified ear',
    chapter: 'VIII',
    specialty: 'pediatrics',
    synonyms: ['ear infection'],
  },
  {
    code: 'H66.92',
    display: 'Otitis media, unspecified, left ear',
    chapter: 'VIII',
    specialty: 'pediatrics',
  },

  // ────────────────────────────────────────────────────────────────
  //  Chapter IX — Circulatory (I00-I99)
  // ────────────────────────────────────────────────────────────────
  {
    code: 'I10',
    display: 'Essential (primary) hypertension',
    chapter: 'IX',
    specialty: 'cardiology',
    synonyms: ['hypertension', 'htn'],
  },
  {
    code: 'I11.9',
    display: 'Hypertensive heart disease without heart failure',
    chapter: 'IX',
    specialty: 'cardiology',
  },
  {
    code: 'I20.9',
    display: 'Angina pectoris, unspecified',
    chapter: 'IX',
    specialty: 'cardiology',
    synonyms: ['angina'],
  },
  {
    code: 'I21.0',
    display: 'ST elevation (STEMI) myocardial infarction of anterior wall',
    chapter: 'IX',
    specialty: 'cardiology',
    synonyms: ['stemi anterior'],
  },
  {
    code: 'I21.4',
    display: 'Non-ST elevation (NSTEMI) myocardial infarction',
    chapter: 'IX',
    specialty: 'cardiology',
    synonyms: ['nstemi'],
  },
  {
    code: 'I25.10',
    display: 'Atherosclerotic heart disease of native coronary artery without angina pectoris',
    chapter: 'IX',
    specialty: 'cardiology',
    synonyms: ['cad', 'coronary artery disease'],
  },
  {
    code: 'I26.99',
    display: 'Other pulmonary embolism without acute cor pulmonale',
    chapter: 'IX',
    specialty: 'pulmonology',
    synonyms: ['pe'],
  },
  {
    code: 'I48.0',
    display: 'Paroxysmal atrial fibrillation',
    chapter: 'IX',
    specialty: 'cardiology',
    synonyms: ['paroxysmal afib'],
  },
  {
    code: 'I48.91',
    display: 'Unspecified atrial fibrillation',
    chapter: 'IX',
    specialty: 'cardiology',
    synonyms: ['atrial fibrillation', 'afib', 'a-fib'],
  },
  {
    code: 'I50.20',
    display: 'Unspecified systolic (congestive) heart failure',
    chapter: 'IX',
    specialty: 'cardiology',
    synonyms: ['hfref', 'heart failure'],
  },
  {
    code: 'I50.30',
    display: 'Unspecified diastolic (congestive) heart failure',
    chapter: 'IX',
    specialty: 'cardiology',
    synonyms: ['hfpef'],
  },
  {
    code: 'I63.9',
    display: 'Cerebral infarction, unspecified',
    chapter: 'IX',
    specialty: 'neurology',
    synonyms: ['stroke', 'cva'],
  },
  {
    code: 'I71.01',
    display: 'Dissection of thoracic aorta',
    chapter: 'IX',
    specialty: 'cardiology',
    synonyms: ['aortic dissection'],
  },
  {
    code: 'I80.209',
    display:
      'Phlebitis and thrombophlebitis of unspecified deep vessels of unspecified lower extremity',
    chapter: 'IX',
    specialty: 'general',
    synonyms: ['dvt'],
  },

  // ────────────────────────────────────────────────────────────────
  //  Chapter X — Respiratory (J00-J99)
  // ────────────────────────────────────────────────────────────────
  {
    code: 'J00',
    display: 'Acute nasopharyngitis (common cold)',
    chapter: 'X',
    specialty: 'general',
    synonyms: ['cold', 'common cold'],
  },
  {
    code: 'J02.0',
    display: 'Streptococcal pharyngitis',
    chapter: 'X',
    specialty: 'general',
    synonyms: ['strep throat', 'group a strep'],
  },
  {
    code: 'J02.9',
    display: 'Acute pharyngitis, unspecified',
    chapter: 'X',
    specialty: 'general',
    synonyms: ['sore throat'],
  },
  {
    code: 'J06.9',
    display: 'Acute upper respiratory infection, unspecified',
    chapter: 'X',
    specialty: 'general',
    synonyms: ['uri', 'viral uri'],
  },
  {
    code: 'J18.9',
    display: 'Pneumonia, unspecified organism',
    chapter: 'X',
    specialty: 'pulmonology',
    synonyms: ['pneumonia', 'cap'],
  },
  {
    code: 'J20.9',
    display: 'Acute bronchitis, unspecified',
    chapter: 'X',
    specialty: 'pulmonology',
    synonyms: ['bronchitis'],
  },
  {
    code: 'J44.1',
    display: 'Chronic obstructive pulmonary disease with (acute) exacerbation',
    chapter: 'X',
    specialty: 'pulmonology',
    synonyms: ['copd exacerbation'],
  },
  {
    code: 'J44.9',
    display: 'Chronic obstructive pulmonary disease, unspecified',
    chapter: 'X',
    specialty: 'pulmonology',
    synonyms: ['copd'],
  },
  {
    code: 'J45.901',
    display: 'Unspecified asthma with (acute) exacerbation',
    chapter: 'X',
    specialty: 'pulmonology',
    synonyms: ['asthma exacerbation'],
  },
  {
    code: 'J45.909',
    display: 'Unspecified asthma, uncomplicated',
    chapter: 'X',
    specialty: 'pulmonology',
    synonyms: ['asthma'],
  },
  {
    code: 'J81.0',
    display: 'Acute pulmonary edema',
    chapter: 'X',
    specialty: 'pulmonology',
    synonyms: ['pulmonary edema'],
  },

  // ────────────────────────────────────────────────────────────────
  //  Chapter XI — Digestive (K00-K95)
  // ────────────────────────────────────────────────────────────────
  {
    code: 'K21.0',
    display: 'Gastro-esophageal reflux disease with esophagitis',
    chapter: 'XI',
    specialty: 'general',
    synonyms: ['gerd with esophagitis'],
  },
  {
    code: 'K21.9',
    display: 'Gastro-esophageal reflux disease without esophagitis',
    chapter: 'XI',
    specialty: 'general',
    synonyms: ['gerd', 'reflux'],
  },
  {
    code: 'K29.70',
    display: 'Gastritis, unspecified, without bleeding',
    chapter: 'XI',
    specialty: 'general',
    synonyms: ['gastritis'],
  },
  {
    code: 'K35.80',
    display: 'Unspecified acute appendicitis',
    chapter: 'XI',
    specialty: 'surgery',
    synonyms: ['appendicitis'],
  },
  {
    code: 'K57.30',
    display: 'Diverticulitis of large intestine without perforation or abscess without bleeding',
    chapter: 'XI',
    specialty: 'general',
    synonyms: ['diverticulitis'],
  },
  {
    code: 'K59.00',
    display: 'Constipation, unspecified',
    chapter: 'XI',
    specialty: 'general',
    synonyms: ['constipation'],
  },
  {
    code: 'K80.20',
    display: 'Calculus of gallbladder without cholecystitis without obstruction',
    chapter: 'XI',
    specialty: 'general',
    synonyms: ['gallstones', 'cholelithiasis'],
  },

  // ────────────────────────────────────────────────────────────────
  //  Chapter XII — Skin + subcutaneous (L00-L99)
  // ────────────────────────────────────────────────────────────────
  {
    code: 'L03.116',
    display: 'Cellulitis of left lower limb',
    chapter: 'XII',
    specialty: 'dermatology',
    synonyms: ['cellulitis leg'],
  },
  {
    code: 'L20.9',
    display: 'Atopic dermatitis, unspecified',
    chapter: 'XII',
    specialty: 'dermatology',
    synonyms: ['eczema'],
  },
  {
    code: 'L23.9',
    display: 'Allergic contact dermatitis, unspecified cause',
    chapter: 'XII',
    specialty: 'dermatology',
    synonyms: ['contact dermatitis'],
  },
  {
    code: 'L30.9',
    display: 'Dermatitis, unspecified',
    chapter: 'XII',
    specialty: 'dermatology',
    synonyms: ['dermatitis'],
  },
  {
    code: 'L40.9',
    display: 'Psoriasis, unspecified',
    chapter: 'XII',
    specialty: 'dermatology',
    synonyms: ['psoriasis'],
  },
  {
    code: 'L50.9',
    display: 'Urticaria, unspecified',
    chapter: 'XII',
    specialty: 'dermatology',
    synonyms: ['hives', 'urticaria'],
  },
  {
    code: 'L70.9',
    display: 'Acne, unspecified',
    chapter: 'XII',
    specialty: 'dermatology',
    synonyms: ['acne'],
  },

  // ────────────────────────────────────────────────────────────────
  //  Chapter XIII — Musculoskeletal (M00-M99)
  // ────────────────────────────────────────────────────────────────
  {
    code: 'M25.50',
    display: 'Pain in unspecified joint',
    chapter: 'XIII',
    specialty: 'general',
    synonyms: ['joint pain'],
  },
  {
    code: 'M54.2',
    display: 'Cervicalgia',
    chapter: 'XIII',
    specialty: 'general',
    synonyms: ['neck pain'],
  },
  {
    code: 'M54.5',
    display: 'Low back pain',
    chapter: 'XIII',
    specialty: 'general',
    synonyms: ['lbp', 'lower back pain'],
  },
  {
    code: 'M79.1',
    display: 'Myalgia',
    chapter: 'XIII',
    specialty: 'general',
    synonyms: ['muscle pain'],
  },

  // ────────────────────────────────────────────────────────────────
  //  Chapter XIV — Genitourinary (N00-N99)
  // ────────────────────────────────────────────────────────────────
  {
    code: 'N17.9',
    display: 'Acute kidney failure, unspecified',
    chapter: 'XIV',
    specialty: 'general',
    synonyms: ['aki', 'acute kidney injury'],
  },
  {
    code: 'N18.30',
    display: 'Chronic kidney disease, stage 3 unspecified',
    chapter: 'XIV',
    specialty: 'general',
    synonyms: ['ckd 3'],
  },
  {
    code: 'N18.6',
    display: 'End stage renal disease',
    chapter: 'XIV',
    specialty: 'general',
    synonyms: ['esrd'],
  },
  {
    code: 'N20.0',
    display: 'Calculus of kidney',
    chapter: 'XIV',
    specialty: 'general',
    synonyms: ['kidney stone'],
  },
  {
    code: 'N30.00',
    display: 'Acute cystitis without hematuria',
    chapter: 'XIV',
    specialty: 'general',
    synonyms: ['cystitis'],
  },
  {
    code: 'N39.0',
    display: 'Urinary tract infection, site not specified',
    chapter: 'XIV',
    specialty: 'general',
    synonyms: ['uti', 'urinary tract infection'],
  },
  {
    code: 'N40.0',
    display: 'Benign prostatic hyperplasia without lower urinary tract symptoms',
    chapter: 'XIV',
    specialty: 'general',
    synonyms: ['bph'],
  },

  // ────────────────────────────────────────────────────────────────
  //  Chapter XV — Pregnancy / childbirth (O00-O9A)  — minimal
  // ────────────────────────────────────────────────────────────────
  {
    code: 'O80',
    display: 'Encounter for full-term uncomplicated delivery',
    chapter: 'XV',
    specialty: 'general',
  },

  // ────────────────────────────────────────────────────────────────
  //  Chapter XVIII — Symptoms / signs (R00-R99)
  // ────────────────────────────────────────────────────────────────
  {
    code: 'R05.9',
    display: 'Cough, unspecified',
    chapter: 'XVIII',
    specialty: 'general',
    synonyms: ['cough'],
  },
  {
    code: 'R06.02',
    display: 'Shortness of breath',
    chapter: 'XVIII',
    specialty: 'pulmonology',
    synonyms: ['sob', 'dyspnea'],
  },
  {
    code: 'R07.9',
    display: 'Chest pain, unspecified',
    chapter: 'XVIII',
    specialty: 'cardiology',
    synonyms: ['chest pain'],
  },
  {
    code: 'R10.9',
    display: 'Unspecified abdominal pain',
    chapter: 'XVIII',
    specialty: 'general',
    synonyms: ['abdominal pain', 'belly pain'],
  },
  {
    code: 'R11.2',
    display: 'Nausea with vomiting, unspecified',
    chapter: 'XVIII',
    specialty: 'general',
    synonyms: ['nausea vomiting'],
  },
  {
    code: 'R19.7',
    display: 'Diarrhea, unspecified',
    chapter: 'XVIII',
    specialty: 'general',
    synonyms: ['diarrhea', 'diarrhoea'],
  },
  {
    code: 'R42',
    display: 'Dizziness and giddiness',
    chapter: 'XVIII',
    specialty: 'neurology',
    synonyms: ['dizziness', 'vertigo'],
  },
  {
    code: 'R50.9',
    display: 'Fever, unspecified',
    chapter: 'XVIII',
    specialty: 'general',
    synonyms: ['fever'],
  },
  {
    code: 'R51.9',
    display: 'Headache, unspecified',
    chapter: 'XVIII',
    specialty: 'neurology',
    synonyms: ['headache'],
  },
  {
    code: 'R53.83',
    display: 'Other fatigue',
    chapter: 'XVIII',
    specialty: 'general',
    synonyms: ['fatigue', 'tired'],
  },
  {
    code: 'R55',
    display: 'Syncope and collapse',
    chapter: 'XVIII',
    specialty: 'cardiology',
    synonyms: ['syncope', 'fainting'],
  },
  {
    code: 'R63.0',
    display: 'Anorexia',
    chapter: 'XVIII',
    specialty: 'general',
    synonyms: ['loss of appetite'],
  },

  // ────────────────────────────────────────────────────────────────
  //  Chapter XIX — Injury (S00-T88)  — minimal
  // ────────────────────────────────────────────────────────────────
  {
    code: 'S00.93XA',
    display: 'Abrasion of unspecified part of head, initial encounter',
    chapter: 'XIX',
    specialty: 'general',
  },
  {
    code: 'S06.0X0A',
    display: 'Concussion without loss of consciousness, initial encounter',
    chapter: 'XIX',
    specialty: 'neurology',
    synonyms: ['concussion'],
  },
  {
    code: 'T78.40XA',
    display: 'Allergy, unspecified, initial encounter',
    chapter: 'XIX',
    specialty: 'general',
    synonyms: ['allergic reaction'],
  },

  // ────────────────────────────────────────────────────────────────
  //  Chapter XXI — Factors influencing health status (Z00-Z99)
  // ────────────────────────────────────────────────────────────────
  {
    code: 'Z00.00',
    display: 'Encounter for general adult medical examination without abnormal findings',
    chapter: 'XXI',
    specialty: 'general',
    synonyms: ['annual physical', 'check-up'],
  },
  {
    code: 'Z23',
    display: 'Encounter for immunization',
    chapter: 'XXI',
    specialty: 'general',
    synonyms: ['vaccination'],
  },
];

// ────────────────────────────────────────────────────────────────
//  Lookup helpers — exported as the public API.
// ────────────────────────────────────────────────────────────────

/** Case-insensitive exact code lookup. Returns null when not in the
 *  curated set — caller decides whether to fall back to the LLM or
 *  surface "code not in local KB". */
export function lookupIcd10(code: string): Icd10Entry | null {
  const norm = code.trim().toUpperCase();
  return ICD10_TABLE.find((e) => e.code.toUpperCase() === norm) ?? null;
}

/** Returns true when the code is in our curated set. Useful as a
 *  hallucination check — the validator can flag any LLM output that
 *  cites a code we don't recognise. */
export function isKnownIcd10(code: string): boolean {
  return lookupIcd10(code) !== null;
}

/** Free-text search across display names + synonyms. Returns the
 *  top-`k` matches sorted by relevance (substring match, then
 *  prefix match on the first word). */
export function searchIcd10(query: string, k = 5): Icd10Entry[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return [];
  const scored: Array<{ entry: Icd10Entry; score: number }> = [];
  for (const entry of ICD10_TABLE) {
    const haystack = [entry.display.toLowerCase(), ...(entry.synonyms ?? [])];
    let score = 0;
    for (const h of haystack) {
      if (h === q) score = Math.max(score, 100);
      else if (h.startsWith(q)) score = Math.max(score, 80);
      else if (h.includes(q)) score = Math.max(score, 50);
    }
    if (score > 0) scored.push({ entry, score });
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((s) => s.entry);
}

/** Routing helper — given a free-text condition, infer which of the
 *  specialist agents should own it. Falls through to `general` when no
 *  match. */
export function specialtyForCondition(condition: string): Icd10Specialty {
  const matches = searchIcd10(condition, 1);
  return matches[0]?.specialty ?? 'general';
}

export const ICD10_TABLE_SIZE = ICD10_TABLE.length;
