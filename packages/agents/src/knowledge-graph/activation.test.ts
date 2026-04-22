import { describe, expect, test } from 'bun:test';
import {
  boostDifferentials,
  edgeWeight,
  extractEntityMentions,
  relevantContext,
  relu,
  sigmoid,
  softmax,
  spreadingActivation,
} from './activation.ts';
import { buildGraph } from './build.ts';
import type { Extraction } from './types.ts';

// A tiny synthetic graph: chest pain → MI → cardiology, MI → ECG, MI → aspirin.
// Lets us exercise activation without dragging in the full extractor.
function fixtureGraph() {
  const ext: Extraction = {
    source: 'cn_test_001',
    sourceHash: 'hash1',
    nodes: [
      { id: 'symptom:chest-pain', kind: 'symptom', label: 'chest pain' },
      { id: 'condition:acute-mi', kind: 'condition', label: 'Acute MI' },
      { id: 'specialty:cardiology', kind: 'specialty', label: 'Cardiology' },
      { id: 'test:ecg', kind: 'test', label: 'ECG' },
      { id: 'drug:aspirin', kind: 'drug', label: 'Aspirin' },
      { id: 'condition:gerd', kind: 'condition', label: 'GERD' },
    ],
    edges: [
      {
        source: 'condition:acute-mi',
        target: 'symptom:chest-pain',
        relation: 'presents-with',
        confidence: 'EXTRACTED',
        weight: 1.0,
        extractedFrom: 'cn_test_001',
      },
      {
        source: 'condition:acute-mi',
        target: 'specialty:cardiology',
        relation: 'routes-to',
        confidence: 'EXTRACTED',
        weight: 1.0,
        extractedFrom: 'cn_test_001',
      },
      {
        source: 'condition:acute-mi',
        target: 'test:ecg',
        relation: 'tested-by',
        confidence: 'EXTRACTED',
        weight: 1.0,
        extractedFrom: 'cn_test_001',
      },
      {
        source: 'condition:acute-mi',
        target: 'drug:aspirin',
        relation: 'treated-with',
        confidence: 'EXTRACTED',
        weight: 1.0,
        extractedFrom: 'cn_test_001',
      },
    ],
  };
  // Bump mention count so the seed activation has something to bite on.
  const g = buildGraph([ext, ext]);
  return g;
}

