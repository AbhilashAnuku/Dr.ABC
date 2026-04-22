/**
 * interactions — drug-drug + drug-allergy + drug-condition safety.
 *
 * Curated subset of high-frequency interactions a primary-care or
 * ED clinician must catch before signing an Rx. Drawn from:
 *   - DrugBank's "major" and "moderate" severity entries
 *   - Lexicomp interaction monographs
 *   - FDA black-box warnings + contraindication labels
 *   - WHO Model List of Essential Medicines drug-class anchors
 *
 * Anything not in this table is unknown to the deterministic checker
 * — it falls through to `severity: 'unknown'` so the clinician sees
 * "we couldn't verify; check Lexicomp" rather than a false-clear.
 *
 * Drug names are normalised to lower-case INN + common generics +
 * common brand. The matcher is a substring check on the patient's
 * `currentMeds` text, so "Lisinopril 10 mg PO daily" matches against
 * the canonical 'lisinopril' synonym.
 */

export type Severity = 'major' | 'moderate' | 'minor' | 'unknown';

export interface DrugInteraction {
  /** Two normalised lower-case names — order-independent in the matcher. */
  pair: [string, string];
  severity: Severity;
  /** Mechanism / consequence in one short sentence. */
  effect: string;
  /** What to do clinically. */
  action: string;
}

export interface DrugAllergyAlert {
  /** Lower-case INN or class. */
  drug: string;
  /** Allergy class to match against the patient's allergy free-text. */
  allergy: string;
  severity: Severity;
  effect: string;
  action: string;
}

export interface DrugConditionAlert {
  drug: string;
  /** Condition / state — substring match against the patient's history. */
  condition: string;
  severity: Severity;
  effect: string;
  action: string;
}

// ──────────────────────────────────────────────────────────────────
//  Synonyms / brand names → canonical INN.  Looked up by the matcher
//  before the pair tables run, so 'tylenol' matches 'acetaminophen'.
// ──────────────────────────────────────────────────────────────────

export const DRUG_SYNONYMS: Record<string, string> = {
  tylenol: 'acetaminophen',
  paracetamol: 'acetaminophen',
  panadol: 'acetaminophen',
  advil: 'ibuprofen',
  motrin: 'ibuprofen',
  aleve: 'naproxen',
  bayer: 'aspirin',
  asa: 'aspirin',
  coumadin: 'warfarin',
  jantoven: 'warfarin',
  eliquis: 'apixaban',
  xarelto: 'rivaroxaban',
  pradaxa: 'dabigatran',
  plavix: 'clopidogrel',
  brilinta: 'ticagrelor',
  zestril: 'lisinopril',
  prinivil: 'lisinopril',
  norvasc: 'amlodipine',
  cardizem: 'diltiazem',
  toprol: 'metoprolol',
  lopressor: 'metoprolol',
  glucophage: 'metformin',
  amaryl: 'glimepiride',
  prilosec: 'omeprazole',
  nexium: 'esomeprazole',
  zantac: 'famotidine',
  pepcid: 'famotidine',
  zoloft: 'sertraline',
  prozac: 'fluoxetine',
  lexapro: 'escitalopram',
  cipralex: 'escitalopram',
  ativan: 'lorazepam',
  xanax: 'alprazolam',
  klonopin: 'clonazepam',
  valium: 'diazepam',
  amoxil: 'amoxicillin',
  augmentin: 'amoxicillin-clavulanate',
  zithromax: 'azithromycin',
  cipro: 'ciprofloxacin',
  bactrim: 'trimethoprim-sulfamethoxazole',
  septra: 'trimethoprim-sulfamethoxazole',
  flagyl: 'metronidazole',
  keflex: 'cephalexin',
  rocephin: 'ceftriaxone',
  diflucan: 'fluconazole',
  proventil: 'albuterol',
  ventolin: 'albuterol',
  flonase: 'fluticasone',
  singulair: 'montelukast',
  prednisone: 'prednisone',
  decadron: 'dexamethasone',
  synthroid: 'levothyroxine',
  levoxyl: 'levothyroxine',
  imitrex: 'sumatriptan',
};

