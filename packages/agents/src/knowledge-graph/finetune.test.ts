import { describe, expect, test } from 'bun:test';
import {
  DECAY_ALPHA,
  ETA,
  MAX_WEIGHT,
  MIN_WEIGHT,
  PER_CYCLE_CAP,
  applyFineTuneCycle,
  isRedFlagNodeLabel,
  snapshotEdgeWeights,
} from './finetune.ts';
import type { GraphEdge, GraphNode, MedicalGraph } from './types.ts';

// --- Tiny synthetic graph fixture ---
//
//   sym:chest-pain ──presents-with──> cond:stemi   (red-flag target)
//   sym:chest-pain ──presents-with──> cond:gerd    (innocent)
//   cond:stemi     ──coded-as────────> icd:I21.0
//   cond:stemi     ──routes-to───────> spec:cardio
//
// Every weight starts at 1.0 so we can read deltas directly.

function buildFixtureGraph(): MedicalGraph {
  const now = Date.now();
  const nodes: GraphNode[] = [
    {
      id: 'sym:chest-pain',
      kind: 'symptom',
      label: 'crushing chest pain',
      firstSeenAt: now,
      lastSeenAt: now,
      mentionCount: 5,
    },
    {
      id: 'cond:stemi',
      kind: 'condition',
      label: 'Acute ST-elevation MI',
      firstSeenAt: now,
      lastSeenAt: now,
      mentionCount: 3,
    },
    {
      id: 'cond:gerd',
      kind: 'condition',
      label: 'Gastro-oesophageal reflux disease',
      firstSeenAt: now,
      lastSeenAt: now,
      mentionCount: 2,
    },
    {
      id: 'icd:I21.0',
      kind: 'icd10',
      label: 'I21.0',
      firstSeenAt: now,
      lastSeenAt: now,
      mentionCount: 1,
    },
    {
      id: 'spec:cardio',
      kind: 'specialty',
      label: 'Cardiology',
      firstSeenAt: now,
      lastSeenAt: now,
      mentionCount: 1,
    },
  ];
  const edges: GraphEdge[] = [
    {
      source: 'sym:chest-pain',
      target: 'cond:stemi',
      relation: 'presents-with',
      confidence: 'EXTRACTED',
      weight: 1.0,
      extractedFrom: 'fx',
      firstSeenAt: now,
    },
    {
      source: 'sym:chest-pain',
      target: 'cond:gerd',
      relation: 'presents-with',
      confidence: 'EXTRACTED',
      weight: 1.0,
      extractedFrom: 'fx',
      firstSeenAt: now,
    },
    {
      source: 'cond:stemi',
      target: 'icd:I21.0',
      relation: 'coded-as',
      confidence: 'EXTRACTED',
      weight: 1.0,
      extractedFrom: 'fx',
      firstSeenAt: now,
    },
    {
      source: 'cond:stemi',
      target: 'spec:cardio',
      relation: 'routes-to',
      confidence: 'EXTRACTED',
      weight: 1.0,
      extractedFrom: 'fx',
      firstSeenAt: now,
    },
  ];
  return { updatedAt: new Date().toISOString(), version: 1, nodes, edges, cache: {} };
}

describe('isRedFlagNodeLabel', () => {
  test('matches STEMI variants', () => {
    expect(isRedFlagNodeLabel('Acute ST-elevation MI')).toBe(true);
    expect(isRedFlagNodeLabel('STEMI · anterior wall')).toBe(true);
    expect(isRedFlagNodeLabel('myocardial infarction')).toBe(true);
  });
  test('matches sepsis / stroke / anaphylaxis / DKA', () => {
    expect(isRedFlagNodeLabel('Sepsis')).toBe(true);
    expect(isRedFlagNodeLabel('Ischaemic stroke')).toBe(true);
    expect(isRedFlagNodeLabel('Anaphylaxis')).toBe(true);
    expect(isRedFlagNodeLabel('DKA')).toBe(true);
    expect(isRedFlagNodeLabel('Acute appendicitis')).toBe(true);
  });
  test('does NOT match benign conditions', () => {
    expect(isRedFlagNodeLabel('GERD')).toBe(false);
    expect(isRedFlagNodeLabel('Common cold')).toBe(false);
    expect(isRedFlagNodeLabel('Tension headache')).toBe(false);
  });
});

