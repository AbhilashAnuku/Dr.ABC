import { BaseAgent } from '@dr-abc/morbius-core';
import {
  AgentKind,
  type ESILevel,
  Intent,
  type OrchestratorEvent,
  type Task,
  type TriageInput,
  type TriageOutput,
  type Vitals,
} from '@dr-abc/types';

/** Hard red-flag substrings — any match drops the patient to ESI 1 or 2. */
const RED_FLAG_PATTERNS: { pattern: RegExp; flag: string; esi: ESILevel }[] = [
  { pattern: /not breathing|no pulse|unresponsive/i, flag: 'arrest indicators', esi: 1 },
  { pattern: /crushing chest|chest pain.*radiat|left arm.*pain/i, flag: 'possible MI', esi: 2 },
  { pattern: /face droop|slurred speech|sudden weakness/i, flag: 'possible stroke', esi: 2 },
  { pattern: /worst headache.*ever/i, flag: 'possible SAH', esi: 2 },
  { pattern: /heavy bleeding|cannot stop.*bleeding/i, flag: 'uncontrolled hemorrhage', esi: 2 },
  // Mental-health crisis — direct AND indirect language, EN + DE. Real
  // patients in crisis rarely say "I am suicidal" — they more often
  // use phrases like "I want it to stop", "I'm done", "no reason to
  // keep going". The cost of one false positive (asking "are you
  // safe?") is much lower than the cost of one missed true positive.
  {
    pattern:
      /(suicid|self.?harm|want to die|kill myself|end it all|plan to harm|i.?m done|don.?t want to (be here|wake up|live|exist)|tired of living|no reason to (live|keep going|go on)|nothing left|can.?t go on|can.?t do this anymore|want it to (stop|end)|just want it to end|want everything to stop|sterben wollen|selbstmord|suizid|lebensm[üu]de|nicht mehr leben|(will|m[öo]chte).*aufh[öo]ren|(kann|will) nicht mehr|kein sinn mehr|soll aufh[öo]ren|schluss machen)/i,
    flag: 'self-harm risk',
    esi: 2,
  },
  // Hopelessness + isolation — not a crisis on its own but warrants
  // empathetic safety check + crisis resources (ESI 3 escalation).
  {
    pattern:
      /(hopeless|nothing matters|nobody cares|trapped|can.?t see a way out|hoffnungslos|ausweglos|niemand interessiert|gefangen)/i,
    flag: 'severe hopelessness',
    esi: 3,
  },
  { pattern: /anaphyla|throat closing|swelling.*tongue/i, flag: 'anaphylaxis', esi: 1 },
];

interface ClarificationResult {
  acknowledgement: string;
  questions: string[];
}

// Markers that suggest the patient is asking exploratory questions
// rather than describing a specific clinical episode. If any fire AND
// the input lacks specific clinical anchors (age + duration + vitals
// + concrete symptom), Mörbius asks before differentiating.
const EXPLORATORY_PATTERNS = [
  /\b(can you|could you|would you).*(suggest|recommend|tell me|help me|give me)\b/i,
  /\b(what should i|how do i|how can i|should i)\b/i,
  /\b(any tips|any advice|any meds|some meds|medication for)\b/i,
  /\b(is (this|that|it) normal|am i (fine|ok|okay)|should i (worry|be worried))\b/i,
  /\b(i get|i sometimes|i often|i usually|i have).*(headache|stomach pain|back pain|insomnia|anxiety|cough)\b/i,
  /\b(hi|hello|hey)\b\s*[!.]?\s*$/i,
];

// Specific-clinical-episode anchors. Presence of two or more skips
// the clarification path even on a short prompt.
const SPECIFIC_ANCHORS = [
  /\b\d+\s*(yo|year[s]?[- ]old|y\/o)\b/i, // age
  /\bfor\s+\d+\s+(min|minute|hour|hr|day|week|month)/i, // duration
  /\b(hr|heart rate|bp|blood pressure|spo2|temp|rr)\b\s*[:=]?\s*\d/i, // vitals
  /\b\d{2,3}\/\d{2,3}\b/, // blood pressure number
  /\b(crushing|tearing|sharp|throbbing|radiating|burning|stabbing|cramping)\b/i,
  /\b(post.?meal|post.?prandial|on exertion|at rest|nocturnal|while)\b/i,
];