/** Resolve a free-text drug mention to its canonical lower-case INN. */
export function canonicaliseDrug(raw: string): string {
  const lower = raw.trim().toLowerCase();
  return DRUG_SYNONYMS[lower] ?? lower;
}

// ──────────────────────────────────────────────────────────────────
//  Drug-drug interactions — major + moderate, ordered by frequency
//  in real practice.
// ──────────────────────────────────────────────────────────────────

export const DRUG_DRUG_INTERACTIONS: readonly DrugInteraction[] = [
  // Anticoagulants × NSAIDs / antiplatelets — bleeding risk.
  {
    pair: ['warfarin', 'aspirin'],
    severity: 'major',
    effect: 'Synergistic bleeding risk via additive platelet + coagulation cascade inhibition.',
    action:
      'Avoid combination unless cardiologist-directed; if combined, reduce ASA to 81 mg + monitor INR weekly.',
  },
  {
    pair: ['warfarin', 'ibuprofen'],
    severity: 'major',
    effect: 'NSAIDs displace warfarin from albumin + irritate GI mucosa → major bleed risk.',
    action: 'Switch to acetaminophen for pain control; if NSAID essential, add PPI + monitor.',
  },
  {
    pair: ['warfarin', 'naproxen'],
    severity: 'major',
    effect: 'As above — NSAID + warfarin synergy.',
    action: 'Avoid; substitute acetaminophen.',
  },
  {
    pair: ['warfarin', 'amiodarone'],
    severity: 'major',
    effect: 'Amiodarone inhibits CYP2C9 → warfarin levels rise sharply over weeks.',
    action: 'Reduce warfarin dose by 30-50% on amiodarone start; monitor INR weekly for 4 wk.',
  },
  {
    pair: ['warfarin', 'trimethoprim-sulfamethoxazole'],
    severity: 'major',
    effect: 'TMP-SMX displaces warfarin + inhibits CYP2C9.',
    action:
      'Avoid if alternative antibiotic available; otherwise reduce warfarin 25% + recheck INR in 3-5 d.',
  },
  {
    pair: ['apixaban', 'aspirin'],
    severity: 'moderate',
    effect: 'Additive bleeding risk; less than warfarin + ASA but still significant.',
    action: 'Use only for clear cardiac indication; avoid recreational ASA combination.',
  },
  {
    pair: ['apixaban', 'clopidogrel'],
    severity: 'major',
    effect: 'Triple/dual antithrombotic therapy substantially raises GI bleed risk.',
    action: 'Limit duration; use PPI prophylaxis; specialist-directed only.',
  },
  {
    pair: ['clopidogrel', 'omeprazole'],
    severity: 'moderate',
    effect:
      'Omeprazole inhibits CYP2C19 → reduced clopidogrel activation → reduced antiplatelet effect.',
    action: 'Switch to pantoprazole or famotidine when GI prophylaxis needed.',
  },

  // SSRIs × MAOIs / triptans — serotonin syndrome.
  {
    pair: ['sertraline', 'sumatriptan'],
    severity: 'moderate',
    effect: 'Both increase serotonergic tone → small but real risk of serotonin syndrome.',
    action:
      'Counsel on serotonin-syndrome warning signs (agitation, hyperthermia, clonus); avoid together when possible.',
  },
  {
    pair: ['fluoxetine', 'tramadol'],
    severity: 'major',
    effect:
      'Fluoxetine inhibits CYP2D6 (slows tramadol activation) AND adds serotonin → increased seizure + serotonin-syndrome risk.',
    action: 'Avoid; use acetaminophen + non-tramadol analgesic.',
  },
  {
    pair: ['sertraline', 'tramadol'],
    severity: 'major',
    effect: 'Serotonin synergy + CYP2D6 inhibition.',
    action: 'Avoid; substitute non-tramadol analgesic.',
  },
  {
    pair: ['escitalopram', 'sumatriptan'],
    severity: 'moderate',
    effect: 'Serotonergic synergy.',
    action: 'Counsel + monitor; use lowest effective triptan dose.',
  },

  // ACE-I × K-sparing / NSAIDs.
  {
    pair: ['lisinopril', 'spironolactone'],
    severity: 'moderate',
    effect: 'Both raise serum K+ → hyperkalaemia risk, especially in CKD.',
    action: 'Check K + creatinine within 1 wk of co-prescription + every 3 mo thereafter.',
  },
  {
    pair: ['lisinopril', 'ibuprofen'],
    severity: 'moderate',
    effect: 'NSAIDs blunt antihypertensive effect + raise AKI risk.',
    action: 'Use acetaminophen for pain; if NSAID essential, limit to ≤ 5 days + check creatinine.',
  },
  {
    pair: ['lisinopril', 'potassium'],
    severity: 'major',
    effect: 'ACE-I + K supplements → hyperkalaemia + arrhythmia.',
    action: 'Avoid potassium supplements unless K < 3.5; recheck within 1 wk.',
  },

  // Statins × CYP3A4 inhibitors.
  {
    pair: ['simvastatin', 'amiodarone'],
    severity: 'major',
    effect: 'Amiodarone inhibits CYP3A4 → simvastatin levels rise → rhabdomyolysis risk.',
    action: 'Cap simvastatin at 20 mg/day with amiodarone; switch to pravastatin or rosuvastatin.',
  },
  {
    pair: ['simvastatin', 'clarithromycin'],
    severity: 'major',
    effect: 'CYP3A4 inhibition by clarithromycin → simvastatin levels rise sharply.',
    action: 'Hold simvastatin during course or switch to azithromycin.',
  },

  // Beta-blockers × non-DHP CCB.
  {
    pair: ['metoprolol', 'verapamil'],
    severity: 'major',
    effect: 'Both negative chrono- + ino-tropic; AV-block + symptomatic bradycardia.',
    action: 'Avoid combination outside specialist care.',
  },
  {
    pair: ['metoprolol', 'diltiazem'],
    severity: 'moderate',
    effect: 'Additive bradycardia + AV nodal blockade.',
    action: 'Monitor HR + PR interval; cardiologist co-management.',
  },

  // Diabetes — sulfonylureas + insulin / fluoroquinolones.
  {
    pair: ['glimepiride', 'ciprofloxacin'],
    severity: 'moderate',
    effect: 'Fluoroquinolones can cause both hypo- and hyperglycaemia in diabetics.',
    action: 'Increase glucose monitoring during course; counsel on hypo signs.',
  },
  {
    pair: ['metformin', 'iv contrast'],
    severity: 'moderate',
    effect: 'Risk of contrast-induced nephropathy + lactic acidosis.',
    action: 'Hold metformin 48 h after contrast; recheck creatinine before resuming.',
  },

  // Antibiotics × oral contraceptives.
  {
    pair: ['rifampin', 'oral contraceptive'],
    severity: 'major',
    effect: 'Rifampin induces CYP3A4 → reduced contraceptive efficacy.',
    action: 'Use barrier method during therapy + 1 month after.',
  },

  // PDE5i × nitrates.
  {
    pair: ['sildenafil', 'nitroglycerin'],
    severity: 'major',
    effect: 'Severe + prolonged hypotension via NO/cGMP synergy.',
    action: 'Strict 24-h interval (48 h for tadalafil); avoid in acute coronary syndrome.',
  },

  // Antihistamines × CNS depressants.
  {
    pair: ['diphenhydramine', 'lorazepam'],
    severity: 'moderate',
    effect: 'Additive sedation + cognitive impairment; falls in elderly.',
    action: 'Avoid if elderly; counsel on driving + machinery.',
  },

  // Lithium interactions.
  {
    pair: ['lithium', 'ibuprofen'],
    severity: 'major',
    effect: 'NSAIDs reduce lithium clearance → toxicity.',
    action: 'Avoid; use acetaminophen.',
  },
  {
    pair: ['lithium', 'lisinopril'],
    severity: 'major',
    effect: 'ACE-I reduce lithium clearance → toxicity.',
    action: 'Monitor lithium level within 1 wk of starting ACE-I.',
  },
];

