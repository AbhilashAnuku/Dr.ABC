/**
 * standard-of-care — first-line evidence-based treatment templates
 * indexed by ICD-10 code (or normalized condition string).
 *
 * Curated from:
 *   - 2024 USPSTF + AHA / ACC / ESC / GINA / GOLD / NCEP guidelines
 *   - WHO Model List of Essential Medicines (22nd ed.)
 *   - NICE clinical guidelines (UK)
 *
 * Each template is the bare minimum a competent first-line clinician
 * would prescribe / counsel for the canonical case. The Rx engine in
 * `clinic.tsx::recommendRx` already handles its own pattern matching;
 * this module is the *grounded reference* the validator + tuner use
 * to check whether the LLM's recommendation is consistent with
 * standing guidance.
 *
 * The shape mirrors the `RxItem` shape in clinic.tsx so a future
 * refactor can swap the heuristic Rx engine for these templates
 * without churn.
 */

export interface SocRxItem {
  drug: string;
  dose: string;
  frequency: string;
  duration: string;
  notes?: string;
}

export interface StandardOfCareTemplate {
  /** Primary ICD-10 anchor. Some templates apply to multiple codes
   *  (e.g. 'asthma' to J45.901 + J45.909) — the matcher iterates. */
  icd10: string;
  /** Free-text condition tag for synonymy. */
  condition: string;
  /** First-line drug therapy. May be empty for supportive-care
   *  conditions like acute viral bronchitis. */
  rx: readonly SocRxItem[];
  /** Counselling + lifestyle items. */
  counsel: readonly string[];
  /** Follow-up sentence. */
  followUp: string;
  /** Source guideline identifier, kept short for the UI chip. */
  source: string;
}