function assessClarificationNeed(text: string, locale: string): ClarificationResult | null {
  const wordCount = text.trim().split(/\s+/).length;
  const lower = text.toLowerCase();

  const exploratoryHit = EXPLORATORY_PATTERNS.some((p) => p.test(text));
  const anchorHits = SPECIFIC_ANCHORS.reduce((n, p) => n + (p.test(text) ? 1 : 0), 0);

  // Decide: if input is short AND vague (<25 words OR exploratory
  // marker) AND has fewer than 2 specific anchors, ask first.
  const isVague = (wordCount < 25 || exploratoryHit) && anchorHits < 2;
  if (!isVague) return null;

  // Pick a topic so the questions are tailored rather than generic.
  const topic = inferTopic(lower);
  return clarificationFor(topic, locale);
}

function inferTopic(lower: string): string {
  if (/\b(headache|migraine|head pain|temple|forehead)\b/.test(lower)) return 'headache';
  if (/\b(chest|heart|palpit|cardiac)\b/.test(lower)) return 'chest';
  if (/\b(stomach|abdom|belly|nausea|vomit|diarr)\b/.test(lower)) return 'abdominal';
  if (/\b(cough|breath|wheez|chest tight|asthma|copd)\b/.test(lower)) return 'respiratory';
  if (/\b(anxious|anxiety|panic|worry|sleep|insomn|mood|depress|stress)\b/.test(lower))
    return 'mental';
  if (/\b(rash|skin|itch|lesion|mole|eczema|acne)\b/.test(lower)) return 'skin';
  if (/\b(joint|knee|back|shoulder|arthr|sprain|muscle)\b/.test(lower)) return 'musculoskeletal';
  if (/\b(fever|fatigue|tired|weakness|cold|flu)\b/.test(lower)) return 'general';
  return 'general';
}

