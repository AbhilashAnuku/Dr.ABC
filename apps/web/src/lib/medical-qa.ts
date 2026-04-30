/**
 * Mörbius Doctor Chat — instant client-side medical Q&A.
 *
 * No network. No API key needed. Pattern-matches the user's question
 * against:
 *   1. The local disease catalog — 50 conditions across the ICD-10
 *      chapters most frequently surfaced (see medical-qa-data.ts).
 *   2. A FAQ of common medical questions (drugs, when-to-call-911, CPR).
 *   3. Action templates (book appointment, find doctor, insurance).
 *
 * Returns a structured response: a short answer + bullet points + a
 * "what to do next" CTA + a clinician-handoff disclaimer when relevant.
 *
 * For symptom-style queries that look like an emergency, returns an
 * `escalate` flag — the caller routes to /api/orchestrate so the real
 * Triage agent handles it.
 */

import { DISEASES, type DiseaseEntry } from './medical-qa-data.ts';

export type { DiseaseEntry } from './medical-qa-data.ts';

export interface ChatResponse {
  answer: string;
  bullets?: string[];
  cta?: { label: string; to: string };
  disclaimer?: string;
  /** True if Mörbius should escalate to the orchestrator (real Triage). */
  escalate?: boolean;
  /** A pun-free spoken summary for the TTS (kept short for natural speech). */
  spoken: string;
  /** Optional structured payload for the chat UI to render rich extras. */
  meta?: {
    icd10?: string;
    specialty?: string;
    redFlags?: string[];
    mimics?: string[];
  };
}

