/**
 * Confidence tag — graphify pattern.
 *
 *   EXTRACTED = directly stated in the source (case → topCondition is
 *               from the structured-output diagnostic agent)
 *   INFERRED  = reasonable deduction (drug → contraindication via the
 *               safety checker)
 *   AMBIGUOUS = low-confidence, flagged for human review (loose ICD-10
 *               match)
 *
 * Every edge gets a tag. We never silently bury inference as fact.
 */
export type ConfidenceTag = 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS';

/** Node kinds — narrow vocabulary keeps the graph queryable. */
export type NodeKind =
  | 'condition' // ICD-10-anchored disease state
  | 'symptom' // patient-reported chief complaint or finding
  | 'drug' // prescribed or current medication
  | 'specialty' // routing target (cardiology, neurology, …)
  | 'test' // recommended diagnostic test
  | 'icd10' // formal ICD-10 code
  | 'paper'; // PubMed / MeSH source

export interface GraphNode {
  /** Stable id, slugged from kind + label. */
  id: string;
  kind: NodeKind;
  /** Human-readable name. */
  label: string;
  /** First-seen timestamp (ms). Updated only when first inserted. */
  firstSeenAt: number;
  /** Last-touched timestamp (ms). Bumped on every re-extraction. */
  lastSeenAt: number;
  /** How many times we've seen this node mentioned. */
  mentionCount: number;
  /** Optional source pointer (consult id, paper id, file). */
  source?: string;
}

export interface GraphEdge {
  source: string; // node id
  target: string; // node id
  /** What relationship the edge represents. */
  relation:
    | 'presents-with' // condition presents-with symptom
    | 'treated-with' // condition treated-with drug
    | 'contraindicates' // drug contraindicates drug / condition
    | 'routes-to' // condition routes-to specialty
    | 'tested-by' // condition tested-by test
    | 'coded-as' // condition coded-as icd10
    | 'mentioned-in' // any node mentioned-in paper
    | 'co-occurs-with'; // symptom co-occurs-with symptom (statistical)
  confidence: ConfidenceTag;
  /** 0..1 strength when confidence is INFERRED or AMBIGUOUS. */
  weight?: number;
  /** Where the relationship was extracted from (consult id, paper id, file). */
  extractedFrom: string;
  /** First-seen timestamp (ms). */
  firstSeenAt: number;
}

export interface MedicalGraph {
  /** ISO timestamp of the last `saveGraph` call. */
  updatedAt: string;
  /** Schema version — bumped if extract.ts changes the shape. */
  version: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
  /**
   * SHA256 hashes of every source we've already processed. The next
   * cycle skips any source whose hash hasn't changed — that's the
   * graphify pattern, no re-processing of unchanged inputs.
   */
  cache: Record<string, string>;
}

export interface Extraction {
  /** What this extraction came from (consult id, paper id). */
  source: string;
  /** SHA256 of the input text (for cache invalidation). */
  sourceHash: string;
  nodes: Array<Omit<GraphNode, 'firstSeenAt' | 'lastSeenAt' | 'mentionCount'>>;
  edges: Array<Omit<GraphEdge, 'firstSeenAt'>>;
}

export interface GraphAnalysis {
  /** Most-connected nodes — the "god nodes" architects look at first. */
  godNodes: Array<{ id: string; label: string; kind: NodeKind; degree: number }>;
  /** Cross-cluster edges — the surprising connections. */
  surprises: Array<{ source: string; target: string; relation: string; reason: string }>;
  /** Connected components / clusters. */
  clusters: Array<{ id: string; size: number; topNodes: string[] }>;
  /** Suggested follow-up questions for Mörbius's next training cycle. */
  suggestedQuestions: string[];
}
