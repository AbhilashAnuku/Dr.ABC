// Node-only file IO for the knowledge graph. Kept out of the package
// barrel (`./index.ts`) so the web bundle never pulls `node:fs/promises`.
// Server-side callers (api server, scripts/research-cycle.ts) import
// from `@dr-abc/agents/knowledge-graph/io` directly.

import { readFile, writeFile } from 'node:fs/promises';
import { SCHEMA_VERSION, emptyGraph } from './build.ts';
import type { MedicalGraph } from './types.ts';

/**
 * Load a persisted graph from JSON. Returns an empty graph if the file
 * is missing or schema-incompatible. Forward-compatible: never crashes
 * on an old version, just starts fresh.
 */
export async function loadGraph(path: string): Promise<MedicalGraph> {
  try {
    const text = await readFile(path, 'utf8');
    const parsed = JSON.parse(text) as MedicalGraph;
    if (parsed.version !== SCHEMA_VERSION) {
      console.warn(
        `medical-graph schema mismatch (file=${parsed.version}, code=${SCHEMA_VERSION}); starting fresh`,
      );
      return emptyGraph();
    }
    return parsed;
  } catch {
    return emptyGraph();
  }
}

/** Persist a graph back to JSON. */
export async function saveGraph(path: string, graph: MedicalGraph): Promise<void> {
  graph.updatedAt = new Date().toISOString();
  await writeFile(path, JSON.stringify(graph, null, 2));
}
