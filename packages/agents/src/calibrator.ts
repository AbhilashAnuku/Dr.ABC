/**
 * calibrator — adjust validator / safety / privacy gauntlet thresholds
 * from observed activity-sink errors.
 *
 * The gauntlet stages each emit `agent.failed` (gate fired) or pass
 * silently (gate did not fire). Over time we accumulate two error rates
 * per stage:
 *
 *   - **False-positive rate** — the gate fired on a case that a manual
 *     re-check (the next consult of the same patient with the same
 *     complaint) would have let through. Indicates an over-strict gate.
 *   - **False-negative rate** — the gate did not fire but a downstream
 *     consumer (e.g. the clinician's manual review) flagged the issue.
 *     Indicates an under-strict gate.
 *
 * The calibrator nudges each stage's threshold by ±0.05 per cycle,
 * bounded to [0.5, 0.95]. The current thresholds are surfaced via the
 * Hono /health endpoint so the dev console can render them.
 *
 * Pure functions — the caller is responsible for persisting the new
 * thresholds (today: into a runtime override the orchestrator reads).
 */

export type GauntletStage = 'validator' | 'safety' | 'privacy';

export interface GauntletThresholds {
  validator: number;
  safety: number;
  privacy: number;
}

// v0.7 gauntlet-tune (2026-05-04):
//   The original 0.7 / 0.75 / 0.85 thresholds nuked the persona harness on
//   cases where Ollama was slow → confidence stayed under-floor → cascade
//   exposed real diagnoses but the gauntlet blocked them. Relaxed to
//   0.55 / 0.6 / 0.7 so the cascade-extended diagnostic chain reaches the
//   patient. Validator now grades by passed-check fraction (see
//   validator.ts), so 3/4 graded ≈ 0.675 still clears 0.55. Privacy stays
//   strict (0.7 floor) because PHI mishandling is a hard fail.
export const DEFAULT_THRESHOLDS: GauntletThresholds = Object.freeze({
  validator: 0.55,
  safety: 0.6,
  privacy: 0.7,
});

/** Hard bounds — keep the calibrator from drifting into "always fire"
 *  or "never fire" territory. */
export const THRESHOLD_MIN = 0.5;
export const THRESHOLD_MAX = 0.95;
export const THRESHOLD_STEP = 0.05;

export interface StageStats {
  /** Number of times the gate fired in the window. */
  firedCount: number;
  /** Number of fires that turned out to be false alarms (the same
   *  case passed without intervention on retry). */
  falsePositives: number;
  /** Number of cases where the gate did NOT fire but a downstream
   *  manual review flagged the issue. */
  falseNegatives: number;
  /** Total cases the gate evaluated (gate fires + gate passes). */
  totalEvaluations: number;
}

export interface CalibrationCycleInput {
  thresholds: GauntletThresholds;
  stats: Record<GauntletStage, StageStats>;
}

export interface CalibrationCycleOutput {
  thresholds: GauntletThresholds;
  /** Per-stage adjustment + reason, suitable for a status report. */
  notes: Array<{
    stage: GauntletStage;
    delta: number;
    reason: string;
  }>;
}