function clarificationFor(topic: string, locale: string): ClarificationResult {
  const de = locale === 'de';
  const ack = de
    ? 'Ich höre Sie. Bevor ich Ihnen Medikamente oder eine Empfehlung vorschlage, möchte ich kurz nachfragen, damit das, was ich rate, auch zu Ihrer Situation passt.'
    : 'I hear you. Before I suggest medication or a plan, let me ask a few things so what I recommend actually fits your situation.';

  const byTopic: Record<string, { en: string[]; de: string[] }> = {
    headache: {
      en: [
        'How long have you been getting headaches — is this a new pattern, or something you have had on and off for a while?',
        'Where do you usually feel it — temples, forehead, one side, behind the eyes, all over?',
        'On a 0-10 scale, how bad does it usually get? And does anything make it better or worse — sleep, water, screens, caffeine, stress, your cycle?',
        'Any associated symptoms — nausea, light sensitivity, vision changes, neck stiffness, fever?',
        'What medication, if any, have you been taking for them, and any allergies I should know about?',
      ],
      de: [
        'Seit wann haben Sie diese Kopfschmerzen — neu, oder schon länger immer wieder?',
        'Wo genau spüren Sie es meistens — Schläfen, Stirn, eine Seite, hinter den Augen?',
        'Auf einer Skala von 0-10, wie stark ist es typisch? Und was macht es besser oder schlechter — Schlaf, Wasser, Bildschirme, Koffein, Stress, Zyklus?',
        'Andere Beschwerden dabei — Übelkeit, Lichtempfindlichkeit, Sehstörungen, Nackensteife, Fieber?',
        'Welche Medikamente haben Sie bisher genommen, und gibt es Allergien?',
      ],
    },
    chest: {
      en: [
        'When did this start, and is it constant or coming and going?',
        'Where exactly do you feel it — centre, left side, between the shoulder blades — and does it radiate anywhere?',
        'What does it feel like — pressure, sharp, burning, tearing?',
        'Does anything trigger it — exertion, lying flat, deep breath, after meals?',
        'Any breathlessness, sweating, dizziness, or palpitations along with it?',
      ],
      de: [
        'Wann hat es angefangen, und ist es ständig da oder kommt und geht?',
        'Wo genau spüren Sie es — Mitte, links, zwischen den Schulterblättern — und strahlt es irgendwohin aus?',
        'Wie fühlt es sich an — Druck, stechend, brennend, reißend?',
        'Was löst es aus — Anstrengung, Liegen, tiefes Atmen, nach dem Essen?',
        'Atemnot, Schwitzen, Schwindel oder Herzklopfen dabei?',
      ],
    },
    abdominal: {
      en: [
        'Where in the belly is it — upper, lower, one side, around the navel, all over?',
        'How long has it been going on, and is it constant or coming in waves?',
        'Any nausea, vomiting, diarrhoea, blood in stool, weight loss, or fever?',
        'Is it linked to meals — better after eating, worse after eating, certain foods?',
        'Any medications you take regularly, and when was your last normal bowel movement?',
      ],
      de: [
        'Wo im Bauch — oben, unten, eine Seite, um den Nabel, überall?',
        'Wie lange schon, und ist es ständig oder in Wellen?',
        'Übelkeit, Erbrechen, Durchfall, Blut im Stuhl, Gewichtsverlust, Fieber?',
        'Hängt es mit Essen zusammen — besser nach dem Essen, schlechter, bestimmte Lebensmittel?',
        'Welche Medikamente nehmen Sie regelmäßig, und wann war der letzte normale Stuhlgang?',
      ],
    },
    respiratory: {
      en: [
        'How long has the cough/breathing problem been going on, and is it getting better, worse, or stable?',
        'Any fever, chills, chest pain, wheeze, or coughing up anything coloured or blood-tinged?',
        'Triggers — cold air, exercise, dust, pets, lying down, certain times of day?',
        'Smoking history or any known asthma / COPD / recent respiratory illness?',
        'Any current medications (inhalers, antibiotics) and allergies?',
      ],
      de: [
        'Wie lange schon, und wird es besser, schlechter oder gleich?',
        'Fieber, Schüttelfrost, Brustschmerzen, Pfeifen, Auswurf — farbig oder blutig?',
        'Auslöser — kalte Luft, Sport, Staub, Tiere, Liegen, bestimmte Tageszeiten?',
        'Rauchen, bekanntes Asthma / COPD, kürzliche Atemwegsinfektion?',
        'Aktuelle Medikamente (Inhalatoren, Antibiotika) und Allergien?',
      ],
    },
    mental: {
      en: [
        'How long have you been feeling this way — days, weeks, months — and is it constant or coming in episodes?',
        'How is it affecting your sleep, appetite, work or studies, and your relationships?',
        'Any specific triggers — exams, work, a relationship, a health worry, finances?',
        "What helps even a little when you're feeling like this, and what makes it worse?",
        'Are you having any thoughts of harming yourself or feeling like you do not want to be here? You can answer honestly — this is a safe space.',
      ],
      de: [
        'Wie lange schon — Tage, Wochen, Monate — ständig oder in Phasen?',
        'Wie beeinflusst es Schlaf, Appetit, Arbeit / Studium und Beziehungen?',
        'Konkrete Auslöser — Prüfungen, Arbeit, Beziehung, Gesundheit, Finanzen?',
        'Was hilft auch nur ein bisschen, und was macht es schlechter?',
        'Haben Sie Gedanken, sich selbst zu verletzen oder nicht mehr leben zu wollen? Sie können ehrlich antworten — das hier ist ein sicherer Raum.',
      ],
    },
    skin: {
      en: [
        'Where on the body is it — and how long have you noticed it?',
        'Has it changed in colour, size, shape, or texture over time?',
        'Any itching, pain, oozing, or bleeding?',
        'Anything new recently — soap, detergent, lotion, medication, food, travel?',
        'Family history of skin conditions or allergies?',
      ],
      de: [
        'Wo am Körper — und seit wann?',
        'Hat es sich in Farbe, Größe, Form oder Struktur verändert?',
        'Juckt es, schmerzt, nässt oder blutet?',
        'Etwas Neues kürzlich — Seife, Waschmittel, Lotion, Medikament, Essen, Reise?',
        'Familiengeschichte mit Hauterkrankungen oder Allergien?',
      ],
    },
    musculoskeletal: {
      en: [
        'Where exactly does it hurt, and how long has it been bothering you?',
        'Did it start after an injury, after exercise, or did it just appear?',
        'Is it constant, or only with certain movements / positions?',
        'Any swelling, redness, warmth, weakness, or numbness?',
        'What have you tried — rest, ice, heat, medication, physiotherapy?',
      ],
      de: [
        'Wo genau tut es weh, und seit wann?',
        'Nach einer Verletzung, nach Sport, oder einfach so?',
        'Ständig, oder nur bei bestimmten Bewegungen / Positionen?',
        'Schwellung, Rötung, Wärme, Schwäche oder Taubheit?',
        'Was haben Sie schon probiert — Ruhe, Eis, Wärme, Medikamente, Physio?',
      ],
    },
    general: {
      en: [
        'Tell me a bit more — when did this start, and what does it feel like in your own words?',
        'How is it affecting your day — sleep, work, appetite, mood?',
        'Anything that makes it better or worse?',
        'Any other symptoms going on alongside it?',
        'What medications do you take, any allergies, and any conditions you are already managing?',
      ],
      de: [
        'Erzählen Sie mir etwas mehr — wann hat es angefangen, und wie fühlt es sich für Sie an?',
        'Wie beeinflusst es Ihren Tag — Schlaf, Arbeit, Appetit, Stimmung?',
        'Etwas, das es besser oder schlechter macht?',
        'Andere Symptome dabei?',
        'Welche Medikamente nehmen Sie, Allergien, vorbestehende Erkrankungen?',
      ],
    },
  };

  const fallback = byTopic.general ?? { en: [], de: [] };
  const block = byTopic[topic] ?? fallback;
  return {
    acknowledgement: ack,
    questions: de
      ? block.de.length > 0
        ? block.de
        : fallback.de
      : block.en.length > 0
        ? block.en
        : fallback.en,
  };
}

