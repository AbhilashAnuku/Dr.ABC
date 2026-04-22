import type { Extraction, GraphEdge, GraphNode, MedicalGraph } from './types.ts';

// Pure (no node:* imports) so the web bundle can pull the graph types +
// merge logic without dragging in fs. File-IO helpers live in `./io.ts`.
export const SCHEMA_VERSION = 1;

/** Empty graph factory. */
export function emptyGraph(): MedicalGraph {
  return {
    updatedAt: new Date().toISOString(),
    version: SCHEMA_VERSION,
    nodes: [],
    edges: [],
    cache: {},
  };
}

/**
 * Build a graph from scratch given a list of extractions. Used by the
 * unit test + as a one-shot rebuild when the cache is invalidated.
 */
export function buildGraph(extractions: Extraction[]): MedicalGraph {
  const graph = emptyGraph();
  for (const e of extractions) {
    mergeGraph(graph, e);
  }
  return graph;
}

/**
 * Merge a single extraction into the persistent graph IN PLACE.
 *
 * Idempotent: re-running the same extraction doesn't duplicate
 * nodes (slug-keyed) and bumps `mentionCount` on existing nodes.
 *
 * Cache: if the extraction's `sourceHash` matches the cached hash for
 * this `source`, we skip — the source hasn't changed since last cycle.
 */
export function mergeGraph(graph: MedicalGraph, extraction: Extraction): boolean {
  const cached = graph.cache[extraction.source];
  if (cached === extraction.sourceHash) {
    return false; // skip — already merged this exact version
  }

  const now = Date.now();
  const nodeIndex = new Map<string, GraphNode>(graph.nodes.map((n) => [n.id, n]));
  const edgeKey = (e: GraphEdge): string => `${e.source}→${e.target}|${e.relation}`;
  const edgeIndex = new Map<string, GraphEdge>(graph.edges.map((e) => [edgeKey(e), e]));

  for (const n of extraction.nodes) {
    const existing = nodeIndex.get(n.id);
    if (existing) {
      existing.lastSeenAt = now;
      existing.mentionCount += 1;
    } else {
      const fresh: GraphNode = {
        ...n,
        firstSeenAt: now,
        lastSeenAt: now,
        mentionCount: 1,
      };
      graph.nodes.push(fresh);
      nodeIndex.set(fresh.id, fresh);
    }
  }

  for (const e of extraction.edges) {
    const key = edgeKey(e as GraphEdge);
    if (!edgeIndex.has(key)) {
      const fresh: GraphEdge = { ...e, firstSeenAt: now };
      graph.edges.push(fresh);
      edgeIndex.set(key, fresh);
    }
  }

  graph.cache[extraction.source] = extraction.sourceHash;
  return true;
}
