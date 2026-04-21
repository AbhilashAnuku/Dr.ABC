import { describe, expect, it } from 'bun:test';
import {
  DEFAULT_THRESHOLDS,
  type StageStats,
  THRESHOLD_MAX,
  THRESHOLD_MIN,
  THRESHOLD_STEP,
  calibrateStage,
  runCalibrationCycle,
  statsFromActivity,
} from './calibrator.ts';

const makeStats = (overrides: Partial<StageStats> = {}): StageStats => ({
  firedCount: 0,
  falsePositives: 0,
  falseNegatives: 0,
  totalEvaluations: 0,
  ...overrides,
});

describe('calibrateStage', () => {
  it('holds steady when sample is below threshold', () => {
    const result = calibrateStage(0.7, makeStats({ totalEvaluations: 5 }));
    expect(result.delta).toBe(0);
    expect(result.reason.toLowerCase()).toContain('insufficient');
  });

  it('tightens when FNR exceeds 10%', () => {
    const result = calibrateStage(
      0.7,
      makeStats({ totalEvaluations: 100, firedCount: 20, falseNegatives: 10 }),
    );
    // 10 false negatives out of 80 negatives = 12.5% > 10% → tighten
    expect(result.next).toBe(0.65);
    expect(result.delta).toBeCloseTo(-THRESHOLD_STEP, 3);
    expect(result.reason).toContain('tighten');
  });

  it('loosens when FPR > 30% and FNR < 5%', () => {
    const result = calibrateStage(
      0.7,
      makeStats({ totalEvaluations: 100, firedCount: 50, falsePositives: 20 }),
    );
    // 20/50 = 40% FPR · 0/50 = 0% FNR → loosen
    expect(result.next).toBe(0.75);
    expect(result.delta).toBeCloseTo(THRESHOLD_STEP, 3);
    expect(result.reason).toContain('loosen');
  });

  it('holds steady in the tolerance band', () => {
    const result = calibrateStage(
      0.7,
      makeStats({ totalEvaluations: 100, firedCount: 30, falsePositives: 5, falseNegatives: 3 }),
    );
    expect(result.delta).toBe(0);
    expect(result.reason).toContain('within tolerance');
  });

  it('respects the THRESHOLD_MIN floor', () => {
    const result = calibrateStage(
      THRESHOLD_MIN,
      makeStats({ totalEvaluations: 100, firedCount: 20, falseNegatives: 10 }),
    );
    expect(result.next).toBe(THRESHOLD_MIN);
    expect(result.delta).toBe(0);
  });

  it('respects the THRESHOLD_MAX ceiling', () => {
    const result = calibrateStage(
      THRESHOLD_MAX,
      makeStats({ totalEvaluations: 100, firedCount: 50, falsePositives: 20 }),
    );
    expect(result.next).toBe(THRESHOLD_MAX);
    expect(result.delta).toBe(0);
  });
});

describe('runCalibrationCycle', () => {
  it('updates each stage independently', () => {
    const out = runCalibrationCycle({
      thresholds: { ...DEFAULT_THRESHOLDS },
      stats: {
        validator: makeStats({ totalEvaluations: 100, firedCount: 20, falseNegatives: 10 }),
        safety: makeStats({ totalEvaluations: 100, firedCount: 50, falsePositives: 20 }),
        privacy: makeStats({
          totalEvaluations: 100,
          firedCount: 30,
          falsePositives: 5,
          falseNegatives: 3,
        }),
      },
    });
    expect(out.thresholds.validator).toBeLessThan(DEFAULT_THRESHOLDS.validator);
    expect(out.thresholds.safety).toBeGreaterThan(DEFAULT_THRESHOLDS.safety);
    expect(out.thresholds.privacy).toBe(DEFAULT_THRESHOLDS.privacy);
    expect(out.notes.length).toBe(3);
  });

  it('emits one note per stage with reason text', () => {
    const out = runCalibrationCycle({
      thresholds: { ...DEFAULT_THRESHOLDS },
      stats: {
        validator: makeStats(),
        safety: makeStats(),
        privacy: makeStats(),
      },
    });
    for (const note of out.notes) {
      expect(['validator', 'safety', 'privacy']).toContain(note.stage);
      expect(note.reason.length).toBeGreaterThan(0);
    }
  });
});

describe('statsFromActivity', () => {
  it('buckets entries by stage and counts fires + verdicts', () => {
    const entries = [
      { action: 'gauntlet.passed', status: 'ok', payload: { stage: 'validator' } },
      {
        action: 'gauntlet.failed',
        status: 'error',
        payload: { stage: 'validator', verdict: 'falsePositive' },
      },
      { action: 'gauntlet.passed', status: 'ok', payload: { stage: 'safety' } },
      {
        action: 'gauntlet.failed',
        status: 'error',
        payload: { stage: 'privacy', verdict: 'falseNegative' },
      },
    ];
    const stats = statsFromActivity(entries);
    expect(stats.validator.totalEvaluations).toBe(2);
    expect(stats.validator.firedCount).toBe(1);
    expect(stats.validator.falsePositives).toBe(1);
    expect(stats.safety.totalEvaluations).toBe(1);
    expect(stats.safety.firedCount).toBe(0);
    expect(stats.privacy.firedCount).toBe(1);
    expect(stats.privacy.falseNegatives).toBe(1);
  });

  it('ignores entries without a stage payload', () => {
    const stats = statsFromActivity([
      { action: 'orchestrate.completed', status: 'ok' },
      { action: 'orchestrate.completed', status: 'ok', payload: {} },
    ]);
    expect(stats.validator.totalEvaluations).toBe(0);
    expect(stats.safety.totalEvaluations).toBe(0);
    expect(stats.privacy.totalEvaluations).toBe(0);
  });
});