export class TriageAgent extends BaseAgent<TriageInput, TriageOutput> {
  readonly kind = AgentKind.Triage;
  readonly version = '0.1.0';
  readonly minConfidence = 0.6;

  canHandle(task: Task): boolean {
    return (
      task.intent === Intent.Symptom ||
      task.intent === Intent.Emergency ||
      task.intent === Intent.Ambiguous
    );
  }

  protected async reason(
    task: Task<TriageInput>,
    emit: (e: OrchestratorEvent) => void,
  ): Promise<{
    data: TriageOutput;
    confidence: number;
    evidence: string[];
    warnings: string[];
  }> {
    const input = task.payload as TriageInput | { text: string };
    const rawText = 'text' in input ? input.text : input.symptoms.map((s) => s.text).join('. ');
    // Red-flag scan must read ONLY the patient's words — NOT the system
    // prompt prefix (HOUSE_TONE_PREFIX / specialty prompt / tone layer).
    // The whole prompt arrives as one string joined by '\n\n'. The
    // safety protocol description inside HOUSE_TONE_PREFIX literally
    // mentions "suicide method instructions" in its SORRY rules, which
    // was matching the /suicid|self.?harm/i red-flag pattern and
    // triggering false ESI-2 escalation on every single consult
    // regardless of what the patient actually said (the
    // hypothyroidism-on-stable-vitals case the reviewer saw).
    // Fix: take only the last '\n\n'-delimited chunk if the prompt is
    // multi-part. The patient's actual turn is always the tail.
    const chunks = rawText.split(/\n{2,}/);
    const text = chunks.length > 1 ? (chunks[chunks.length - 1] ?? rawText) : rawText;

    emit({ type: 'agent.token', agent: this.kind, token: 'Scanning for red flags…' });

    const redFlags: string[] = [];
    let esi: ESILevel = 4;

    for (const rf of RED_FLAG_PATTERNS) {
      if (rf.pattern.test(text)) {
        redFlags.push(rf.flag);
        if (rf.esi < esi) esi = rf.esi;
      }
    }

    // Vitals-based escalation if structured input was provided
    if ('vitals' in input && input.vitals) {
      esi = this.escalateByVitals(esi, input.vitals, redFlags);
    }

    if (redFlags.length === 0) {
      esi = this.estimateNonUrgent(text);
    }

    // Conversational SOAP gate. If the patient input is vague /
    // exploratory and no red flag fired, a real doctor opens the
    // consult by asking ONE clarifying question — not walking through
    // a differential. The orchestrator chains us to the chat agent so
    // the prose is real LLM output (no canned acknowledgement), and
    // the chat agent boils the 5-Q list down to a single follow-up.
    const localeRaw = task.context?.locale ?? 'en';
    const localeShort = localeRaw.toLowerCase().slice(0, 2);
    const clarify = redFlags.length === 0 ? assessClarificationNeed(text, localeShort) : null;
    // Inline greeting check — handles the common openers in EN / DE.
    const greetingNow =
      redFlags.length === 0 &&
      /^(hi|hello|hey|good\s+(morning|afternoon|evening|night)|hallo|guten\s+(morgen|tag|abend))[\s,!.?]*$/i.test(
        text.trim(),
      );

    // Greetings + clarification turns both route to the chat agent
    // (LLM prose). Everything else with no red flag goes diagnostic
    // for the structured differential. Red-flag prompts also go
    // diagnostic — the gauntlet handles the escalation downstream.
    const suggestedNextAgent: AgentKind =
      greetingNow || clarify ? AgentKind.Chat : AgentKind.Diagnostic;

    const data: TriageOutput = {
      esi,
      redFlags,
      suggestedNextAgent,
      rationale:
        redFlags.length > 0
          ? `Red-flag indicators detected: ${redFlags.join(', ')}. Escalating to ESI ${esi}.`
          : clarify
            ? 'No red flags. Input is exploratory — opening with clarifying questions.'
            : `No red flags detected. Routine differential workup at ESI ${esi}.`,
      needsClarification: clarify ? true : undefined,
      clarifyingQuestions: clarify?.questions,
      acknowledgement: clarify?.acknowledgement,
    };

    return {
      data,
      confidence: redFlags.length > 0 ? 0.92 : clarify ? 0.85 : 0.74,
      evidence:
        redFlags.length > 0
          ? redFlags.map((f) => `red-flag:${f}`)
          : clarify
            ? [`esi:${esi}`, 'red-flags:none', 'needs-clarification']
            : [`esi:${esi}`, 'red-flags:none', 'routine-workup'],
      warnings: esi <= 2 ? ['URGENT — escalate to clinician immediately'] : [],
    };
  }

  private escalateByVitals(current: ESILevel, v: Vitals, flags: string[]): ESILevel {
    let esi = current;
    if (v.spo2Pct !== undefined && v.spo2Pct < 90) {
      flags.push(`SpO2 ${v.spo2Pct}%`);
      esi = Math.min(esi, 2) as ESILevel;
    }
    if (v.systolic !== undefined && v.systolic < 90) {
      flags.push(`hypotension ${v.systolic} mmHg`);
      esi = Math.min(esi, 2) as ESILevel;
    }
    if (v.hrBpm !== undefined && (v.hrBpm > 130 || v.hrBpm < 40)) {
      flags.push(`HR ${v.hrBpm} bpm`);
      esi = Math.min(esi, 3) as ESILevel;
    }
    if (v.tempC !== undefined && v.tempC >= 39.5) {
      flags.push(`fever ${v.tempC}°C`);
      esi = Math.min(esi, 3) as ESILevel;
    }
    return esi;
  }

  private estimateNonUrgent(text: string): ESILevel {
    const lower = text.toLowerCase();
    const moderate = ['fever', 'vomiting', 'severe pain', 'unable to', 'cannot'];
    if (moderate.some((m) => lower.includes(m))) return 3;
    return 4;
  }
}
