import { clusterGraph } from './cluster.ts';
import type { GraphAnalysis, MedicalGraph } from './types.ts';

/**
 * Analyse a graph: surface god nodes (most connected), surprises
 * (cross-cluster edges), clusters, and follow-up questions for
 * Mörbius's next training cycle.
 *
 * Same shape graphify's `analyze.py` produces. This is what feeds
 * the dashboard's force-graph + the dev-console Research tab + the
 * `MEDICAL_GRAPH_REPORT.md` doc.
 */
export function analyzeGraph(graph: MedicalGraph): GraphAnalysis {
  const degree = new Map<string, number>();
  for (const n of graph.nodes) degree.set(n.id, 0);
  for (const e of graph.edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }

  // God nodes — top-15 by degree
  const nodeIndex = new Map(graph.nodes.map((n) => [n.id, n]));
  const godNodes = [...degree.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, 15)
    .flatMap(([id, deg]) => {
      const n = nodeIndex.get(id);
      return n ? [{ id: n.id, label: n.label, kind: n.kind, degree: deg }] : [];
    });

  // Clusters
  const rawClusters = clusterGraph(graph);
  const clusters = rawClusters.slice(0, 8).map((nodes, i) => ({
    id: `cluster-${i + 1}`,
    size: nodes.length,
    topNodes: nodes
      .map((id) => nodeIndex.get(id))
      .filter((n): n is NonNullable<typeof n> => n !== undefined)
      .sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0))
      .slice(0, 5)
      .map((n) => n.label),
  }));

  // Surprises — edges that cross clusters (non-trivial since we
  // computed components above; surprising edges are AMBIGUOUS / low
  // weight ones that link otherwise-disjoint regions). Connected
  // components by definition don't have cross edges, so we look for
  // INFERRED + AMBIGUOUS edges between high-degree nodes of
  // different sub-clusters within each component.
  const surprises: GraphAnalysis['surprises'] = [];
  for (const e of graph.edges) {
    if (e.confidence === 'AMBIGUOUS' && (e.weight ?? 0) > 0.2) {
      const a = nodeIndex.get(e.source);
      const b = nodeIndex.get(e.target);
      if (!a || !b) continue;
      if (a.kind !== b.kind) {
        surprises.push({
          source: a.label,
          target: b.label,
          relation: e.relation,
          reason: `cross-kind ${e.confidence} edge (${e.relation})`,
        });
      }
      if (surprises.length >= 10) break;
    }
  }

  // Suggested questions — pick the top god nodes and frame as a
  // training prompt. These get fed into the next LoRA fine-tune cycle.
  const suggestedQuestions = godNodes.slice(0, 5).map((g) => {
    if (g.kind === 'condition') {
      return `What are the most up-to-date guidelines for managing ${g.label} as of 2026?`;
    }
    if (g.kind === 'drug') {
      return `What recent evidence affects the prescribing of ${g.label}?`;
    }
    if (g.kind === 'symptom') {
      return `Beyond the obvious differentials, what less-common conditions present with ${g.label}?`;
    }
    return `Recent advances around ${g.label}?`;
  });

  return { godNodes, surprises, clusters, suggestedQuestions };
}
