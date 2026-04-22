/**
 * red-flags — symptom + finding patterns that mandate immediate
 * escalation. Used by the safety gate as a conservative second
 * opinion: even if the LLM rates the case routine, a red-flag hit
 * pushes the recommended ESI down + adds a "see emergency care now"
 * banner to Mörbius's reply.
 *
 * Curated from:
 *   - Emergency Severity Index (ESI) handbook v4
 *   - NICE / NHS triage red-flag lists
 *   - WHO IMCI for paediatric escalation
 *
 * Each rule has a `pattern` regex (case-insensitive) and a target
 * `escalateTo` ESI tier. The matcher returns every fired rule so the
 * UI can surface multiple concurrent red flags (e.g. chest pain +
 * diaphoresis + radiation).
 */

export type EsiTier = 1 | 2 | 3 | 4 | 5;

export interface RedFlagRule {
  /** Human-readable identifier — appears in the warning chip. */
  id: string;
  /** Regex tested against the chief complaint + free-text history. */
  pattern: RegExp;
  /** Where this rule wants the case to land on the ESI scale. */
  escalateTo: EsiTier;
  /** Why this matters — one sentence the clinician can read at a glance. */
  rationale: string;
  /** Loose specialty hint for routing. */
  specialty?: string;
}

export const RED_FLAG_RULES: readonly RedFlagRule[] = [
  // ── Cardiac (ESI 1-2) ──
  {
    id: 'crushing-chest-pain',
    pattern: /crushing\s+(chest|substernal)\s+pain|tearing\s+chest\s+pain/i,
    escalateTo: 1,
    rationale: 'Crushing or tearing chest pain → ACS or aortic dissection until proven otherwise.',
    specialty: 'cardiology',
  },
  {
    id: 'chest-pain-with-radiation',
    pattern: /chest\s+pain.*(radiat|left arm|jaw|back)/i,
    escalateTo: 2,
    rationale: 'Radiating chest pain raises ACS probability; ECG + troponin in <10 min.',
    specialty: 'cardiology',
  },
  {
    id: 'chest-pain-with-diaphoresis',
    pattern: /chest\s+pain.*(diaphor|sweat|sweating profusely)/i,
    escalateTo: 2,
    rationale: 'Diaphoresis with chest pain → high pretest probability of MI.',
    specialty: 'cardiology',
  },
  {
    id: 'syncope-with-chest-pain',
    pattern: /(syncope|fainted|passed out).*(chest pain|palpitations|exertion)/i,
    escalateTo: 2,
    rationale: 'Cardiac syncope until ruled out (arrhythmia, AS, dissection).',
    specialty: 'cardiology',
  },

  // ── Respiratory (ESI 1-2) ──
  {
    id: 'severe-dyspnea',
    pattern: /(can'?t breathe|cannot breathe|gasping|severe shortness of breath|tripod)/i,
    escalateTo: 1,
    rationale: 'Severe respiratory distress; airway/breathing immediately.',
    specialty: 'pulmonology',
  },
  {
    id: 'spo2-low',
    pattern: /spo2\s*(?:[<:=]\s*)?(\d{2})/i,
    escalateTo: 2,
    rationale: 'SpO2 reading present — flag if measured value is below 92%.',
    specialty: 'pulmonology',
  },
  {
    id: 'haemoptysis',
    pattern: /(coughing\s+up\s+blood|haemoptysis|hemoptysis)/i,
    escalateTo: 2,
    rationale: 'Haemoptysis → PE, TB, malignancy, or severe infection.',
    specialty: 'pulmonology',
  },
  {
    id: 'stridor',
    pattern: /\bstridor\b|barking\s+cough.*(infant|toddler|child)/i,
    escalateTo: 1,
    rationale: 'Upper-airway compromise (croup, anaphylaxis, foreign body).',
    specialty: 'pulmonology',
  },

  // ── Neurological (ESI 1-2) ──
  {
    id: 'sudden-severe-headache',
    pattern: /(thunderclap|worst headache (of my life|ever))/i,
    escalateTo: 1,
    rationale: 'Subarachnoid haemorrhage until proven otherwise.',
    specialty: 'neurology',
  },
  {
    id: 'fast-stroke-signs',
    pattern:
      /(face droop|facial droop|arm weakness|slurred speech|aphasia|hemiplegia|hemiparesis)/i,
    escalateTo: 1,
    rationale: 'FAST-positive — activate stroke pathway, time-of-onset critical for tPA window.',
    specialty: 'neurology',
  },
  {
    id: 'first-seizure-adult',
    pattern: /first\s+(seizure|fit|convulsion)|new[- ]onset\s+seizure/i,
    escalateTo: 2,
    rationale: 'New-onset seizure → CT head, electrolytes, glucose; EEG outpatient.',
    specialty: 'neurology',
  },
  {
    id: 'altered-mental-status',
    pattern: /(altered\s+mental|confused suddenly|unresponsive|gcs\s*<\s*15)/i,
    escalateTo: 2,
    rationale: 'AMS — sepsis, hypoglycaemia, stroke, intoxication, encephalitis.',
    specialty: 'neurology',
  },
  {
    id: 'meningitis-triad',
    pattern: /(stiff neck|nuchal rigidity|neck stiffness).*(fever|photophobia)/i,
    escalateTo: 2,
    rationale: 'Meningitis suspected — empirical antibiotics within 1 h.',
    specialty: 'neurology',
  },

  // ── GI / surgical (ESI 2) ──
  {
    id: 'rlq-pain',
    pattern: /(rlq|right lower quadrant|right iliac fossa)\s+(pain|tender)/i,
    escalateTo: 2,
    rationale: 'Appendicitis, ovarian torsion, ectopic pregnancy.',
    specialty: 'general',
  },
  {
    id: 'haematemesis',
    pattern: /(vomit(ing)?\s+blood|coffee[- ]ground|haematemesis|hematemesis)/i,
    escalateTo: 2,
    rationale: 'Upper-GI bleed → IV access, type & cross, GI consult.',
    specialty: 'general',
  },
  {
    id: 'melena',
    pattern: /(black tarry stool|melena|melaena)/i,
    escalateTo: 2,
    rationale: 'Upper-GI bleed.',
    specialty: 'general',
  },
  {
    id: 'rigid-abdomen',
    pattern: /(rigid abdomen|board[- ]like|peritonitic|guarding)/i,
    escalateTo: 1,
    rationale: 'Peritonitis — surgical emergency.',
    specialty: 'general',
  },

  // ── Sepsis / infection (ESI 2) ──
  {
    id: 'sepsis-screen',
    pattern: /(fever|hypotension|tachycardia).*(altered|confus|low urine)/i,
    escalateTo: 2,
    rationale: 'qSOFA criteria suggest sepsis — bundle within 1 h.',
    specialty: 'general',
  },
  {
    id: 'pediatric-fever-infant',
    pattern: /fever\s+\d{2}.*(infant|< ?3 months|under 3 months)/i,
    escalateTo: 2,
    rationale: 'Fever in <3 mo → full septic workup.',
    specialty: 'general',
  },

  // ── OB-GYN (ESI 2) ──
  {
    id: 'pregnancy-bleeding',
    pattern: /(pregnan).*(bleeding|cramping|severe pain)/i,
    escalateTo: 2,
    rationale: 'Possible ectopic, placental abruption, or miscarriage.',
    specialty: 'general',
  },
  {
    id: 'eclampsia-signs',
    pattern: /(pregnan).*(seizure|severe headache|visual changes|epigastric pain)/i,
    escalateTo: 1,
    rationale: 'Pre-eclampsia / eclampsia — emergency.',
    specialty: 'general',
  },

  // ── Mental-health (ESI 2) ──
  // Direct + indirect crisis language. Real patients rarely say "I am
  // suicidal" — they more often say "I want it to stop", "I'm done",
  // "no reason to keep going". The cost of asking once "are you safe?"
  // on a false positive is much lower than the cost of missing one
  // true positive. German equivalents are wired alongside.
  {
    id: 'suicidal-ideation',
    pattern:
      /(want to die|suicidal|kill myself|end it all|plan to harm|i.?m done|don.?t want to (be here|wake up|live|exist)|tired of living|no reason to (live|keep going|go on)|nothing left|can.?t go on|can.?t do this anymore|want it to (stop|end)|just want it to end|want everything to stop|sterben wollen|selbstmord|suizid|lebensm[üu]de|nicht mehr leben|will (nicht mehr|aufh[öo]ren))/i,
    escalateTo: 2,
    rationale:
      'Possible suicidal ideation — immediate empathetic check + crisis resources + psychiatric assessment.',
    specialty: 'psychiatry',
  },
  {
    id: 'severe-hopelessness',
    pattern:
      /(hopeless|nothing matters|nobody cares|trapped|can.?t see a way out|hoffnungslos|ausweglos|niemand interessiert|gefangen)/i,
    escalateTo: 3,
    rationale:
      'Severe hopelessness — empathetic safety check; depression screening; offer crisis resources.',
    specialty: 'psychiatry',
  },
  {
    id: 'homicidal-ideation',
    pattern:
      /(want to hurt someone|hurt others|homicidal|kill someone|jemandem etwas antun|jemanden umbringen|gewalt gegen)/i,
    escalateTo: 2,
    rationale: 'Imminent risk to others — duty to warn + protect.',
    specialty: 'psychiatry',
  },

  // ── Allergy / anaphylaxis (ESI 1) ──
  {
    id: 'anaphylaxis',
    pattern: /(throat closing|swelling.*tongue|anaphylaxis|hives.*difficulty breathing)/i,
    escalateTo: 1,
    rationale: 'Anaphylaxis — IM epinephrine 0.3 mg now; airway support.',
    specialty: 'general',
  },

  // ── Trauma (ESI 1-2) ──
  {
    id: 'penetrating-trauma',
    pattern: /(stab(bed)?|gunshot|gsw|impaled)/i,
    escalateTo: 1,
    rationale: 'Penetrating trauma — primary survey + activate trauma team.',
    specialty: 'surgery',
  },
];

export interface RedFlagHit {
  rule: RedFlagRule;
  matched: string;
}

/**
 * Scan the chief complaint + history for red-flag patterns. Returns
 * every rule that fired with the matched substring so the UI can
 * highlight the trigger.
 *
 * SpO2 is special-cased: the regex captures the value and we only
 * fire the rule when the captured number is < 92.
 */
export function scanRedFlags(text: string): RedFlagHit[] {
  if (!text) return [];
  const hits: RedFlagHit[] = [];
  for (const rule of RED_FLAG_RULES) {
    const m = text.match(rule.pattern);
    if (!m) continue;

    if (rule.id === 'spo2-low') {
      // The capture group is the SpO2 number — only escalate when
      // it's below 92. The LLM-derived text often includes "SpO2
      // 98%" which is normal and shouldn't trip the gate.
      const val = Number(m[1]);
      if (!Number.isFinite(val) || val >= 92) continue;
    }

    hits.push({ rule, matched: m[0] });
  }
  // Sort by escalation severity (1 = most urgent first) then by id
  // for stable output.
  return hits.sort((a, b) => a.rule.escalateTo - b.rule.escalateTo);
}

/** The single highest-priority ESI tier across all matched rules.
 *  Returns null when no rule fires. */
export function topEscalation(text: string): EsiTier | null {
  const hits = scanRedFlags(text);
  if (hits.length === 0) return null;
  return Math.min(...hits.map((h) => h.rule.escalateTo)) as EsiTier;
}

export const RED_FLAG_RULE_COUNT = RED_FLAG_RULES.length;