describe('applyFineTuneCycle — happy path: validator passed, prediction == truth', () => {
  test('lifts activated edges around the correct condition', () => {
    const graph = buildFixtureGraph();
    const before = snapshotEdgeWeights(graph);
    const result = applyFineTuneCycle(
      graph,
      [
        {
          patientText: 'crushing chest pain radiating to left arm',
          predictedCondition: 'Acute ST-elevation MI',
          truthCondition: 'Acute ST-elevation MI',
          validatorPassed: true,
        },
      ],
      1,
      { applyDecay: false },
    );

    expect(result.cycleSeq).toBe(1);
    expect(result.signalsConsumed).toBe(1);
    expect(result.edgesUpdated).toBeGreaterThan(0);

    const after = snapshotEdgeWeights(graph);
    const symToStemi = after.get('sym:chest-pain::presents-with::cond:stemi') ?? 0;
    expect(symToStemi).toBeGreaterThan(
      before.get('sym:chest-pain::presents-with::cond:stemi') ?? 0,
    );
  });
});

describe('applyFineTuneCycle — misdiagnosis: prediction != truth', () => {
  test('damps edges to the wrong prediction, lifts edges to the truth', () => {
    const graph = buildFixtureGraph();
    const result = applyFineTuneCycle(
      graph,
      [
        {
          // Pretend the agent picked GERD when truth was STEMI.
          patientText: 'crushing chest pain',
          predictedCondition: 'Gastro-oesophageal reflux disease',
          truthCondition: 'Acute ST-elevation MI',
          validatorPassed: false,
        },
      ],
      1,
      { applyDecay: false },
    );

    expect(result.edgesUpdated).toBeGreaterThan(0);
    const after = snapshotEdgeWeights(graph);
    // The mis-prediction edge should be DAMPED.
    expect(after.get('sym:chest-pain::presents-with::cond:gerd') ?? 0).toBeLessThan(1.0);
    // The truth edge (red-flag protected) should never be damped, and
    // should be LIFTED by the recovery signal.
    expect(after.get('sym:chest-pain::presents-with::cond:stemi') ?? 0).toBeGreaterThan(1.0);
  });
});

describe('applyFineTuneCycle — red-flag guard', () => {
  test('never damps an edge feeding a red-flag condition', () => {
    const graph = buildFixtureGraph();
    // Try the worst-case: validator-failed prediction on a STEMI consult.
    // Even though "STEMI" is the predicted-but-failed condition, the
    // guard must protect every edge whose target is STEMI from being
    // damped — patient-safety floor.
    const before = snapshotEdgeWeights(graph);
    const result = applyFineTuneCycle(
      graph,
      [
        {
          patientText: 'crushing chest pain radiating to left arm',
          predictedCondition: 'Acute ST-elevation MI',
          truthCondition: 'Gastro-oesophageal reflux disease', // implausible but tests the guard
          validatorPassed: false,
        },
      ],
      1,
      { applyDecay: false },
    );

    const after = snapshotEdgeWeights(graph);
    // STEMI-targeted edges must NOT have moved downward.
    expect(after.get('sym:chest-pain::presents-with::cond:stemi') ?? 0).toBeGreaterThanOrEqual(
      before.get('sym:chest-pain::presents-with::cond:stemi') ?? 0,
    );
    expect(after.get('cond:stemi::coded-as::icd:I21.0') ?? 0).toBeGreaterThanOrEqual(
      before.get('cond:stemi::coded-as::icd:I21.0') ?? 0,
    );
    // The guard counter should be non-zero.
    expect(result.redFlagsGuarded).toBeGreaterThan(0);
  });

  test('skipRedFlagGuard=true lets the damp through (tests only)', () => {
    const graph = buildFixtureGraph();
    applyFineTuneCycle(
      graph,
      [
        {
          patientText: 'crushing chest pain',
          predictedCondition: 'Acute ST-elevation MI',
          truthCondition: 'Gastro-oesophageal reflux disease',
          validatorPassed: false,
        },
      ],
      1,
      { applyDecay: false, skipRedFlagGuard: true },
    );

    const after = snapshotEdgeWeights(graph);
    // Without the guard, the STEMI edge IS allowed to drop.
    expect(after.get('sym:chest-pain::presents-with::cond:stemi') ?? 0).toBeLessThan(1.0);
  });
});

