import { describe, expect, it } from 'bun:test';
import { SEED_CASES } from './case-seed.ts';

/**
 * The seed module's runtime path lives behind IndexedDB which Bun's
 * test runner does not have. We assert the *shape* of the seeded
 * dataset here: the runtime is exercised by the smoke-test + the
 * future accuracy harness.
 */

describe('SEED_CASES', () => {
  it('ships exactly 15 cases', () => {
    expect(SEED_CASES.length).toBe(15);
  });

  it('every case has a stable C### id', () => {
    for (const c of SEED_CASES) {
      expect(c.id).toMatch(/^C\d{3}$/);
    }
  });

  it('every case has a non-empty chief complaint + diagnosis + ICD-10', () => {
    for (const c of SEED_CASES) {
      expect(c.chiefComplaint.length).toBeGreaterThan(20);
      expect(c.diagnosis.length).toBeGreaterThan(2);
      expect(c.icd10).toMatch(/^[A-Z]\d{2}/);
    }
  });

  it('case ids are unique', () => {
    const ids = new Set(SEED_CASES.map((c) => c.id));
    expect(ids.size).toBe(SEED_CASES.length);
  });

  it('every specialist agent appears at least once', () => {
    const specialties = new Set(SEED_CASES.map((c) => c.specialty.toLowerCase()));
    for (const s of [
      'cardiology',
      'neurology',
      'pulmonology',
      'endocrinology',
      'dermatology',
      'pediatrics',
    ]) {
      expect(specialties.has(s)).toBe(true);
    }
  });

  it('daysAgo is monotonically decreasing (most recent last)', () => {
    for (let i = 1; i < SEED_CASES.length; i++) {
      const prev = SEED_CASES[i - 1];
      const cur = SEED_CASES[i];
      if (!prev || !cur) continue;
      expect(prev.daysAgo).toBeGreaterThanOrEqual(cur.daysAgo);
    }
  });

  it('drug list never contains an empty string', () => {
    for (const c of SEED_CASES) {
      for (const d of c.drugs) {
        expect(d.length).toBeGreaterThan(0);
      }
    }
  });
});