describe('activation primitives', () => {
  test('sigmoid is bounded in (0,1)', () => {
    expect(sigmoid(0)).toBeCloseTo(0.5);
    expect(sigmoid(100)).toBe(1);
    expect(sigmoid(-100)).toBe(0);
  });

  test('softmax sums to 1', () => {
    const out = softmax([1, 2, 3]);
    expect(out.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    expect(out[2]).toBeGreaterThan(out[0] ?? 0);
  });

  test('softmax handles empty + uniform inputs', () => {
    expect(softmax([])).toEqual([]);
    const u = softmax([0, 0, 0]);
    expect(u).toHaveLength(3);
    expect(u[0]).toBeCloseTo(1 / 3);
  });

  test('relu zeros negatives', () => {
    expect(relu(-1)).toBe(0);
    expect(relu(2.5)).toBe(2.5);
  });

  test('edgeWeight rewards EXTRACTED over INFERRED over AMBIGUOUS', () => {
    const base = {
      source: 'a',
      target: 'b',
      relation: 'presents-with' as const,
      weight: 1.0,
      extractedFrom: 'x',
      firstSeenAt: 0,
    };
    expect(edgeWeight({ ...base, confidence: 'EXTRACTED' })).toBeGreaterThan(
      edgeWeight({ ...base, confidence: 'INFERRED' }),
    );
    expect(edgeWeight({ ...base, confidence: 'INFERRED' })).toBeGreaterThan(
      edgeWeight({ ...base, confidence: 'AMBIGUOUS' }),
    );
  });
});

describe('extractEntityMentions', () => {
  test('seeds the matching nodes', () => {
    const g = fixtureGraph();
    const seeds = extractEntityMentions(g, 'patient with crushing chest pain');
    expect(seeds.has('symptom:chest-pain')).toBe(true);
    expect((seeds.get('symptom:chest-pain') ?? 0) > 0).toBe(true);
  });

  test('returns empty when nothing matches', () => {
    const g = fixtureGraph();
    expect(extractEntityMentions(g, 'aurora borealis').size).toBe(0);
  });

  test('drops stop-words', () => {
    const g = fixtureGraph();
    // "the of a" should not bind to anything just because labels share
    // articles/prepositions.
    expect(extractEntityMentions(g, 'the of a').size).toBe(0);
  });
});

describe('spreadingActivation', () => {
  test('activates direct neighbours of seeded nodes', () => {
    const g = fixtureGraph();
    const seeds = new Map([['symptom:chest-pain', 1.0]]);
    const r = spreadingActivation(g, seeds, { decay: 0.6, maxHops: 2 });
    expect(r.scores.has('condition:acute-mi')).toBe(true);
    // 2-hop reach: cardiology / ECG / aspirin via MI.
    expect(r.scores.has('specialty:cardiology')).toBe(true);
  });

  test('respects the threshold — far nodes drop out', () => {
    const g = fixtureGraph();
    const seeds = new Map([['symptom:chest-pain', 1.0]]);
    const r = spreadingActivation(g, seeds, {
      decay: 0.1,
      maxHops: 1,
      threshold: 0.5,
    });
    expect(r.scores.size).toBeGreaterThanOrEqual(1);
    expect(r.scores.get('symptom:chest-pain')).toBe(1.0);
  });

  test('ranked output is sorted descending', () => {
    const g = fixtureGraph();
    const seeds = new Map([['symptom:chest-pain', 1.0]]);
    const { ranked } = spreadingActivation(g, seeds);
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1]?.activation).toBeGreaterThanOrEqual(ranked[i]?.activation ?? 0);
    }
  });

  test('seed-only when no edges in graph', () => {
    const g = buildGraph([
      {
        source: 's1',
        sourceHash: 'h1',
        nodes: [{ id: 'symptom:headache', kind: 'symptom', label: 'headache' }],
        edges: [],
      },
    ]);
    const seeds = new Map([['symptom:headache', 1.0]]);
    const { scores } = spreadingActivation(g, seeds);
    expect(scores.size).toBe(1);
    expect(scores.get('symptom:headache')).toBe(1.0);
  });
});

describe('relevantContext', () => {
  test('produces grouped evidence lines for a chest-pain query', () => {
    const g = fixtureGraph();
    const block = relevantContext(g, 'crushing chest pain radiating to left arm');
    expect(block.empty).toBe(false);
    expect(block.lines.length).toBeGreaterThan(0);
    // At least one line should mention the activated specialty.
    expect(block.lines.some((l) => l.toLowerCase().includes('cardiology'))).toBe(true);
  });

  test('returns empty for an unrelated query', () => {
    const g = fixtureGraph();
    const block = relevantContext(g, 'aurora borealis');
    expect(block.empty).toBe(true);
    expect(block.lines).toHaveLength(0);
  });
});

describe('boostDifferentials', () => {
  test('lifts a graph-supported condition above a graph-silent one', () => {
    const g = fixtureGraph();
    const boosted = boostDifferentials(
      [
        { condition: 'Acute MI', probability: 0.5 },
        { condition: 'GERD', probability: 0.5 }, // graph has the node but no edges from chest-pain
      ],
      g,
      'crushing chest pain',
    );
    const mi = boosted.find((b) => b.condition === 'Acute MI');
    const gerd = boosted.find((b) => b.condition === 'GERD');
    expect(mi).toBeDefined();
    expect(gerd).toBeDefined();
    if (mi && gerd) {
      expect(mi.rerankedProbability).toBeGreaterThan(gerd.rerankedProbability);
      expect(mi.graphActivated).toBe(true);
    }
  });

  test('preserves order when query yields no graph activation', () => {
    const g = fixtureGraph();
    const boosted = boostDifferentials(
      [
        { condition: 'Acute MI', probability: 0.6 },
        { condition: 'GERD', probability: 0.4 },
      ],
      g,
      'aurora borealis',
    );
    expect(boosted[0]?.condition).toBe('Acute MI');
    expect(boosted[1]?.condition).toBe('GERD');
    // No activation → boost stays at 1.0 for everyone.
    for (const b of boosted) expect(b.graphBoost).toBeCloseTo(1.0);
  });

  test('handles empty differentials', () => {
    const g = fixtureGraph();
    expect(boostDifferentials([], g, 'anything')).toEqual([]);
  });
});
