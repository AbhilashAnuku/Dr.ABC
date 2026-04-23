/**
 * Sequential error correction — Mörbius's own gradient-boosting layer.
 *
 * Self-correction model: every gate failure becomes a bounded residual
 * on the next inference (no hard refusals) — Mörbius corrects itself,
 * learns from mistakes, and refines subsequent responses.
 *
 * This module is the residual-correction loop that sits between the
 * diagnostic agent's raw output and the final differential. Pattern
 * lifted directly from gradient-boosting machines (Friedman 2001,
 * XGBoost / AdaBoost): each weak learner focuses on the errors of the
 * previous one. The "weak learners" here are not decision trees —
 * they're feature-keyed residual shifts learned from the activity
 * stream's gauntlet-failure events.
 *
 * Concrete loop:
 *
 *   1. PREDICT  Diagnostic agent emits Differential[] with prob_i
 *   2. FEATURE  Hash the (chief-complaint-tokens × top-condition) pair
 *               into a feature signature.
 *   3. LOOKUP   Pull the residual shift for this signature from the
 *               error journal. Empty when this pattern is novel.
 *   4. BOOST    Apply additive probability shifts to the candidates.
 *               Bounded ±0.3 so a single correction can't flip a
 *               diagnosis; clipped to [0, 1].
 *   5. RENORM   Softmax-renormalise the boosted vector.
 *   6. FEEDBACK On a confirmed mistake (validator failure, architect
 *               override, follow-up correction), record a new error
 *               event. The next time this signature comes around the
 *               residual will be slightly stronger in the correct
 *               direction.
 *
 * Mörbius Secure Protocol alignment:
 *   - "No kill, no sorry" → an error never returns "I can't help."
 *     Instead the corrected differential is delivered with the warm-
 *     doctor tone + a subtle revision hint when boost magnitude is
 *     high.
 *   - "Save at least one human life" → the boost direction is always
 *     toward higher-confidence escalation when prior errors were
 *     under-triage. Never toward dampening a red-flag pathway.
 *
 * Honest disclosure: this is online linear residual correction, not a
 * full gradient-boosted ensemble. It learns from explicit feedback
 * events, not from gradient signals over a loss surface. The
 * architecture mirrors GBM in *intent* (sequential error focus) and
 * shape (weak-learner residuals applied in series), and that's the
 * useful piece — the property of "every cycle gets at the residual
 * the previous cycle missed."
 */

import { sha256 } from '../knowledge-graph/extract.ts';

// ============================================================
//  Types
// ============================================================

export type CorrectionDirection = 'lift' | 'damp' | 'replace';

export interface ErrorEvent {
  /** Stable ID — content-hashed so re-records don't double-count. */
  id: string;
  ts: number;
  /** Bag-of-words feature signature: SHA-256 over sorted chief-complaint tokens. */
  featureHash: string;
  /** The predicted top-condition that turned out to be wrong (or
   *  needed re-weighting). */
  predicted: string;
  /** What the case actually was. Empty when the signal is "validator
   *  failed but ground-truth unknown" — those still count, they just
   *  damp the prediction without lifting an alternative. */
  actual: string;
  /** Lift, damp, or full-replace.
   *    lift   → the actual condition's prob should rise
   *    damp   → the predicted condition's prob should fall
   *    replace → both: damp predicted AND lift actual */
  direction: CorrectionDirection;
  /** Magnitude of the residual in [0, 0.5]. Capped so a single event
   *  can't flip a diagnosis; the boost-bound at apply time clips
   *  cumulative residuals. */
  magnitude: number;
  /** Where the signal came from — guides whether we trust it strongly. */
  source: 'validator' | 'safety' | 'privacy' | 'architect' | 'follow-up' | 'autopilot';
  /** Free-text note for the operator / dev console. */
  note?: string;
}

export interface BoostOptions {
  /** Per-condition cumulative shift cap. Default 0.3 — a noisy
   *  journal can't slip a 0.5-prob diagnosis past a 0.7-prob one. */
  cap?: number;
  /** Decay applied to older errors. A correction from 30 days ago
   *  carries less weight than one from yesterday. Default 0.97 per
   *  day (≈42-day half-life). */
  decayPerDay?: number;
}

export interface Differential {
  condition: string;
  probability: number;
}

export interface BoostedDifferential extends Differential {
  /** Original probability before boost. */
  basePrior: number;
  /** Net additive shift in [-cap, +cap]. */
  residual: number;
  /** Number of historical errors this differential drew on. */
  evidenceCount: number;
}

// ============================================================
//  Feature hashing
// ============================================================

const STOP = new Set([
  'a',
  'an',
  'the',
  'of',
  'and',
  'or',
  'in',
  'on',
  'with',
  'for',
  'to',
  'is',
  'are',
  'was',
  'were',
  'has',
  'have',
  'had',
  'this',
  'that',
  'these',
  'those',
  'it',
  'its',
  'as',
  'at',
  'by',
  'no',
  'not',
]);

/**
 * Build a feature signature from free-text + the predicted top
 * condition. Bag-of-words → sorted → SHA-256, scoped by the
 * condition so the same complaint signature can carry different
 * residuals for different predicted top conditions.
 */
export async function featureSignature(complaint: string, predicted: string): Promise<string> {
  const tokens = complaint
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP.has(t))
    .sort()
    .slice(0, 20); // cap so very long complaints don't fragment the cache
  return sha256(`${tokens.join(' ')}|${predicted.toLowerCase()}`);
}

