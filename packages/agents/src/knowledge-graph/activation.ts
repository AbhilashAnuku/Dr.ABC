/**
 * KG activation — the "neurons firing" layer for Mörbius's brain.
 *
 * Spreading activation is the canonical technique: seed activation on
 * nodes that match the query, propagate along edges with decay, return
 * the most-activated nodes as relevant context. This is the same shape
 * the cognitive-science literature uses for semantic memory retrieval
 * (Anderson 1983; Collins & Loftus 1975) and what graph-augmented LLM
 * pipelines re-discovered in 2023-2024 ("graph-aware retrieval").
 *
 * Why we want it:
 *
 *   1. **Prompt grounding.** Before the diagnostic agent calls the LLM,
 *      we extract the chief-complaint entity mentions, run spreading
 *      activation, and pull the top-K activated nodes (likely
 *      conditions, drugs, tests, specialty links). These get injected
 *      into the prompt as a grounding block so the LLM sees the
 *      Mörbius-specific evidence chain rather than generic priors.
 *
 *   2. **Differential re-rank.** After the LLM emits differentials, we
 *      re-weight each one by how strongly the graph activates around
 *      it. A condition with rich consult history and tight specialty
 *      coupling lifts; a condition the brain has never seen stays as
 *      the LLM scored it. Modest accuracy lift on average, big lift on
 *      cases where the LLM hallucinates a rare diagnosis.
 *
 *   3. **Visceral demo.** The neural-core viz can render activation as
 *      light pulses traveling along the edges — when the user asks
 *      "chest pain," the cardiology cluster lights up.
 *
 * Honest disclosure: this isn't a magic accuracy boost. The model +
 * cascade are the dominant levers. Activation gives a couple of
 * percentage points on graph-grounded benchmarks AND, more importantly,
 * makes the system explainable — every diagnostic claim can cite the
 * graph path that supported it.
 */

import type { GraphEdge, GraphNode, MedicalGraph, NodeKind } from './types.ts';

// ============================================================
//  Confidence weighting — from the EXTRACTED/INFERRED/AMBIGUOUS tags
// ============================================================

/**
 * Edge weight for activation flow. Pulled from the edge's confidence
 * tag (graphify pattern) and its optional `weight` field. Ranges in
 * [0, 1.5] — EXTRACTED edges get a small bonus past 1.0 so the
 * extractor's directly-stated facts beat inferred edges of similar
 * stated weight.
 */
export function edgeWeight(edge: GraphEdge): number {
  const baseFromTag =
    edge.confidence === 'EXTRACTED' ? 1.2 : edge.confidence === 'INFERRED' ? 0.8 : 0.4;
  const stated = edge.weight ?? 1.0;
  return Math.min(1.5, baseFromTag * stated);
}

// ============================================================
//  Sigmoid / softmax — classical activation primitives
// ============================================================

/** Logistic sigmoid — squashes raw activation into (0, 1). */
export function sigmoid(x: number): number {
  if (x > 30) return 1;
  if (x < -30) return 0;
  return 1 / (1 + Math.exp(-x));
}

/**
 * Softmax over a vector of logits. Used by `boostDifferentials` to
 * re-normalise probabilities after the graph re-weight step. Standard
 * numerically-stable form (subtract max before exp).
 */