export const SOC_TEMPLATES: readonly StandardOfCareTemplate[] = [
  // Cardiology
  {
    icd10: 'I10',
    condition: 'Essential hypertension',
    rx: [
      {
        drug: 'Lisinopril',
        dose: '10 mg PO',
        frequency: 'once daily',
        duration: '90 days',
        notes: 'Recheck BP + creatinine + K in 2 weeks. Counsel on ACE-i cough.',
      },
    ],
    counsel: [
      'DASH-style diet · sodium < 1500 mg/day',
      '150 min/wk moderate aerobic activity',
      'Limit alcohol to ≤ 2 standard drinks/day',
    ],
    followUp: 'Recheck BP in 2-4 weeks; titrate to target < 130/80 mmHg if tolerated.',
    source: 'ACC/AHA 2017 + 2024 update',
  },
  {
    icd10: 'I21.0',
    condition: 'STEMI',
    rx: [
      { drug: 'Aspirin', dose: '325 mg PO', frequency: 'chewed once', duration: 'load' },
      { drug: 'Ticagrelor', dose: '180 mg PO', frequency: 'load', duration: 'load' },
      { drug: 'Heparin', dose: '60 U/kg IV bolus', frequency: 'once', duration: 'periprocedural' },
    ],
    counsel: ['Activate cath lab; goal door-to-balloon < 90 min.'],
    followUp: 'CCU monitoring × 48 h; cardiac rehab within 4 wk.',
    source: 'ACC/AHA STEMI 2022',
  },
  {
    icd10: 'I48.91',
    condition: 'Atrial fibrillation',
    rx: [
      {
        drug: 'Apixaban',
        dose: '5 mg PO',
        frequency: 'BID',
        duration: 'indefinite',
        notes: 'Reduce to 2.5 mg BID if 2+ of: age ≥ 80, weight ≤ 60 kg, Cr ≥ 1.5.',
      },
      { drug: 'Metoprolol', dose: '25 mg PO', frequency: 'BID', duration: '90 days' },
    ],
    counsel: ['Counsel on stroke + bleed risk; never stop anticoagulant without cardiologist.'],
    followUp: 'Cardiology in 1 week; consider rhythm control if symptomatic.',
    source: 'ESC 2024 AF guideline · CHA₂DS₂-VASc-driven',
  },
  {
    icd10: 'I50.20',
    condition: 'Heart failure with reduced EF',
    rx: [
      { drug: 'Sacubitril-valsartan', dose: '49/51 mg PO', frequency: 'BID', duration: '90 days' },
      { drug: 'Carvedilol', dose: '6.25 mg PO', frequency: 'BID', duration: '90 days' },
      { drug: 'Spironolactone', dose: '25 mg PO', frequency: 'once daily', duration: '90 days' },
      { drug: 'Empagliflozin', dose: '10 mg PO', frequency: 'once daily', duration: '90 days' },
    ],
    counsel: ['Daily weight log; report > 2 kg gain in 3 days.'],
    followUp: 'HF clinic in 2 weeks; titrate to target doses over 8-12 wk.',
    source: 'AHA 2022 + 2024 GDMT four-pillar therapy',
  },

  // Pulmonology
  {
    icd10: 'J45.901',
    condition: 'Acute asthma exacerbation',
    rx: [
      {
        drug: 'Albuterol MDI',
        dose: '90 µg, 2 puffs',
        frequency: 'q4-6h PRN',
        duration: '5-10 days',
      },
      { drug: 'Prednisone', dose: '40 mg PO', frequency: 'once daily', duration: '5 days' },
    ],
    counsel: ['Step up controller (ICS) if SABA needed > 2x/wk.'],
    followUp: 'PCP in 1 wk for action-plan review + spirometry.',
    source: 'GINA 2024 step-up algorithm',
  },
  {
    icd10: 'J20.9',
    condition: 'Acute viral bronchitis',
    rx: [],
    counsel: [
      'Supportive: fluids, rest, honey for cough (avoid in <1 yr).',
      'Acetaminophen 500 mg q6h PRN for fever / discomfort.',
    ],
    followUp: 'Return if cough > 3 wk or new fever / dyspnoea.',
    source: 'NICE NG120 · CDC respiratory guidance',
  },
  {
    icd10: 'J18.9',
    condition: 'Community-acquired pneumonia',
    rx: [
      {
        drug: 'Amoxicillin',
        dose: '1 g PO',
        frequency: 'TID',
        duration: '5-7 days',
        notes: 'Re-evaluate at 72 h; broaden if no improvement.',
      },
    ],
    counsel: ['Pneumococcal vaccine if not up-to-date.'],
    followUp: 'PCP in 1 wk; CXR at 6 wk to confirm resolution.',
    source: 'IDSA/ATS 2019 CAP guideline',
  },
  {
    icd10: 'J44.1',
    condition: 'COPD exacerbation',
    rx: [
      {
        drug: 'Albuterol-ipratropium nebulizer',
        dose: '2.5/0.5 mg',
        frequency: 'q4h',
        duration: '5 days',
      },
      { drug: 'Prednisone', dose: '40 mg PO', frequency: 'once daily', duration: '5 days' },
      {
        drug: 'Azithromycin',
        dose: '500 mg PO',
        frequency: 'once daily',
        duration: '5 days',
        notes: 'If purulent sputum or hospitalization.',
      },
    ],
    counsel: ['Smoking cessation referral.', 'Pulmonary rehab.'],
    followUp: 'PCP in 1 wk.',
    source: 'GOLD 2024',
  },

  // GI
  {
    icd10: 'K21.0',
    condition: 'GERD',
    rx: [
      {
        drug: 'Omeprazole',
        dose: '20 mg PO',
        frequency: 'once daily 30 min before breakfast',
        duration: '8 weeks',
      },
    ],
    counsel: [
      'Lifestyle: weight loss, avoid late meals, head-of-bed elevation.',
      'Avoid NSAIDs, alcohol, smoking.',
    ],
    followUp:
      'Re-evaluate at 8 wk; consider EGD if alarm features (dysphagia, weight loss, GI bleed).',
    source: 'ACG 2022 GERD guideline',
  },

  // Endocrine
  {
    icd10: 'E11.65',
    condition: 'Type 2 diabetes with hyperglycaemia',
    rx: [
      {
        drug: 'Metformin',
        dose: '500 mg PO',
        frequency: 'BID',
        duration: '90 days',
        notes: 'Titrate to 1 g BID over 4 wk.',
      },
    ],
    counsel: [
      'Diabetes-educator referral · low-carb diet · 30 min walk daily.',
      'Annual eye + foot + nephropathy screening.',
    ],
    followUp: 'A1c recheck in 3 months · target < 7%.',
    source: 'ADA Standards of Care 2024',
  },
  {
    icd10: 'E03.9',
    condition: 'Hypothyroidism',
    rx: [
      {
        drug: 'Levothyroxine',
        dose: '50 µg PO',
        frequency: 'once daily on empty stomach',
        duration: 'indefinite',
        notes: 'Adjust by 12.5-25 µg per visit until TSH 0.5-2.5.',
      },
    ],
    counsel: ['Take at least 1 h before breakfast or 4 h before/after calcium / iron / PPI.'],
    followUp: 'TSH recheck in 6 weeks.',
    source: 'ATA 2014',
  },

  // Infectious / general
  {
    icd10: 'J02.0',
    condition: 'Streptococcal pharyngitis',
    rx: [
      {
        drug: 'Amoxicillin',
        dose: '50 mg/kg/day PO',
        frequency: 'TID',
        duration: '10 days',
        notes: 'Avoid in penicillin allergy — use azithromycin instead.',
      },
    ],
    counsel: ['Hydration; safe to return to school 24 h after antibiotics + afebrile.'],
    followUp: 'PCP if no improvement in 48 h or rash develops.',
    source: 'IDSA 2012 GAS guideline',
  },
  {
    icd10: 'N39.0',
    condition: 'Uncomplicated UTI',
    rx: [
      {
        drug: 'Nitrofurantoin',
        dose: '100 mg PO',
        frequency: 'BID',
        duration: '5 days',
        notes: 'Avoid if eGFR < 30.',
      },
    ],
    counsel: ['Push fluids; cranberry not evidence-based.'],
    followUp: 'PCP if no improvement in 48 h.',
    source: 'IDSA 2010 + 2024 update',
  },
  {
    icd10: 'L03.116',
    condition: 'Cellulitis',
    rx: [
      {
        drug: 'Cephalexin',
        dose: '500 mg PO',
        frequency: 'QID',
        duration: '7 days',
        notes: 'If MRSA risk, add or switch to TMP-SMX or doxycycline.',
      },
    ],
    counsel: ['Elevate limb · mark perimeter · return if expanding > 2 cm or systemic signs.'],
    followUp: 'PCP at 48-72 h.',
    source: 'IDSA 2014 SSTI guideline',
  },

  // Neurology
  {
    icd10: 'G43.909',
    condition: 'Migraine',
    rx: [
      {
        drug: 'Sumatriptan',
        dose: '50 mg PO',
        frequency: 'at onset · may repeat after 2 h',
        duration: 'PRN, max 8 / 30 d',
        notes: 'Avoid in CAD or uncontrolled HTN.',
      },
      { drug: 'Acetaminophen', dose: '500 mg PO', frequency: 'q6h PRN', duration: '5 days' },
    ],
    counsel: ['Trigger diary · sleep hygiene · hydration.'],
    followUp: 'Neurology referral if > 4 attacks/month or refractory.',
    source: 'AAN 2021 acute migraine guideline',
  },

  // Mental health
  {
    icd10: 'F41.1',
    condition: 'Generalized anxiety disorder',
    rx: [
      {
        drug: 'Sertraline',
        dose: '25 mg PO',
        frequency: 'once daily',
        duration: '90 days',
        notes: 'Titrate to 50 mg after 1 wk; counsel on 4 wk lag-to-onset + serotonin syndrome.',
      },
    ],
    counsel: ['CBT referral.', 'Limit caffeine + alcohol.'],
    followUp: 'PCP in 4 weeks; psychiatry if no improvement at 12 wk.',
    source: 'APA 2021 anxiety disorders guideline',
  },

  // Surgical (referral only)
  {
    icd10: 'K35.80',
    condition: 'Acute appendicitis',
    rx: [{ drug: 'Cefoxitin', dose: '2 g IV', frequency: 'pre-op', duration: 'single dose' }],
    counsel: ['NPO; IV fluids; surgical consult immediately.'],
    followUp: 'Post-op POD 1 follow-up; activity restrictions for 4 wk.',
    source: 'WSES 2020 acute appendicitis',
  },

  // Pediatric
  {
    icd10: 'H66.92',
    condition: 'Acute otitis media',
    rx: [
      {
        drug: 'Amoxicillin',
        dose: '80-90 mg/kg/day PO',
        frequency: 'BID',
        duration: '10 days',
        notes: 'Use 5-day course if ≥ 6 yr + non-severe.',
      },
    ],
    counsel: ['Acetaminophen / ibuprofen for pain.', 'Avoid bottle-propping during sleep.'],
    followUp: 'PCP in 2 weeks if symptoms persist; refer to ENT if recurrent.',
    source: 'AAP 2013 + 2023 reaffirmation',
  },
];

/** Look up a template by ICD-10 code (case-insensitive). */
export function lookupSoc(code: string): StandardOfCareTemplate | null {
  const norm = code.trim().toUpperCase();
  return SOC_TEMPLATES.find((t) => t.icd10.toUpperCase() === norm) ?? null;
}

/** Look up by free-text condition substring (case-insensitive). */
export function findSocByCondition(condition: string): StandardOfCareTemplate | null {
  const q = condition.trim().toLowerCase();
  if (q.length === 0) return null;
  return (
    SOC_TEMPLATES.find((t) => t.condition.toLowerCase() === q) ??
    SOC_TEMPLATES.find(
      (t) => t.condition.toLowerCase().includes(q) || q.includes(t.condition.toLowerCase()),
    ) ??
    null
  );
}

export const SOC_TEMPLATE_COUNT = SOC_TEMPLATES.length;