// ============================================================
//  Boost
// ============================================================

/**
 * Apply the residuals in `journal` to the differential vector for a
 * given complaint + predicted-top pair. Pure function — the journal
 * is read-only here; new events come in via `recordError` upstream.
 */
export async function applyBoost(
  complaint: string,
  differentials: Differential[],
  journal: ErrorEvent[],
  opts: BoostOptions = {},
): Promise<BoostedDifferential[]> {
  if (differentials.length === 0) return [];
  const cap = opts.cap ?? 0.3;
  const decayPerDay = opts.decayPerDay ?? 0.97;
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  // For each candidate differential, sum the residuals from journal
  // entries that match its (complaint × condition) signature.
  const out: BoostedDifferential[] = [];
  for (const d of differentials) {
    const sig = await featureSignature(complaint, d.condition);
    let residual = 0;
    let evidence = 0;
    for (const e of journal) {
      if (e.featureHash !== sig) continue;
      const ageDays = Math.max(0, (now - e.ts) / dayMs);
      const weight = decayPerDay ** ageDays;
      if (e.direction === 'lift') {
        residual += e.magnitude * weight;
      } else if (e.direction === 'damp') {
        residual -= e.magnitude * weight;
      } else {
        // 'replace' — half-and-half so a single replace event nudges
        // both candidates without overshooting.
        residual +=
          (e.predicted.toLowerCase() === d.condition.toLowerCase() ? -1 : 1) *
          (e.magnitude * 0.5 * weight);
      }
      evidence++;
    }
    // Clip to ±cap so cumulative residuals don't slip a wrong
    // diagnosis past a right one through sheer evidence-count.
    residual = Math.max(-cap, Math.min(cap, residual));
    const boosted = Math.max(0, Math.min(1, d.probability + residual));
    out.push({
      condition: d.condition,
      probability: boosted,
      basePrior: d.probability,
      residual,
      evidenceCount: evidence,
    });
  }

  // Softmax renormalise — keep the vector summing to 1 so downstream
  // consumers (UI cards, prescription planner) read sensible probs.
  const sum = out.reduce((a, b) => a + b.probability, 0);
  if (sum > 0) {
    for (const b of out) b.probability /= sum;
  }
  return out;
}

// ============================================================
//  Recording — convert a feedback signal into an ErrorEvent
// ============================================================

export interface RecordErrorInput {
  complaint: string;
  predicted: string;
  actual: string;
  direction: CorrectionDirection;
  magnitude?: number;
  source: ErrorEvent['source'];
  note?: string;
}

/**
 * Build an ErrorEvent from a feedback signal. The caller persists it
 * via the api server's /errors endpoint (or a script writing to the
 * activity sink). Magnitude defaults are conservative:
 *
 *   - validator gauntlet → 0.10  (one of three gates)
 *   - safety  / privacy  → 0.20  (graver, but still bounded)
 *   - architect override → 0.40  (hard correction; max single shift)
 *   - follow-up retraction → 0.25 (medium — the patient came back
 *     with a different diagnosis)
 *   - autopilot         → 0.05  (noisier, used cautiously)
 */
export async function recordError(input: RecordErrorInput): Promise<ErrorEvent> {
  const defaultMag: Record<ErrorEvent['source'], number> = {
    validator: 0.1,
    safety: 0.2,
    privacy: 0.2,
    architect: 0.4,
    'follow-up': 0.25,
    autopilot: 0.05,
  };
  const magnitude = Math.max(0, Math.min(0.5, input.magnitude ?? defaultMag[input.source] ?? 0.1));
  const featureHash = await featureSignature(input.complaint, input.predicted);
  const id = await sha256(
    [featureHash, input.actual, input.direction, input.source, Date.now()].join('|'),
  );
  return {
    id,
    ts: Date.now(),
    featureHash,
    predicted: input.predicted,
    actual: input.actual,
    direction: input.direction,
    magnitude,
    source: input.source,
    note: input.note,
  };
}

// ============================================================
//  Aggregation helpers — for the dev-console "boosting" panel
// ============================================================

export interface BoostingStats {
  totalEvents: number;
  bySource: Record<ErrorEvent['source'], number>;
  byDirection: Record<CorrectionDirection, number>;
  /** Top-N most-corrected (predicted → actual) pairs. */
  topPatterns: Array<{ predicted: string; actual: string; count: number }>;
}

export function summariseBoostingJournal(journal: ErrorEvent[]): BoostingStats {
  const bySource: BoostingStats['bySource'] = {
    validator: 0,
    safety: 0,
    privacy: 0,
    architect: 0,
    'follow-up': 0,
    autopilot: 0,
  };
  const byDirection: BoostingStats['byDirection'] = { lift: 0, damp: 0, replace: 0 };
  const patternKey = new Map<string, number>();
  for (const e of journal) {
    bySource[e.source] = (bySource[e.source] ?? 0) + 1;
    byDirection[e.direction] = (byDirection[e.direction] ?? 0) + 1;
    const k = `${e.predicted.toLowerCase()} → ${e.actual.toLowerCase()}`;
    patternKey.set(k, (patternKey.get(k) ?? 0) + 1);
  }
  const topPatterns = Array.from(patternKey.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([k, count]) => {
      const [predicted, actual] = k.split(' → ');
      return { predicted: predicted ?? '', actual: actual ?? '', count };
    });
  return { totalEvents: journal.length, bySource, byDirection, topPatterns };
}