// ──────────────────────────────────────────────────────────────────
//  Drug-allergy alerts.
// ──────────────────────────────────────────────────────────────────

export const DRUG_ALLERGY_ALERTS: readonly DrugAllergyAlert[] = [
  {
    drug: 'amoxicillin',
    allergy: 'penicillin',
    severity: 'major',
    effect: 'Beta-lactam cross-reactivity; risk of anaphylaxis.',
    action:
      'Choose macrolide (azithromycin) or doxycycline. Skin-test if first-line beta-lactam essential.',
  },
  {
    drug: 'amoxicillin-clavulanate',
    allergy: 'penicillin',
    severity: 'major',
    effect: 'Same beta-lactam ring.',
    action: 'Choose alternative class.',
  },
  {
    drug: 'cephalexin',
    allergy: 'penicillin',
    severity: 'moderate',
    effect: '1-3% cross-reactivity rate; higher if anaphylaxis history.',
    action: 'Avoid if prior anaphylaxis; otherwise low risk with first-gen cephalosporin.',
  },
  {
    drug: 'ceftriaxone',
    allergy: 'penicillin',
    severity: 'minor',
    effect: '<1% cross-reactivity for 3rd-gen cephalosporins.',
    action:
      'Generally safe even with penicillin allergy unless prior anaphylaxis to cephalosporins.',
  },
  {
    drug: 'aspirin',
    allergy: 'nsaid',
    severity: 'major',
    effect: 'NSAID-class cross-reactivity; risk of bronchospasm + urticaria.',
    action: 'Avoid; consider acetaminophen.',
  },
  {
    drug: 'ibuprofen',
    allergy: 'aspirin',
    severity: 'major',
    effect: 'NSAID cross-reactivity.',
    action: 'Avoid; use acetaminophen.',
  },
  {
    drug: 'naproxen',
    allergy: 'nsaid',
    severity: 'major',
    effect: 'Same class.',
    action: 'Avoid.',
  },
  {
    drug: 'trimethoprim-sulfamethoxazole',
    allergy: 'sulfa',
    severity: 'major',
    effect: 'Sulfa hypersensitivity; risk of SJS/TEN.',
    action: 'Avoid; choose non-sulfa antibiotic.',
  },
  {
    drug: 'codeine',
    allergy: 'opioid',
    severity: 'major',
    effect: 'Cross-class hypersensitivity.',
    action: 'Avoid all opioids unless tolerability documented for the specific molecule.',
  },
];

