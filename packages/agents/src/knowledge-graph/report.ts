import type { GraphAnalysis, MedicalGraph } from './types.ts';

/**
 * Render a Markdown report of the graph state — the equivalent of
 * graphify's `GRAPH_REPORT.md`. Lists god nodes, clusters, surprises,
 * and the suggested questions Mörbius should train on next.
 *
 * Output lives at `docs/status/MEDICAL_GRAPH_REPORT.md` and gets
 * regenerated every research-cycle.
 */
export function renderReport(graph: MedicalGraph, analysis: GraphAnalysis): string {
  const totalNodes = graph.nodes.length;
  const totalEdges = graph.edges.length;
  const tagCounts = graph.edges.reduce<Record<string, number>>((acc, e) => {
    acc[e.confidence] = (acc[e.confidence] ?? 0) + 1;
    return acc;
  }, {});
  const kindCounts = graph.nodes.reduce<Record<string, number>>((acc, n) => {
    acc[n.kind] = (acc[n.kind] ?? 0) + 1;
    return acc;
  }, {});

  const lines: string[] = [];
  lines.push('# Mörbius medical knowledge graph');
  lines.push('');
  lines.push(`Updated · **${graph.updatedAt}**`);
  lines.push('');
  lines.push(`- ${totalNodes} nodes · ${totalEdges} edges`);
  lines.push(
    `- nodes by kind · ${Object.entries(kindCounts)
      .map(([k, v]) => `${k} ${v}`)
      .join(' · ')}`,
  );
  lines.push(
    `- edges by confidence · ${Object.entries(tagCounts)
      .map(([k, v]) => `${k} ${v}`)
      .join(' · ')}`,
  );
  lines.push('');
  lines.push('## God nodes — most connected');
  lines.push('');
  lines.push('| Node | Kind | Degree |');
  lines.push('|---|---|---|');
  for (const g of analysis.godNodes) {
    lines.push(`| ${g.label} | ${g.kind} | ${g.degree} |`);
  }
  lines.push('');
  lines.push(`## Clusters · ${analysis.clusters.length}`);
  lines.push('');
  for (const c of analysis.clusters) {
    lines.push(`### ${c.id} · ${c.size} nodes`);
    lines.push(c.topNodes.map((n) => `- ${n}`).join('\n'));
    lines.push('');
  }
  lines.push('## Surprising connections');
  lines.push('');
  if (analysis.surprises.length === 0) {
    lines.push('_No surprising edges yet — graph is still small._');
  } else {
    for (const s of analysis.surprises) {
      lines.push(`- **${s.source}** ${s.relation} **${s.target}** — ${s.reason}`);
    }
  }
  lines.push('');
  lines.push('## Suggested follow-up questions for next training cycle');
  lines.push('');
  for (const q of analysis.suggestedQuestions) {
    lines.push(`- ${q}`);
  }
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(
    '_Pattern lifted from `safishamsi/graphify`. Confidence tags · `EXTRACTED` (directly stated) · `INFERRED` (reasonable deduction) · `AMBIGUOUS` (flagged for review)._',
  );

  return lines.join('\n');
}