describe('applyFineTuneCycle — bounded magnitude', () => {
  test('no single edge moves more than PER_CYCLE_CAP per cycle', () => {
    const graph = buildFixtureGraph();
    // Feed 50 identical passing signals — the cumulative signal would be
    // huge if uncapped. The cap must hold the per-cycle shift at ±0.3.
    const signals = Array.from({ length: 50 }, () => ({
      patientText: 'crushing chest pain',
      predictedCondition: 'Acute ST-elevation MI',
      truthCondition: 'Acute ST-elevation MI',
      validatorPassed: true,
      weight: 5.0,
    }));
    applyFineTuneCycle(graph, signals, 1, { applyDecay: false });
    const after = snapshotEdgeWeights(graph);
    for (const w of after.values()) {
      // Pre-cycle weights were all 1.0, so any delta beyond ±PER_CYCLE_CAP is a violation.
      expect(Math.abs(w - 1.0)).toBeLessThanOrEqual(PER_CYCLE_CAP + 1e-6);
    }
  });

  test('weights stay clamped within [MIN_WEIGHT, MAX_WEIGHT]', () => {
    const graph = buildFixtureGraph();
    // Many cycles of one-direction signals — verifies the absolute clamps.
    for (let i = 0; i < 200; i += 1) {
      applyFineTuneCycle(
        graph,
        [
          {
            patientText: 'crushing chest pain',
            predictedCondition: 'Acute ST-elevation MI',
            truthCondition: 'Acute ST-elevation MI',
            validatorPassed: true,
          },
        ],
        i + 1,
        { applyDecay: false },
      );
    }
    const after = snapshotEdgeWeights(graph);
    for (const w of after.values()) {
      expect(w).toBeLessThanOrEqual(MAX_WEIGHT + 1e-6);
      expect(w).toBeGreaterThanOrEqual(MIN_WEIGHT - 1e-6);
    }
  });
});

describe('applyFineTuneCycle — mean-reversion decay', () => {
  test('un-touched edges drift toward 1.0 when decay is enabled', () => {
    const graph = buildFixtureGraph();
    // Manually push one edge to an extreme value, then run a cycle with
    // a signal that DOESN'T touch it. The decay should pull it back
    // slightly toward 1.0.
    const e = graph.edges.find((x) => x.source === 'cond:stemi' && x.target === 'spec:cardio');
    expect(e).toBeDefined();
    if (!e) return;
    e.weight = 0.2;

    const result = applyFineTuneCycle(
      graph,
      [
        {
          // No signal involving cond:stemi at all -> the cardio routing
          // edge stays un-touched by the cycle and only sees decay.
          patientText: 'mild fever and runny nose',
          predictedCondition: 'Common cold',
          truthCondition: 'Common cold',
          validatorPassed: true,
        },
      ],
      1,
      { applyDecay: true },
    );

    // Decay should have nudged 0.2 -> 0.2 + DECAY_ALPHA * (1.0 - 0.2).
    const expected = 0.2 + DECAY_ALPHA * 0.8;
    expect(e.weight ?? 0).toBeCloseTo(expected, 5);
    expect(result.decayedEdges).toBeGreaterThan(0);
  });

  test('applyDecay=false skips the drift step', () => {
    const graph = buildFixtureGraph();
    const e = graph.edges.find((x) => x.source === 'cond:stemi' && x.target === 'spec:cardio');
    if (!e) return;
    e.weight = 0.2;

    const result = applyFineTuneCycle(
      graph,
      [
        {
          patientText: 'mild fever',
          predictedCondition: 'Common cold',
          truthCondition: 'Common cold',
          validatorPassed: true,
        },
      ],
      1,
      { applyDecay: false },
    );

    expect(e.weight).toBe(0.2);
    expect(result.decayedEdges).toBe(0);
  });
});

describe('applyFineTuneCycle — empty signals', () => {
  test('no signals = zero updates, valid result', () => {
    const graph = buildFixtureGraph();
    const result = applyFineTuneCycle(graph, [], 1, { applyDecay: false });
    expect(result.signalsConsumed).toBe(0);
    expect(result.edgesUpdated).toBe(0);
    expect(result.topStrengthened).toHaveLength(0);
    expect(result.topWeakened).toHaveLength(0);
  });
});

describe('applyFineTuneCycle — constants', () => {
  test('ETA = 0.05', () => expect(ETA).toBe(0.05));
  test('PER_CYCLE_CAP = 0.3', () => expect(PER_CYCLE_CAP).toBe(0.3));
  test('MIN_WEIGHT < MAX_WEIGHT', () => expect(MIN_WEIGHT).toBeLessThan(MAX_WEIGHT));
});
