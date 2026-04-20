import { Intent } from '@dr-abc/types';

/**
 * IntentClassifier — rule-based fast path with LLM-backed ambiguity escalation.
 *
 * V0 is deterministic keyword routing. V1 swaps in a small fine-tuned BioBERT
 * classifier; V2 adds Claude/Ollama fallback when keyword score is low.
 */
export interface IntentScore {
  intent: Intent;
  score: number;
}

const KEYWORDS: Record<Intent, string[]> = {
  [Intent.Symptom]: [
    'pain',
    'ache',
    'hurt',
    'sore',
    'fever',
    'cough',
    'nausea',
    'dizzy',
    'short of breath',
    'chest',
    'headache',
    'rash',
    'bleeding',
    'symptom',
    'feel',
  ],
  [Intent.ImageAnalysis]: ['scan', 'x-ray', 'xray', 'mri', 'ct ', 'ultrasound', 'image', 'photo'],
  [Intent.AnatomyShow]: ['show me', 'visualize', '3d', 'anatomy', 'organ', 'render', 'view the'],
  [Intent.DrugQuery]: [
    'drug',
    'medication',
    'pill',
    'mg ',
    'dose',
    'side effect',
    'interaction',
    'pharma',
  ],
  [Intent.ReadAbout]: ['article', 'tell me about', 'what is'],
  [Intent.Research]: [
    'evidence for',
    'evidence base',
    'latest evidence',
    'pubmed',
    'clinical trial',
    'meta-analysis',
    'systematic review',
    'who fact sheet',
    'research on',
    'studies on',
    'literature on',
  ],
  [Intent.ProfileOp]: ['my profile', 'insurance', 'history', 'allergy', 'allergies'],
  [Intent.Prescription]: ['prescribe', 'prescription', 'rx ', 'refill'],
  [Intent.GeneralChat]: ['hi', 'hello', 'hey', 'thanks', 'help'],
  [Intent.Emergency]: [
    'emergency',
    'unconscious',
    'not breathing',
    'severe bleeding',
    'crushing chest',
    'stroke',
    'throat closing',
    'throat is closing',
    'face droop',
    'slurred speech',
    'anaphyla',
  ],
  [Intent.Ambiguous]: [],
};

export class IntentClassifier {
  classify(text: string): IntentScore {
    const lower = text.toLowerCase();

    // Emergency takes precedence — any match short-circuits.
    if (KEYWORDS[Intent.Emergency].some((k) => lower.includes(k))) {
      return { intent: Intent.Emergency, score: 1 };
    }

    let best: IntentScore = { intent: Intent.Ambiguous, score: 0 };
    for (const [intent, keywords] of Object.entries(KEYWORDS)) {
      if (intent === Intent.Emergency || intent === Intent.Ambiguous) continue;
      const hits = keywords.filter((k) => lower.includes(k)).length;
      const score = hits / Math.max(keywords.length, 1);
      if (score > best.score) {
        best = { intent: intent as Intent, score: Math.min(1, score * 4) };
      }
    }

    if (best.score < 0.15) {
      return { intent: Intent.Ambiguous, score: best.score };
    }
    return best;
  }
}