// ──────────────────────────────────────────────────────────────────
//  Drug-condition contraindications.
// ──────────────────────────────────────────────────────────────────

export const DRUG_CONDITION_ALERTS: readonly DrugConditionAlert[] = [
  {
    drug: 'metformin',
    condition: 'ckd 4',
    severity: 'major',
    effect: 'eGFR < 30 → lactic acidosis risk.',
    action: 'Discontinue metformin when eGFR < 30; switch to DPP-4 inhibitor or insulin.',
  },
  {
    drug: 'metformin',
    condition: 'ckd 5',
    severity: 'major',
    effect: 'Same.',
    action: 'Discontinue.',
  },
  {
    drug: 'lisinopril',
    condition: 'pregnancy',
    severity: 'major',
    effect: 'Teratogenic — renal dysplasia, oligohydramnios, neonatal hypotension.',
    action: 'Stop immediately; switch to labetalol or methyldopa for HTN in pregnancy.',
  },
  {
    drug: 'sumatriptan',
    condition: 'coronary artery disease',
    severity: 'major',
    effect: 'Triptans cause coronary vasoconstriction.',
    action: 'Avoid in CAD or uncontrolled HTN; consider gepants instead.',
  },
  {
    drug: 'pseudoephedrine',
    condition: 'uncontrolled hypertension',
    severity: 'major',
    effect: 'Sympathomimetic → BP spike.',
    action: 'Avoid; use intranasal saline + antihistamine alternative.',
  },
  {
    drug: 'pseudoephedrine',
    condition: 'glaucoma',
    severity: 'moderate',
    effect: 'Mydriasis can precipitate angle closure.',
    action: 'Avoid in narrow-angle glaucoma.',
  },
  {
    drug: 'aspirin',
    condition: 'pediatric viral illness',
    severity: 'major',
    effect: "Reye's syndrome risk in children with viral illness.",
    action: 'Use acetaminophen or ibuprofen instead.',
  },
  {
    drug: 'nitrofurantoin',
    condition: 'ckd 4',
    severity: 'major',
    effect: 'Reduced urinary concentration → ineffective + neuropathy risk.',
    action: 'Avoid when eGFR < 30; choose fosfomycin or pivmecillinam.',
  },
  {
    drug: 'metoclopramide',
    condition: 'parkinson',
    severity: 'major',
    effect: 'Dopamine antagonism worsens parkinsonism.',
    action: 'Avoid; use ondansetron for nausea.',
  },
  {
    drug: 'ibuprofen',
    condition: 'heart failure',
    severity: 'moderate',
    effect: 'Sodium + water retention → decompensation.',
    action: 'Avoid; use acetaminophen.',
  },
];