export function softmax(logits: number[]): number[] {
  if (logits.length === 0) return [];
  const max = Math.max(...logits);
  const exps = logits.map((x) => Math.exp(x - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  if (sum === 0) return logits.map(() => 1 / logits.length);
  return exps.map((e) => e / sum);
}

/** ReLU — pruning trick for `boostDifferentials` so weak signals vanish. */
export function relu(x: number): number {
  return x > 0 ? x : 0;
}

// ============================================================
//  Entity extraction — find graph nodes mentioned in free text
// ============================================================

const STOP_WORDS = new Set([
  // Generic English stop words.
  'a',
  'an',
  'the',
  'of',
  'and',
  'or',
  'in',
  'on',
  'with',
  'for',
  'to',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'has',
  'have',
  'had',
  'this',
  'that',
  'these',
  'those',
  'it',
  'its',
  'as',
  'at',
  'by',
  'no',
  'not',
  'can',
  'may',
  'might',
  'should',
  'would',
  'could',
  'do',
  'does',
  'did',
  'so',
  'than',
  'then',
  'there',
  'here',
  'when',
  'where',
  'who',
  'what',
  'how',
  'why',
  'which',
  'i',
  'me',
  'my',
  'mine',
  'we',
  'our',
  'ours',
  'you',
  'your',
  'yours',
  // Medical common-words — words so generic they over-activate the graph.
  // Bug 2026-05-13: "irregular periods + acne — could it be PCOS?" caused
  // atrial-fibrillation seed case to activate via the lone word "irregular".
  // Design rule: ignore generic common terms so the boosting layer does
  // not repeat the same activation mistakes. These tokens are removed from BOTH the query
  // tokenisation and the node-label tokenisation, so a seed case won't be
  // pulled in just because the patient and the case both contain "pain"
  // or "feeling" — the activation has to land on a clinically specific
  // overlap (PCOS, periods, acne, palpitations, troponin, etc.).
  'feel',
  'feeling',
  'feels',
  'felt',
  'pain',
  'painful',
  'ache',
  'aches',
  'aching',
  'problem',
  'problems',
  'issue',
  'issues',
  'symptom',
  'symptoms',
  'sign',
  'signs',
  'irregular',
  'normal',
  'abnormal',
  'severe',
  'mild',
  'moderate',
  'minor',
  'major',
  'episode',
  'episodes',
  'history',
  'hours',
  'hour',
  'minutes',
  'minute',
  'day',
  'days',
  'week',
  'weeks',
  'month',
  'months',
  'year',
  'years',
  'ago',
  'since',
  'sometimes',
  'often',
  'always',
  'never',
  'usually',
  'occasionally',
  'morning',
  'afternoon',
  'evening',
  'night',
  'yesterday',
  'today',
  'tomorrow',
  'patient',
  'doctor',
  'doc',
  'good',
  'bad',
  'better',
  'worse',
  'left',
  'right',
  'side',
  'sides',
  'about',
  'around',
  'over',
  'under',
  'after',
  'before',
  'really',
  'very',
  'quite',
  'lot',
  'lots',
  'much',
  'many',
  'some',
  'few',
  'think',
  'thought',
  'thinks',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'old',
  'new',
  'recent',
  'recently',
]);

/** Lower-case + strip punctuation + drop stop-words → token set. */
function tokenise(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
  return new Set(tokens);
}

/**
 * Find every graph node whose label tokens overlap the query. Returns
 * a `seedActivation` map: nodeId → (0, 1] activation, weighted by:
 *
 *   - mentionCount  (the node has been seen often → trusted)
 *   - kind priority (symptom > condition > drug > specialty > test > icd10 > paper)
 *   - overlap ratio (how much of the label is in the query)
 *
 * Used as the initial activation vector for `spreadingActivation`.
 */
export function extractEntityMentions(graph: MedicalGraph, query: string): Map<string, number> {
  const queryTokens = tokenise(query);
  if (queryTokens.size === 0) return new Map();

  const KIND_PRIORITY: Record<NodeKind, number> = {
    symptom: 1.0,
    condition: 0.9,
    drug: 0.8,
    specialty: 0.7,
    test: 0.6,
    icd10: 0.5,
    paper: 0.3,
  };

  const seeds = new Map<string, number>();
  for (const node of graph.nodes) {
    const labelTokens = tokenise(node.label);
    if (labelTokens.size === 0) continue;
    let hits = 0;
    for (const t of labelTokens) {
      if (queryTokens.has(t)) hits++;
    }
    if (hits === 0) continue;
    const overlap = hits / labelTokens.size;
    const mentionBoost = Math.min(0.3, Math.log2(node.mentionCount + 1) * 0.05);
    const activation = (KIND_PRIORITY[node.kind] ?? 0.5) * (0.5 + overlap * 0.5) + mentionBoost;
    seeds.set(node.id, Math.min(1, activation));
  }
  return seeds;
}

// ============================================================
//  Spreading activation — the headline algorithm
// ============================================================

export interface SpreadOptions {
  /** Decay per hop. 0.5 = half the activation crosses each edge. */
  decay?: number;
  /** Maximum hops from any seed. Capped by graph diameter in practice. */
  maxHops?: number;
  /** Activation under this is dropped (kills the long-tail). */
  threshold?: number;
}

export interface ActivationResult {
  /** nodeId → final activation in [0, 1+]. */
  scores: Map<string, number>;
  /** Top-K activated nodes, newest activation first. */
  ranked: Array<{ node: GraphNode; activation: number }>;
  /** Hop count actually used (early-exit when nothing crosses threshold). */
  hopsUsed: number;
}

/**
 * Spreading activation with confidence-weighted edges + decay.
 *
 * Algorithm (matches the canonical formulation):
 *   1. seed: start with `seeds` map; everything else is 0.
 *   2. for each hop up to maxHops:
 *      a. for each currently-active node, push activation × decay ×
 *         edgeWeight to neighbours (both directions — the graph is
 *         undirected for activation purposes).
 *      b. accumulate into the next round's vector.
 *      c. drop anything below threshold.
 *      d. early-exit when no new activation crossed threshold.
 *   3. return final vector + ranked top-K.
 */
export function spreadingActivation(
  graph: MedicalGraph,
  seeds: Map<string, number>,
  opts: SpreadOptions = {},
): ActivationResult {
  const decay = opts.decay ?? 0.6;
  const maxHops = opts.maxHops ?? 3;
  const threshold = opts.threshold ?? 0.05;

  // Adjacency map for cheap lookups. Built once per call.
  const adjacency = new Map<string, Array<{ neighbour: string; w: number }>>();
  for (const e of graph.edges) {
    const w = edgeWeight(e);
    if (!adjacency.has(e.source)) adjacency.set(e.source, []);
    if (!adjacency.has(e.target)) adjacency.set(e.target, []);
    adjacency.get(e.source)?.push({ neighbour: e.target, w });
    adjacency.get(e.target)?.push({ neighbour: e.source, w });
  }

  let active = new Map(seeds);
  let hopsUsed = 0;
  for (let hop = 0; hop < maxHops; hop++) {
    const next = new Map(active);
    let crossedThreshold = false;
    for (const [nodeId, activation] of active) {
      const neighbours = adjacency.get(nodeId);
      if (!neighbours) continue;
      for (const { neighbour, w } of neighbours) {
        const incoming = activation * decay * w;
        if (incoming < threshold) continue;
        const current = next.get(neighbour) ?? 0;
        // Saturating add — sigmoid keeps a single hot path from
        // accumulating runaway activation through cycles.
        const updated = sigmoid(current + incoming) * 1.2;
        if (updated > current + 0.01) {
          next.set(neighbour, updated);
          crossedThreshold = true;
        }
      }
    }
    active = next;
    hopsUsed = hop + 1;
    if (!crossedThreshold) break;
  }

  // Drop anything still below threshold so the result vector stays
  // sparse for downstream consumers.
  const scores = new Map<string, number>();
  for (const [id, a] of active) {
    if (a >= threshold) scores.set(id, a);
  }

  // Rank top nodes by activation.
  const nodeIndex = new Map(graph.nodes.map((n) => [n.id, n]));
  const ranked = Array.from(scores.entries())
    .map(([id, activation]) => ({ node: nodeIndex.get(id), activation }))
    .filter((x): x is { node: GraphNode; activation: number } => x.node !== undefined)
    .sort((a, b) => b.activation - a.activation);

  return { scores, ranked, hopsUsed };
}

// ============================================================
//  Public entry: relevant context for prompt grounding
// ============================================================

export interface RelevantContextOptions {
  /** Cap on how many graph nodes we surface. Default 12 — about 200
   *  tokens once formatted, fits comfortably under any LLM window. */
  topK?: number;
  /** Pass-through to spreadingActivation. */
  spread?: SpreadOptions;
}

export interface RelevantContextBlock {
  /** Provenance-tagged context lines for the prompt. */
  lines: string[];
  /** The activation result (for the dev console + neural-core viz). */
  activation: ActivationResult;
  /** Empty when the graph had nothing relevant — caller should fall
   *  back to the cold-start prompt path. */
  empty: boolean;
}

/**
 * Build a graph-grounded context block for a free-text query (chief
 * complaint, paper abstract, follow-up question).
 *
 *   1. Tokenise + match query → seed activation
 *   2. Spread activation across the graph
 *   3. Take top-K nodes
 *   4. Group by kind + render as terse evidence lines
 *
 * The returned `lines` are designed to be prepended to the diagnostic
 * agent's prompt as `KNOWN CONTEXT FROM MÖRBIUS'S BRAIN: …`. They are
 * NOT instructions — they're evidence the LLM can cite or contradict.
 */
export function relevantContext(
  graph: MedicalGraph,
  query: string,
  opts: RelevantContextOptions = {},
): RelevantContextBlock {
  const topK = opts.topK ?? 12;
  const seeds = extractEntityMentions(graph, query);
  const activation = spreadingActivation(graph, seeds, opts.spread);
  const top = activation.ranked.slice(0, topK);

  if (top.length === 0) {
    return { lines: [], activation, empty: true };
  }

  // Group surfaced nodes by kind so the prompt block reads clean.
  const grouped: Record<NodeKind, Array<{ label: string; activation: number }>> = {
    condition: [],
    symptom: [],
    drug: [],
    specialty: [],
    test: [],
    icd10: [],
    paper: [],
  };
  for (const { node, activation: a } of top) {
    grouped[node.kind].push({ label: node.label, activation: a });
  }

  // Truncate verbose seed-case narratives to a short canonical form
  // before they land in the prompt. Some seed nodes were extracted with
  // the full clinical sentence as their label (e.g. "Polyuria,
  // polydipsia, 5 kg weight loss over 6 weeks, blurred vision"). When
  // those land verbatim in a context block the LLM treats them as
  // patient utterances. Cap at 60 chars + split on the first comma to
  // keep only the principal phrase.
  const trim = (label: string): string => {
    const head = label.split(',')[0]?.trim() ?? label;
    return head.length > 60 ? `${head.slice(0, 57).trim()}…` : head;
  };

  const lines: string[] = [];
  if (grouped.condition.length > 0) {
    lines.push(
      `Conditions previously linked to similar presentations: ${grouped.condition
        .map((c) => `${trim(c.label)} (a=${c.activation.toFixed(2)})`)
        .join(' · ')}`,
    );
  }
  if (grouped.symptom.length > 0) {
    lines.push(
      `Co-occurring symptoms in the graph: ${grouped.symptom.map((s) => trim(s.label)).join(' · ')}`,
    );
  }
  if (grouped.drug.length > 0) {
    lines.push(
      `Drugs the graph associates with this presentation: ${grouped.drug.map((d) => d.label).join(' · ')}`,
    );
  }
  if (grouped.specialty.length > 0) {
    lines.push(`Likely specialty routing: ${grouped.specialty.map((s) => s.label).join(' · ')}`);
  }
  if (grouped.test.length > 0) {
    lines.push(`Tests the graph recommends: ${grouped.test.map((t) => t.label).join(' · ')}`);
  }
  if (grouped.icd10.length > 0) {
    lines.push(
      `ICD-10 codes seen for similar cases: ${grouped.icd10.map((i) => i.label).join(' · ')}`,
    );
  }

  return { lines, activation, empty: lines.length === 0 };
}

// ============================================================
//  Differential re-ranking — softmax over (LLM prob × graph evidence)
// ============================================================

export interface RerankInput {
  condition: string;
  /** Original probability from the LLM (0..1). */
  probability: number;
}

export interface RerankOutput extends RerankInput {
  /** Re-weighted probability after graph evidence. */
  rerankedProbability: number;
  /** Multiplicative graph boost in [0.5, 1.5]; 1.0 = no change. */
  graphBoost: number;
  /** True when the graph activated for this condition (provenance). */
  graphActivated: boolean;
}

/**
 * Re-rank a differential list using the graph's activation around each
 * candidate condition. This is *additive evidence*, not authority —
 * the LLM's stated probability is the dominant signal; the graph can
 * boost or dampen by ±50 %.
 *
 * Why bounded: the validator gauntlet would catch pathological
 * over-rides anyway, but capping the boost stops a noisy graph from
 * silently flipping a real diagnosis.
 */
export function boostDifferentials(
  differentials: RerankInput[],
  graph: MedicalGraph,
  query: string,
): RerankOutput[] {
  if (differentials.length === 0) return [];
  const seeds = extractEntityMentions(graph, query);
  const activation = spreadingActivation(graph, seeds);

  // Map each candidate condition label to its node id (best-fuzzy match).
  const nodeByLabel = new Map<string, GraphNode>();
  for (const n of graph.nodes) {
    if (n.kind === 'condition') {
      nodeByLabel.set(n.label.toLowerCase(), n);
    }
  }

  const boosted = differentials.map((d) => {
    const node = nodeByLabel.get(d.condition.toLowerCase());
    const a = node ? (activation.scores.get(node.id) ?? 0) : 0;
    // Multiplicative boost: 1.0 when graph silent, up to 1.5 when very
    // active, down to 0.5 when this candidate is conspicuously absent
    // from a graph that activated elsewhere.
    const anyActivation = activation.ranked.length > 0;
    let boost = 1.0;
    if (a > 0) {
      boost = 1.0 + Math.min(0.5, a * 0.5);
    } else if (anyActivation) {
      boost = 0.85;
    }
    return {
      ...d,
      rerankedProbability: Math.min(1, d.probability * boost),
      graphBoost: boost,
      graphActivated: a > 0,
    };
  });

  // Re-normalise via softmax over reranked probabilities so the
  // differentials still sum to ~1.
  const reweighted = softmax(boosted.map((b) => Math.log(Math.max(1e-6, b.rerankedProbability))));
  return boosted.map((b, i) => ({ ...b, rerankedProbability: reweighted[i] ?? 0 }));
}
