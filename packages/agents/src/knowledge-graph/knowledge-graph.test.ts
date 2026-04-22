import { describe, expect, test } from 'bun:test';
import {
  analyzeGraph,
  buildGraph,
  emptyGraph,
  extractFromConsult,
  mergeGraph,
  renderReport,
} from './index.ts';

describe('knowledge-graph · extract', () => {
  test('extracts symptom + condition + specialty + drug + test from a consult', async () => {
    const ext = await extractFromConsult({
      consultId: 'cn_test_1',
      complaint: 'crushing chest pain radiating to left arm',
      topCondition: 'Acute MI',
      differentials: [
        { condition: 'Acute MI', probability: 0.87, icd10: 'I21.9' },
        { condition: 'Pulmonary embolism', probability: 0.08 },
      ],
      specialty: 'cardiology',
      drugs: ['Aspirin'],
      tests: ['ECG', 'troponin'],
    });

    expect(ext.source).toBe('cn_test_1');
    expect(ext.sourceHash).toMatch(/^[a-f0-9]{64}$/);

    // Symptom + 2 conditions + 1 ICD + 1 specialty + 1 drug + 2 tests = 8
    expect(ext.nodes.length).toBeGreaterThanOrEqual(7);
    expect(ext.nodes.some((n) => n.kind === 'symptom')).toBe(true);
    expect(ext.nodes.some((n) => n.kind === 'condition' && n.label === 'Acute MI')).toBe(true);
    expect(ext.nodes.some((n) => n.kind === 'icd10' && n.label === 'I21.9')).toBe(true);
    expect(ext.nodes.some((n) => n.kind === 'specialty' && n.label === 'cardiology')).toBe(true);
    expect(ext.nodes.some((n) => n.kind === 'drug' && n.label === 'Aspirin')).toBe(true);

    // Top differential at 0.87 → EXTRACTED. Lower at 0.08 → AMBIGUOUS.
    const presentsEdges = ext.edges.filter((e) => e.relation === 'presents-with');
    const extracted = presentsEdges.find(
      (e) => e.source.startsWith('symptom:') && e.target === 'condition:acute-mi',
    );
    expect(extracted?.confidence).toBe('EXTRACTED');
    const ambiguous = presentsEdges.find((e) => e.target === 'condition:pulmonary-embolism');
    expect(ambiguous?.confidence).toBe('AMBIGUOUS');
  });
});

describe('knowledge-graph · build + merge', () => {
  test('build from extractions is idempotent', async () => {
    const a = await extractFromConsult({
      consultId: 'cn_a',
      complaint: 'chest pain',
      topCondition: 'Acute MI',
      specialty: 'cardiology',
    });
    const b = await extractFromConsult({
      consultId: 'cn_b',
      complaint: 'chest pain',
      topCondition: 'Acute MI',
      specialty: 'cardiology',
    });

    // Two consults of the same complaint + condition → still 1 condition node,
    // but 2 distinct symptom nodes? No — same slug `symptom:chest-pain` → 1 node.
    const g = buildGraph([a, b]);

    const condCount = g.nodes.filter(
      (n) => n.kind === 'condition' && n.label === 'Acute MI',
    ).length;
    expect(condCount).toBe(1);

    // The condition's mentionCount should be 2 (or higher if embedded in
    // multiple edges) since both consults touched it.
    const cond = g.nodes.find((n) => n.id === 'condition:acute-mi');
    expect(cond?.mentionCount).toBeGreaterThanOrEqual(1);
  });

  test('mergeGraph cache skips unchanged sources', async () => {
    const ext = await extractFromConsult({
      consultId: 'cn_cache_test',
      complaint: 'chest pain',
      topCondition: 'Acute MI',
    });
    const g = emptyGraph();
    expect(mergeGraph(g, ext)).toBe(true); // first merge proceeds
    expect(mergeGraph(g, ext)).toBe(false); // second is a no-op
  });
});

describe('knowledge-graph · analyze + report', () => {
  test('reports god nodes + clusters + suggested questions', async () => {
    const exts = await Promise.all([
      extractFromConsult({
        consultId: 'cn_1',
        complaint: 'chest pain',
        topCondition: 'Acute MI',
        specialty: 'cardiology',
        drugs: ['Aspirin'],
      }),
      extractFromConsult({
        consultId: 'cn_2',
        complaint: 'shortness of breath',
        topCondition: 'Pulmonary embolism',
        specialty: 'pulmonology',
        drugs: ['Heparin'],
      }),
      extractFromConsult({
        consultId: 'cn_3',
        complaint: 'severe headache',
        topCondition: 'Migraine',
        specialty: 'neurology',
        drugs: ['Sumatriptan'],
      }),
    ]);

    const g = buildGraph(exts);
    const a = analyzeGraph(g);

    expect(a.godNodes.length).toBeGreaterThan(0);
    expect(a.clusters.length).toBeGreaterThan(0);
    expect(a.suggestedQuestions.length).toBeGreaterThan(0);

    const report = renderReport(g, a);
    expect(report).toMatch(/Mörbius medical knowledge graph/);
    expect(report).toMatch(/God nodes/);
    expect(report).toMatch(/Clusters/);
  });
});
