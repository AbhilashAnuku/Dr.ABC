import type { GraphAnalysis, MedicalGraph } from './types.ts';

/**
 * Connected-component clustering. graphify uses Leiden (community
 * detection by edge density) which would need an extra dependency;
 * connected components is a no-dep approximation that already
 * surfaces the obvious clusters: cardiac stuff sticks together,
 * respiratory stuff sticks together, etc.
 *
 * Returns an array of clusters where each cluster is a list of node
 * ids. Sorted by size descending.
 */
export function clusterGraph(graph: MedicalGraph): Array<string[]> {
  const adj = new Map<string, Set<string>>();
  for (const n of graph.nodes) adj.set(n.id, new Set());
  for (const e of graph.edges) {
    adj.get(e.source)?.add(e.target);
    adj.get(e.target)?.add(e.source);
  }

  const visited = new Set<string>();
  const clusters: Array<string[]> = [];

  for (const startId of adj.keys()) {
    if (visited.has(startId)) continue;
    const cluster: string[] = [];
    const queue = [startId];
    while (queue.length > 0) {
      const id = queue.shift();
      if (!id) break;
      if (visited.has(id)) continue;
      visited.add(id);
      cluster.push(id);
      const neighbors = adj.get(id);
      if (neighbors) {
        for (const n of neighbors) {
          if (!visited.has(n)) queue.push(n);
        }
      }
    }
    clusters.push(cluster);
  }

  clusters.sort((a, b) => b.length - a.length);
  return clusters;
}