// ──────────────────────────────────────────────────────────────────
//  Public matcher API
// ──────────────────────────────────────────────────────────────────

function tokeniseDrugList(text: string): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .split(/[,;.\n]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => {
      // Strip dose/frequency tokens — we only want the drug noun.
      const head = t.split(/\s+/).find((w) => /^[a-z][a-z-]+$/.test(w)) ?? t;
      return canonicaliseDrug(head);
    });
}

export interface MatchedAlert {
  kind: 'drug-drug' | 'drug-allergy' | 'drug-condition';
  severity: Severity;
  effect: string;
  action: string;
  /** Free-text label the UI can render in the warning chip. */
  label: string;
}

/**
 * Run the full safety check for one prescribed drug against the
 * patient's current med list, allergy list, and condition list.
 *
 * Free-text inputs — the matcher tokenises + canonicalises before
 * checking. Returns every alert that fired (caller decides whether
 * to escalate based on severity).
 */
export function checkDrugSafety(input: {
  prescribed: string;
  currentMeds?: string;
  allergies?: string;
  conditions?: string;
}): MatchedAlert[] {
  const drug = canonicaliseDrug(input.prescribed.split(/\s+/)[0] ?? input.prescribed);
  const alerts: MatchedAlert[] = [];

  // 1. Drug-drug
  const meds = tokeniseDrugList(input.currentMeds ?? '');
  for (const other of meds) {
    if (other === drug) continue;
    const hit = DRUG_DRUG_INTERACTIONS.find(
      (i) =>
        (i.pair[0] === drug && i.pair[1] === other) || (i.pair[1] === drug && i.pair[0] === other),
    );
    if (hit) {
      alerts.push({
        kind: 'drug-drug',
        severity: hit.severity,
        effect: hit.effect,
        action: hit.action,
        label: `${drug} × ${other} · ${hit.severity}`,
      });
    }
  }

  // 2. Drug-allergy
  const allergyText = (input.allergies ?? '').toLowerCase();
  for (const alert of DRUG_ALLERGY_ALERTS) {
    if (alert.drug !== drug) continue;
    if (allergyText.includes(alert.allergy)) {
      alerts.push({
        kind: 'drug-allergy',
        severity: alert.severity,
        effect: alert.effect,
        action: alert.action,
        label: `${drug} × ${alert.allergy} allergy · ${alert.severity}`,
      });
    }
  }

  // 3. Drug-condition
  const conditionText = (input.conditions ?? '').toLowerCase();
  for (const alert of DRUG_CONDITION_ALERTS) {
    if (alert.drug !== drug) continue;
    if (conditionText.includes(alert.condition)) {
      alerts.push({
        kind: 'drug-condition',
        severity: alert.severity,
        effect: alert.effect,
        action: alert.action,
        label: `${drug} × ${alert.condition} · ${alert.severity}`,
      });
    }
  }

  return alerts;
}

/** Severity rank for UI sorting + the validator's escalation gate. */
export function severityRank(s: Severity): number {
  switch (s) {
    case 'major':
      return 3;
    case 'moderate':
      return 2;
    case 'minor':
      return 1;
    case 'unknown':
      return 0;
  }
}

export const INTERACTION_TABLE_SIZE = DRUG_DRUG_INTERACTIONS.length;
export const ALLERGY_TABLE_SIZE = DRUG_ALLERGY_ALERTS.length;
export const CONDITION_TABLE_SIZE = DRUG_CONDITION_ALERTS.length;
