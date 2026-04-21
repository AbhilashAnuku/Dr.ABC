import type { ClaimWithCitations, Evidence } from '@dr-abc/types';

/**
 * Parses an LLM-generated synthesis into sentence-level claims with the
 * citation indices they reference.
 *
 *   Input:  "SGLT2 inhibitors reduce HF hospitalisation [1][3]. They also
 *            slow CKD progression [2]."
 *   Output: [
 *     { text: "SGLT2 inhibitors...", citations: [1, 3] },
 *     { text: "They also slow CKD progression.", citations: [2] }
 *   ]
 *
 * Tolerates [1, 2, 3], [1,3], [1][2], and merged groups of those.
 * Pure — no I/O, fully testable.
 */

const CITATION_RE = /\[(\d+(?:\s*,\s*\d+)*)\]/g;
// Sentence boundary that doesn't get fooled by "Dr.", "Mr.", "e.g.", "i.e.", "vs."
const SENTENCE_SPLIT_RE =
  /(?<![A-Z][a-z]?\.)(?<![ei]\.g\.)(?<![ei]\.e\.)(?<![vV][sS]?\.)(?<=[.!?])\s+(?=[A-Z(])/g;

export function parseCitations(answer: string): ClaimWithCitations[] {
  const sentences = answer
    .trim()
    .split(SENTENCE_SPLIT_RE)
    .filter((s) => s.length > 0);
  return sentences.map((sentence) => {
    const text = sentence.trim();
    const citations = new Set<number>();
    for (const match of text.matchAll(CITATION_RE)) {
      const group = match[1];
      if (!group) continue;
      for (const numStr of group.split(',')) {
        const n = Number.parseInt(numStr.trim(), 10);
        if (Number.isFinite(n) && n > 0) citations.add(n);
      }
    }
    return { text, citations: Array.from(citations).sort((a, b) => a - b) };
  });
}

/**
 * Returns the subset of evidence actually referenced in the parsed claims.
 * Uses 1-based indices to match the [n] convention LLMs are trained on.
 */
export function citedEvidence(evidence: Evidence[], claims: ClaimWithCitations[]): Evidence[] {
  const referenced = new Set<number>();
  for (const c of claims) {
    for (const n of c.citations) referenced.add(n);
  }
  return Array.from(referenced)
    .sort((a, b) => a - b)
    .map((n) => evidence[n - 1])
    .filter((e): e is Evidence => e !== undefined);
}

/**
 * Heuristic for whether a sentence makes a CLINICAL claim that requires
 * a citation. We err on the side of strict — anything that names a drug
 * dose, a recommendation verb, a numeric outcome, or a guideline trips it.
 *
 * This is the gate the Validator uses to fail unfootnoted claims.
 */
const CLINICAL_CLAIM_PATTERNS = [
  /\b(reduce|increase|prevent|treat|cure|recommended|first[- ]line|second[- ]line|gold standard)\b/i,
  /\b(mortality|morbidity|incidence|prevalence|hospitali[sz]ation|recurrence|relapse)\b/i,
  /\b(\d+(?:\.\d+)?\s*(mg|mcg|µg|g|ml|mmol|mmHg|%|years|months|weeks|days|hours))\b/i,
  /\b(meta[- ]analysis|systematic review|RCT|randomised controlled trial|guideline|cohort study)\b/i,
  /\b(?:NNT|HR|OR|RR|p\s*[<>]\s*0\.0?\d+)\b/, // statistical claims
];

export function isClinicalClaim(sentence: string): boolean {
  // Strip footnote markers before pattern matching so [1] in the middle
  // of a sentence doesn't change the heuristic.
  const stripped = sentence.replace(CITATION_RE, '').trim();
  return CLINICAL_CLAIM_PATTERNS.some((p) => p.test(stripped));
}

export interface CitedClaimsCheck {
  passed: boolean;
  /** Sentences that are clinical but lack a [n] footnote. */
  uncitedClaims: string[];
}

export function checkCitedClaims(claims: ClaimWithCitations[]): CitedClaimsCheck {
  const uncitedClaims = claims
    .filter((c) => isClinicalClaim(c.text) && c.citations.length === 0)
    .map((c) => c.text);
  return { passed: uncitedClaims.length === 0, uncitedClaims };
}
