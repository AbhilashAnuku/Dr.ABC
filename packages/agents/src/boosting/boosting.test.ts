import { describe, expect, test } from 'bun:test';
import {
  type ErrorEvent,
  applyBoost,
  featureSignature,
  recordError,
  summariseBoostingJournal,
} from './index.ts';

describe('featureSignature', () => {
  test('same complaint + predicted → same signature (idempotent)', async () => {
    const a = await featureSignature('crushing chest pain radiating to left arm', 'GERD');
    const b = await featureSignature('crushing chest pain radiating to left arm', 'GERD');
    expect(a).toBe(b);
  });
  test('different predicted → different signature', async () => {
    const a = await featureSignature('crushing chest pain', 'GERD');
    const b = await featureSignature('crushing chest pain', 'Acute MI');
    expect(a).not.toBe(b);
  });
  test('token order does not matter (bag-of-words)', async () => {
    const a = await featureSignature('chest pain crushing', 'GERD');
    const b = await featureSignature('crushing chest pain', 'GERD');
    expect(a).toBe(b);
  });
});

describe('recordError', () => {
  test('default magnitudes per source', async () => {
    const v = await recordError({
      complaint: 'chest pain',
      predicted: 'GERD',
      actual: 'Acute MI',
      direction: 'replace',
      source: 'validator',
    });
    const a = await recordError({
      complaint: 'chest pain',
      predicted: 'GERD',
      actual: 'Acute MI',
      direction: 'replace',
      source: 'architect',
    });
    expect(a.magnitude).toBeGreaterThan(v.magnitude);
  });
  test('caps magnitude at 0.5', async () => {
    const e = await recordError({
      complaint: 'chest pain',
      predicted: 'GERD',
      actual: 'Acute MI',
      direction: 'lift',
      magnitude: 99,
      source: 'architect',
    });
    expect(e.magnitude).toBe(0.5);
  });
});

describe('applyBoost', () => {
  test('lift direction raises the actual condition', async () => {
    const sig = await featureSignature('crushing chest pain', 'Acute MI');
    const journal: ErrorEvent[] = [
      {
        id: 'e1',
        ts: Date.now(),
        featureHash: sig,
        predicted: 'GERD',
        actual: 'Acute MI',
        direction: 'lift',
        magnitude: 0.2,
        source: 'architect',
      },
    ];
    const boosted = await applyBoost(
      'crushing chest pain',
      [
        { condition: 'Acute MI', probability: 0.5 },
        { condition: 'GERD', probability: 0.5 },
      ],
      journal,
    );
    const mi = boosted.find((b) => b.condition === 'Acute MI');
    const gerd = boosted.find((b) => b.condition === 'GERD');
    expect(mi).toBeDefined();
    expect(gerd).toBeDefined();
    if (mi && gerd) {
      expect(mi.probability).toBeGreaterThan(gerd.probability);
      expect(mi.residual).toBeGreaterThan(0);
    }
  });

  test('damp direction lowers the predicted condition', async () => {
    const sig = await featureSignature('headache', 'Subarachnoid hemorrhage');
    const journal: ErrorEvent[] = [
      {
        id: 'e1',
        ts: Date.now(),
        featureHash: sig,
        predicted: 'Subarachnoid hemorrhage',
        actual: '',
        direction: 'damp',
        magnitude: 0.25,
        source: 'follow-up',
      },
    ];
    const boosted = await applyBoost(
      'headache',
      [
        { condition: 'Migraine', probability: 0.5 },
        { condition: 'Subarachnoid hemorrhage', probability: 0.5 },
      ],
      journal,
    );
    const sah = boosted.find((b) => b.condition === 'Subarachnoid hemorrhage');
    expect(sah).toBeDefined();
    if (sah) expect(sah.residual).toBeLessThan(0);
  });

  test('caps cumulative shift at the bound', async () => {
    const sig = await featureSignature('chest pain', 'Acute MI');
    // Stack 10 lift events of 0.5 → cumulative would be 5.0 raw,
    // must clip to default cap (0.3).
    const journal: ErrorEvent[] = Array.from({ length: 10 }, (_, i) => ({
      id: `e${i}`,
      ts: Date.now(),
      featureHash: sig,
      predicted: 'GERD',
      actual: 'Acute MI',
      direction: 'lift' as const,
      magnitude: 0.5,
      source: 'architect' as const,
    }));
    const boosted = await applyBoost(
      'chest pain',
      [{ condition: 'Acute MI', probability: 0.5 }],
      journal,
    );
    expect(boosted[0]?.residual).toBeLessThanOrEqual(0.3);
  });

  test('output sums to 1 (renormalised)', async () => {
    const journal: ErrorEvent[] = [];
    const boosted = await applyBoost(
      'chest pain',
      [
        { condition: 'A', probability: 0.4 },
        { condition: 'B', probability: 0.3 },
        { condition: 'C', probability: 0.3 },
      ],
      journal,
    );
    const sum = boosted.reduce((a, b) => a + b.probability, 0);
    expect(sum).toBeCloseTo(1);
  });

  test('older events decay (97% per day)', async () => {
    const sig = await featureSignature('chest pain', 'Acute MI');
    const ancient: ErrorEvent = {
      id: 'old',
      ts: Date.now() - 100 * 24 * 60 * 60 * 1000, // 100 days old
      featureHash: sig,
      predicted: 'GERD',
      actual: 'Acute MI',
      direction: 'lift',
      magnitude: 0.3,
      source: 'architect',
    };
    const recent: ErrorEvent = { ...ancient, id: 'new', ts: Date.now() };
    const boostOld = await applyBoost(
      'chest pain',
      [{ condition: 'Acute MI', probability: 0.5 }],
      [ancient],
    );
    const boostNew = await applyBoost(
      'chest pain',
      [{ condition: 'Acute MI', probability: 0.5 }],
      [recent],
    );
    expect(boostNew[0]?.residual).toBeGreaterThan(boostOld[0]?.residual ?? 0);
  });

  test('empty differentials → empty output', async () => {
    expect(await applyBoost('q', [], [])).toEqual([]);
  });
});

describe('summariseBoostingJournal', () => {
  test('aggregates by source + direction', async () => {
    const sig = await featureSignature('test', 'X');
    const journal: ErrorEvent[] = [
      {
        id: '1',
        ts: 0,
        featureHash: sig,
        predicted: 'X',
        actual: 'Y',
        direction: 'lift',
        magnitude: 0.1,
        source: 'validator',
      },
      {
        id: '2',
        ts: 0,
        featureHash: sig,
        predicted: 'X',
        actual: 'Y',
        direction: 'lift',
        magnitude: 0.1,
        source: 'architect',
      },
      {
        id: '3',
        ts: 0,
        featureHash: sig,
        predicted: 'A',
        actual: 'B',
        direction: 'damp',
        magnitude: 0.1,
        source: 'follow-up',
      },
    ];
    const s = summariseBoostingJournal(journal);
    expect(s.totalEvents).toBe(3);
    expect(s.bySource.validator).toBe(1);
    expect(s.bySource.architect).toBe(1);
    expect(s.byDirection.lift).toBe(2);
    expect(s.byDirection.damp).toBe(1);
    expect(s.topPatterns[0]?.predicted).toBe('x');
    expect(s.topPatterns[0]?.actual).toBe('y');
    expect(s.topPatterns[0]?.count).toBe(2);
  });
});