// Common questions that don't map to a specific disease
const FAQ: Array<{ pattern: RegExp; response: () => ChatResponse }> = [
  {
    pattern: /\b(when|should i)\b.*(call|go to)\b.*(911|er|emergency|hospital)/i,
    response: () => ({
      answer: 'Call 911 (or 112 in Europe) immediately for any of these:',
      bullets: [
        'Chest pain or pressure lasting more than a few minutes, especially with sweating, nausea, or arm pain',
        'Sudden weakness or numbness on one side, slurred speech, or face droop (stroke)',
        'Severe difficulty breathing or blue lips',
        '"Worst headache of your life" or sudden severe headache with neck stiffness',
        "Heavy bleeding that won't stop after 10 minutes of pressure",
        'Loss of consciousness or seizures lasting > 5 minutes',
        'Severe allergic reaction with throat swelling or difficulty breathing',
        'Suicidal thoughts with a plan',
      ],
      disclaimer:
        'When in doubt, call. It is always better to be sent home than to wait at home and worsen.',
      spoken:
        'Call emergency services for chest pain, stroke symptoms, severe breathing difficulty, the worst headache of your life, heavy bleeding, loss of consciousness, severe allergic reactions, or active suicidal thoughts.',
    }),
  },
  {
    pattern: /\b(paracetamol|acetaminophen|tylenol|panadol)\b/i,
    response: () => ({
      answer: 'Paracetamol (acetaminophen) is a first-line analgesic and antipyretic.',
      bullets: [
        'Adult dose: 500–1000 mg every 4–6 hours, maximum 4 g per 24 hours',
        'Safer than ibuprofen if you have ulcers, kidney disease, or are on blood thinners',
        'Liver-toxic in overdose — never combine with alcohol or take more than 4 g/day',
        'Children: weight-based dosing (10–15 mg/kg every 4–6 h)',
      ],
      disclaimer:
        'If you have liver disease, talk to a clinician before regular use. Overdose can cause irreversible liver failure.',
      spoken:
        'Paracetamol — adults can take 500 to 1000 milligrams every 4 to 6 hours, no more than 4 grams in 24 hours. Avoid if you have liver disease.',
    }),
  },
  {
    pattern: /\b(ibuprofen|advil|nurofen|brufen)\b/i,
    response: () => ({
      answer:
        'Ibuprofen is an NSAID — works for pain, inflammation, and fever, but has more side effects than paracetamol.',
      bullets: [
        'Adult dose: 200–400 mg every 4–6 hours, max 1.2 g/day OTC, 2.4 g/day prescription',
        'Always take with food — risk of gastric ulcers',
        'Avoid if you have kidney disease, ulcers, asthma, or are pregnant in 3rd trimester',
        "Don't combine with other NSAIDs or anticoagulants without medical advice",
      ],
      disclaimer:
        'NSAIDs can raise blood pressure and worsen heart failure. Use the lowest dose for the shortest time.',
      spoken:
        'Ibuprofen — 200 to 400 milligrams every 4 to 6 hours, with food. Avoid if you have kidney problems, ulcers, or asthma.',
    }),
  },
  {
    pattern: /\b(cpr|cardiopulmonary)\b/i,
    response: () => ({
      answer: 'Adult CPR — push hard and fast in the centre of the chest.',
      bullets: [
        'Check for response. Shout for help. Call 911 (or have someone else call).',
        'Place heel of one hand in the centre of the chest, other hand on top',
        'Compressions: at least 5 cm (2 inches) deep, rate 100–120 per minute',
        'If trained: 30 compressions, then 2 rescue breaths, repeat',
        'If untrained: hands-only CPR is fine — keep going until paramedics arrive',
        'Use an AED as soon as one is available — follow voice prompts',
      ],
      disclaimer:
        'Take a hands-on CPR class — Red Cross or local equivalent. Watching is not enough; muscle memory matters in the moment.',
      spoken:
        'Adult CPR — push the centre of the chest hard and fast, at least 2 inches deep, 100 to 120 times per minute. Use an AED if available. Keep going until paramedics arrive.',
    }),
  },
  {
    pattern: /\b(book|schedule|make).*appointment/i,
    response: () => ({
      answer: 'Open the Appointments page to book.',
      cta: { label: 'Open Appointments', to: '/app/appointments' },
      spoken: 'Opening Appointments — pick a date, time, and clinician type.',
    }),
  },
  {
    pattern: /\b(insurance|coverage|premium|gkv|pkv)\b/i,
    response: () => ({
      answer:
        'Open the Insurance planner — pick your country, income, and family size to estimate your monthly premium across Essential, Standard, and Premium tiers.',
      cta: { label: 'Open Insurance', to: '/app/insurance' },
      spoken:
        'Insurance planner is open — pick your country and income to estimate monthly premiums.',
    }),
  },
  {
    pattern: /\b(my profile|my data|my record|my info)/i,
    response: () => ({
      answer:
        'Your profile holds your demographics, allergies, conditions, medications, and insurance — stored as a portable FHIR R4 bundle.',
      cta: { label: 'Open Profile', to: '/app/profile' },
      spoken: 'Opening your profile.',
    }),
  },
];

// Symptom keywords that should escalate to real Triage
const EMERGENCY_KEYWORDS = [
  'chest pain',
  'crushing chest',
  'shortness of breath',
  'cant breathe',
  "can't breathe",
  'face droop',
  'slurred speech',
  'sudden weakness',
  'worst headache',
  'severe bleeding',
  'unconscious',
  'overdose',
  'suicide',
  'self harm',
];

function findDisease(q: string): DiseaseEntry | undefined {
  // Match the longest synonym/name first so "chronic kidney disease" beats
  // "kidney disease" in the rare entry where both could match.
  let best: { entry: DiseaseEntry; matchLen: number } | undefined;
  for (const d of DISEASES) {
    const candidates = [d.name.toLowerCase(), ...(d.synonyms ?? []).map((s) => s.toLowerCase())];
    for (const c of candidates) {
      if (q.includes(c) && (!best || c.length > best.matchLen)) {
        best = { entry: d, matchLen: c.length };
      }
    }
  }
  return best?.entry;
}

