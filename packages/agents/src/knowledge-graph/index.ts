/**
 * @dr-abc/agents · knowledge-graph
 *
 * Mörbius's medical knowledge graph — pattern lifted from
 * safishamsi/graphify (extract → build → cluster → analyze → report).
 *
 * Used by the daily research-cycle to build a persistent map of
 * conditions ↔ symptoms ↔ drugs ↔ specialties that grows every cycle.
 * The dashboard's force-graph + the dev-console Research tab both
 * read from `docs/status/medical-graph.json` produced by `build()`.
 *
 * The diff-aware learning pattern (from "Learn Anything 10x Faster"):
 *   - Each cycle, EXTRACT new nodes + edges from yesterday's consults
 *     and freshly-pulled abstracts.
 *   - BUILD merges the new extraction into the persistent graph.
 *   - The DELTA between yesterday and today's graph is what feeds the
 *     next LoRA fine-tune — Mörbius only learns what it didn't already
 *     know, never re-processing the whole corpus.
 */

export { extractFromConsult, extractFromAbstract } from './extract.ts';
// Note: `loadGraph` + `saveGraph` are NOT re-exported here — they live
// in `./io.ts` and are imported via `@dr-abc/agents/knowledge-graph/io`
// only by node-side callers (api server + scripts). Keeping them off
// the barrel prevents vite from pulling node:fs into the web bundle.
export { buildGraph, emptyGraph, mergeGraph } from './build.ts';
export { clusterGraph } from './cluster.ts';
export { analyzeGraph } from './analyze.ts';
export { renderReport } from './report.ts';
// Activation primitives — spreading activation, entity extraction,
// differential re-rank, plus sigmoid/softmax/relu helpers. Used by
// the diagnostic agent to ground prompts in graph evidence and by
// the neural-core viz to render the brain "lighting up" on each turn.
export {
  boostDifferentials,
  edgeWeight,
  extractEntityMentions,
  relevantContext,
  relu,
  sigmoid,
  softmax,
  spreadingActivation,
  type ActivationResult,
  type RelevantContextBlock,
  type RelevantContextOptions,
  type RerankInput,
  type RerankOutput,
  type SpreadOptions,
} from './activation.ts';
export type {
  ConfidenceTag,
  GraphNode,
  GraphEdge,
  MedicalGraph,
  Extraction,
  GraphAnalysis,
} from './types.ts';