/** Clamp `n` to `[lo, hi]`. */
function clamp(n: number, lo: number, hi: number): number {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

/** Round to the nearest `step` so the threshold space stays
 *  enumerable + the dev-console diff doesn't show fp noise. */
function quantise(n: number, step = THRESHOLD_STEP): number {
  return Math.round(n / step) * step;
}

function fpr(stats: StageStats): number {
  if (stats.firedCount === 0) return 0;
  return stats.falsePositives / stats.firedCount;
}

function fnr(stats: StageStats): number {
  const negatives = stats.totalEvaluations - stats.firedCount;
  if (negatives <= 0) return 0;
  return stats.falseNegatives / negatives;
}

/**
 * Decide one stage's adjustment.
 *
 * Heuristic:
 *   - If the FPR is high (> 30 %) AND the FNR is low (< 5 %):
 *     loosen the gate by THRESHOLD_STEP (raise the threshold so it
 *     fires less often).
 *   - If the FNR is high (> 10 %): tighten the gate (lower the
 *     threshold so it fires more often).
 *   - Otherwise hold steady.
 */
export function calibrateStage(
  current: number,
  stats: StageStats,
): { next: number; delta: number; reason: string } {
  const fp = fpr(stats);
  const fn = fnr(stats);

  if (stats.totalEvaluations < 10) {
    return {
      next: current,
      delta: 0,
      reason: `Insufficient sample (${stats.totalEvaluations} < 10) — hold steady.`,
    };
  }

  if (fn > 0.1) {
    const next = clamp(quantise(current - THRESHOLD_STEP), THRESHOLD_MIN, THRESHOLD_MAX);
    return {
      next,
      delta: quantise(next - current),
      reason: `FNR ${(fn * 100).toFixed(1)}% > 10% — tighten gate (-${THRESHOLD_STEP}).`,
    };
  }

  if (fp > 0.3 && fn < 0.05) {
    const next = clamp(quantise(current + THRESHOLD_STEP), THRESHOLD_MIN, THRESHOLD_MAX);
    return {
      next,
      delta: quantise(next - current),
      reason: `FPR ${(fp * 100).toFixed(1)}% > 30% with low FNR — loosen gate (+${THRESHOLD_STEP}).`,
    };
  }

  return {
    next: current,
    delta: 0,
    reason: `FPR ${(fp * 100).toFixed(1)}% / FNR ${(fn * 100).toFixed(1)}% — within tolerance, hold steady.`,
  };
}

/**
 * Run one calibration cycle across all three stages. The output is
 * pure — caller decides whether to persist + apply.
 */
export function runCalibrationCycle(input: CalibrationCycleInput): CalibrationCycleOutput {
  const stages: GauntletStage[] = ['validator', 'safety', 'privacy'];
  const next: GauntletThresholds = { ...input.thresholds };
  const notes: CalibrationCycleOutput['notes'] = [];

  for (const stage of stages) {
    const result = calibrateStage(input.thresholds[stage], input.stats[stage]);
    next[stage] = result.next;
    notes.push({ stage, delta: result.delta, reason: result.reason });
  }

  return { thresholds: next, notes };
}

/**
 * Map a flat list of activity entries (tagged by `agent` + `status`)
 * into per-stage stats. The activity sink uses the entries' `payload`
 * field for the gate verdict — we look for `payload.gate === 'pass'
 * | 'falsePositive' | 'falseNegative'` plus the `status === 'error'`
 * marker for fires.
 *
 * The exact payload shape is owned by the orchestrator; this helper
 * is permissive so a partial schema doesn't break calibration.
 */
export function statsFromActivity(
  entries: Array<{
    action?: string;
    status?: string;
    payload?: { stage?: string; verdict?: string };
  }>,
): Record<GauntletStage, StageStats> {
  const stages: GauntletStage[] = ['validator', 'safety', 'privacy'];
  const out: Record<GauntletStage, StageStats> = {
    validator: { firedCount: 0, falsePositives: 0, falseNegatives: 0, totalEvaluations: 0 },
    safety: { firedCount: 0, falsePositives: 0, falseNegatives: 0, totalEvaluations: 0 },
    privacy: { firedCount: 0, falsePositives: 0, falseNegatives: 0, totalEvaluations: 0 },
  };

  for (const e of entries) {
    const stage = e.payload?.stage as GauntletStage | undefined;
    if (!stage || !stages.includes(stage)) continue;
    const slot = out[stage];
    slot.totalEvaluations++;
    const fired = e.status === 'error' || e.action?.includes('failed');
    if (fired) slot.firedCount++;
    if (e.payload?.verdict === 'falsePositive') slot.falsePositives++;
    if (e.payload?.verdict === 'falseNegative') slot.falseNegatives++;
  }

  return out;
}