export function answerMedicalQuestion(query: string): ChatResponse {
  const q = query.toLowerCase().trim();

  // 1. Emergency check — escalate to Triage
  if (EMERGENCY_KEYWORDS.some((k) => q.includes(k))) {
    return {
      answer: "I'm flagging this as urgent — running it through the Triage gauntlet now.",
      escalate: true,
      spoken: 'Flagging this as urgent. Running it through the Triage gauntlet.',
    };
  }

  // 2. FAQ pattern match
  for (const item of FAQ) {
    if (item.pattern.test(query)) return item.response();
  }

  // 3. Disease lookup — name match or synonym (longest first)
  const matched = findDisease(q);
  if (matched) {
    const isAboutTreatment = /\b(treat|treatment|medication|medicine|cure|drug|therapy)\b/.test(q);
    const isAboutPrevention = /\b(prevent|avoid|stop|reduce risk)\b/.test(q);
    const isWhenWorry = /\b(serious|emergency|urgent|when.*worry|red flag|dangerous)\b/.test(q);
    const isAboutMimics = /\b(differential|mimic|confused with|like|same as|other cause)\b/.test(q);

    let answer = matched.summary;
    const bullets: string[] = [];

    if (isAboutTreatment) {
      answer = matched.treatment;
    } else if (isAboutPrevention) {
      answer = matched.prevention;
    } else if (isWhenWorry) {
      answer = matched.whenToWorry;
      bullets.push(`Red flags: ${matched.redFlags.join(' · ')}`);
    } else if (isAboutMimics) {
      answer = `Conditions a clinician will rule out before confirming ${matched.name}:`;
      bullets.push(...matched.mimics);
    } else {
      bullets.push(`Treatment: ${matched.treatment}`);
      bullets.push(`Prevention: ${matched.prevention}`);
      bullets.push(`When to worry: ${matched.whenToWorry}`);
      bullets.push(`Red flags: ${matched.redFlags.join(' · ')}`);
      bullets.push(`Differentials: ${matched.mimics.join(' · ')}`);
    }

    return {
      answer,
      bullets: bullets.length > 0 ? bullets : undefined,
      cta: { label: 'See full clinical entry', to: '/app/diseases' },
      disclaimer:
        'Educational information only. Not a substitute for an in-person evaluation. Mörbius will not issue a prescription.',
      spoken:
        matched.summary.length > 200 ? `${matched.summary.slice(0, 200)}...` : matched.summary,
      meta: {
        icd10: matched.icd10,
        specialty: matched.specialty,
        redFlags: matched.redFlags,
        mimics: matched.mimics,
      },
    };
  }

  // 4. Generic symptom — escalate to Triage
  if (
    /\b(pain|hurt|ache|sick|nausea|vomit|fever|cough|tired|fatigue|dizz|swell|rash|bleed)/i.test(q)
  ) {
    return {
      answer:
        'Sounds like a symptom — let me run it through the Triage gauntlet for a proper severity check.',
      escalate: true,
      spoken: 'Running this through the Triage gauntlet.',
    };
  }

  // 5. Fallback — encourage rephrasing
  return {
    answer:
      "I can answer about specific conditions (try 'migraine treatment' or 'when to call 911'), or run a symptom check through the Triage agent if you describe what you're feeling.",
    bullets: [
      'Try: "what is hypertension treatment"',
      'Try: "ibuprofen dose"',
      'Try: "chest pain" — runs full Triage',
      'Try: "book an appointment"',
    ],
    cta: { label: 'Open full consult', to: '/app/consult' },
    spoken:
      'I can answer about specific conditions or run a symptom check. Try asking about a disease or treatment, or describe what you are feeling.',
  };
}

/** Build a typing-effect stream from a string (returns chunks). */
export async function* streamTyping(
  text: string,
  chunkSize = 4,
  delayMs = 24,
): AsyncGenerator<string> {
  let i = 0;
  while (i < text.length) {
    yield text.slice(i, i + chunkSize);
    i += chunkSize;
    await new Promise((r) => setTimeout(r, delayMs));
  }
}
