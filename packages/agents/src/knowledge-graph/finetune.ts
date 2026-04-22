/**
 * KG fine-tune — gradient-boosted edge-weight updates.
 *
 * The knowledge graph encodes condition <-> symptom <-> drug <-> specialty
 * relationships and feeds the diagnostic prompt as anchored evidence.
 * Spreading activation lights the graph up for a given query; the resulting
 * activation map biases the LLM toward conditions whose neighbours fire
 * strongly. Until now, edge weights were fixed at graph-build time. This
 * module makes the weights LEARNABLE: each consult's outcome is a signal
 * we use to nudge the weight of every edge that participated.
 *
 * The update rule mirrors classical gradient-boosting (Friedman 2001 ·
 * Chen & Guestrin 2016): every cycle's residual is the gap between the
 * predicted relevance of an edge (its current weight) and the observed
 * outcome (did the validator pass on the path this edge supported).
 *
 *   delta_e   = eta * signal_e * activation_e
 *   w_e_new   = clamp(w_e_old + delta_e, MIN_WEIGHT, MAX_WEIGHT)
 *
 * Bounded magnitude + per-cycle cap + red-flag hard guard mean a noisy
 * signal cannot silently flip a clinically meaningful path. The same
 * "no kill, no sorry" discipline that governs `boosting/index.ts` for
 * differential probabilities applies here for the underlying graph.
 *
 * Closed loop:
 *
 *   patient → /orchestrate → activate KG → diagnostic agent → validator
 *                                                                  │
 *   FineTuneSignal ◄─────────────────────────────────────────────────┘
 *   (validator verdict + predicted vs truth condition)
 *                            │
 *                            ▼
 *                    applyFineTuneCycle(graph, signals)
 *                            │
 *                            ▼
 *                    writes updated graph + journal entry
 */

import { RED_FLAG_RULES } from '../knowledge/red-flags.ts';
import { extractEntityMentions, spreadingActivation } from './activation.ts';
import type { GraphEdge, MedicalGraph } from './types.ts';

// ============================================================
//  Tunable constants — kept conservative so a single bad signal
//  cannot dominate the cycle. All values match the spirit of
//  the boosting-arc bounds in packages/agents/src/boosting/.
// ============================================================

/** Learning rate. Each signal can shift one edge by at most `eta`. */
export const ETA = 0.05;

/** Hard clamp on edge weight. Stops runaway growth or extinction. */
export const MIN_WEIGHT = 0.1;
export const MAX_WEIGHT = 1.5;

/** Per-cycle cap on cumulative shift for any one edge. A signal-rich
 *  cycle can't move a single edge more than this regardless of how
 *  many signals point at it. */
export const PER_CYCLE_CAP = 0.3;

/** Mean-reversion strength for un-touched edges. After many cycles
 *  without seeing an edge in any signal, its weight drifts back
 *  toward 1.0 so stale paths don't ossify at extreme values. */
export const DECAY_ALPHA = 0.005;

/** How many of the strongest weight changes per direction to surface
 *  in the cycle result for the UI. */
export const TOP_K_REPORT = 5;

// ============================================================
//  Types
// ============================================================

export interface FineTuneSignal {
  /** Free-text chief complaint or patient prompt. */
  patientText: string;
  /** The condition the diagnostic agent picked as the top differential. */
  predictedCondition: string;
  /** The clinically correct condition (from harness ground truth). */
  truthCondition: string;
  /** Did the validator gauntlet pass on this consult? */
  validatorPassed: boolean;
  /** Optional per-signal weight (1.0 default). Architect overrides get
   *  3.0, validator failures get 1.5, follow-up retractions get 0.7. */
  weight?: number;
}

export interface EdgeWeightChange {
  edgeId: string;
  source: string;
  target: string;
  sourceLabel: string;
  targetLabel: string;
  relation: GraphEdge['relation'];
  oldWeight: number;
  newWeight: number;
  delta: number;
}

export interface FineTuneCycleResult {
  /** Monotonic cycle counter, incremented per persisted cycle. */
  cycleSeq: number;
  /** ISO timestamp. */
  ranAt: string;
  /** How many signals fed this cycle. */
  signalsConsumed: number;
  /** Total edges that received a non-zero update. */
  edgesUpdated: number;
  /** Top-K edges by positive shift (strengthened). */
  topStrengthened: EdgeWeightChange[];
  /** Top-K edges by negative shift (weakened). */
  topWeakened: EdgeWeightChange[];
  /** Edges whose damp was suppressed by the red-flag guard. */
  redFlagsGuarded: number;
  /** Edges that drifted under the mean-reversion decay. */
  decayedEdges: number;
  /** Sum of absolute shifts — proxy for "how much the graph moved". */
  totalAbsoluteShift: number;
}

export interface FineTuneOptions {
  /** Override the default learning rate. */
  eta?: number;
  /** Apply the mean-reversion decay step at the end. Default true. */
  applyDecay?: boolean;
  /** Skip the red-flag guard entirely. Tests only — never set true in prod. */
  skipRedFlagGuard?: boolean;
}

// ============================================================
//  Red-flag node detection
// ============================================================

/** Pre-compile the red-flag regexes once at module load. The KG node
 *  whose label or id matches any of these is protected: its incoming
 *  edges cannot be damped, only strengthened. */
const RED_FLAG_NODE_PATTERNS: readonly RegExp[] = (() => {
  const out: RegExp[] = [];
  for (const rule of RED_FLAG_RULES) {
    out.push(rule.pattern);
  }
  // Plus explicit condition names that show up in our KG.
  const explicit = [
    /\bSTEMI\b/i,
    /Acute\s+(ST-elevation\s+)?MI\b/i,
    /myocardial\s+infarction/i,
    /aortic\s+dissection/i,
    /pulmonary\s+embolism/i,
    /sepsis/i,
    /anaphylax/i,
    /meningitis/i,
    /stroke/i,
    /subarachnoid\s+haemorrhage/i,
    /appendicitis/i,
    /ectopic\s+pregnancy/i,
    /testicular\s+torsion/i,
    /diabetic\s+ketoacidosis|\bDKA\b/i,
  ];
  for (const r of explicit) out.push(r);
  return out;
})();

/** True if the node label looks like a red-flag (high-priority) condition. */
export function isRedFlagNodeLabel(label: string): boolean {
  for (const r of RED_FLAG_NODE_PATTERNS) {
    if (r.test(label)) return true;
  }
  return false;
}

// ============================================================
//  Per-signal edge contribution
// ============================================================

/** Match a condition label to a node id in the graph. Case-insensitive,
 *  trims trailing punctuation, falls back to substring match. */
function findConditionNodeId(graph: MedicalGraph, condition: string): string | null {
  if (!condition) return null;
  const norm = condition
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim();
  if (!norm) return null;
  // Exact label match (preferred).
  for (const n of graph.nodes) {
    if (n.kind !== 'condition') continue;
    if (
      n.label
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .trim() === norm
    )
      return n.id;
  }
  // Loose substring match (each direction).
  for (const n of graph.nodes) {
    if (n.kind !== 'condition') continue;
    const nl = n.label.toLowerCase();
    if (nl.includes(norm) || norm.includes(nl)) return n.id;
  }
  return null;
}

/** Compute the per-edge signal vector for one consult. Returns a Map
 *  edgeIdx -> signal magnitude (positive = strengthen, negative = damp). */
function signalsForOneConsult(graph: MedicalGraph, signal: FineTuneSignal): Map<number, number> {
  const out = new Map<number, number>();
  const baseWeight = signal.weight ?? 1.0;

  // Find activation around the patient text.
  const seeds = extractEntityMentions(graph, signal.patientText);
  if (seeds.size === 0) return out;
  const activation = spreadingActivation(graph, seeds);

  const predictedId = findConditionNodeId(graph, signal.predictedCondition);
  const truthId = findConditionNodeId(graph, signal.truthCondition);
  const predictedActivation = predictedId ? (activation.scores.get(predictedId) ?? 0) : 0;
  const truthActivation = truthId ? (activation.scores.get(truthId) ?? 0) : 0;

  const passed = signal.validatorPassed && predictedId !== null && predictedId === truthId;

  // Walk every edge once.
  for (let i = 0; i < graph.edges.length; i += 1) {
    const edge = graph.edges[i];
    if (!edge) continue;
    const aSource = activation.scores.get(edge.source) ?? 0;
    const aTarget = activation.scores.get(edge.target) ?? 0;
    const edgeActivation = (aSource + aTarget) / 2;
    if (edgeActivation <= 0) continue;

    let direction = 0;
    if (passed) {
      // Validator passed + predicted == truth: every activated edge contributed.
      direction = +1;
    } else if (predictedId && predictedId !== truthId) {
      // We routed wrong. Edges feeding the wrong prediction get damped;
      // edges feeding the true condition (if any activated) get lifted.
      if (edge.target === predictedId || edge.source === predictedId) direction = -1;
      else if (edge.target === truthId || edge.source === truthId) direction = +0.6;
      else direction = 0;
    } else if (!signal.validatorPassed) {
      // Validator failed but predicted == truth (rare). Slight neutral damp
      // because the gauntlet caught something — the path needs tightening.
      direction = -0.3;
    }

    if (direction === 0) continue;
    const magnitude = baseWeight * direction * edgeActivation;
    out.set(i, magnitude);
  }
  // If truth condition was barely activated, lift edges around it.
  if (truthId && truthActivation < 0.2 && !passed) {
    for (let i = 0; i < graph.edges.length; i += 1) {
      const edge = graph.edges[i];
      if (!edge) continue;
      if (edge.target !== truthId && edge.source !== truthId) continue;
      const current = out.get(i) ?? 0;
      out.set(i, current + baseWeight * 0.3);
    }
  }
  // Suppress predicted-activation echo — already counted via the loop.
  if (predictedId && predictedActivation === 0) {
    /* nothing to do */
  }
  return out;
}

// ============================================================
//  Top-level cycle
// ============================================================

/** Run one fine-tune cycle. Mutates `graph.edges[*].weight` in place
 *  and returns a summary. The caller is responsible for persisting the
 *  graph and appending the journal entry. */
export function applyFineTuneCycle(
  graph: MedicalGraph,
  signals: readonly FineTuneSignal[],
  cycleSeq: number,
  opts: FineTuneOptions = {},
): FineTuneCycleResult {
  const eta = opts.eta ?? ETA;
  const applyDecay = opts.applyDecay ?? true;
  const skipGuard = opts.skipRedFlagGuard === true;

  // 1. Accumulate per-edge gradient over every signal.
  const aggregate = new Map<number, number>();
  for (const sig of signals) {
    const contrib = signalsForOneConsult(graph, sig);
    for (const [idx, val] of contrib) {
      aggregate.set(idx, (aggregate.get(idx) ?? 0) + val);
    }
  }

  // 2. Apply bounded updates.
  const changes: EdgeWeightChange[] = [];
  let redFlagsGuarded = 0;
  let totalAbs = 0;
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const touched = new Set<number>();

  for (const [idx, raw] of aggregate) {
    const edge = graph.edges[idx];
    if (!edge) continue;
    const targetNode = nodeById.get(edge.target);
    const sourceNode = nodeById.get(edge.source);
    if (!targetNode || !sourceNode) continue;

    // Per-cycle cap — symmetric on both signs.
    let signed = eta * raw;
    if (signed > PER_CYCLE_CAP) signed = PER_CYCLE_CAP;
    if (signed < -PER_CYCLE_CAP) signed = -PER_CYCLE_CAP;

    // Red-flag guard: never damp an edge feeding a red-flag condition.
    if (!skipGuard && signed < 0) {
      const targetIsRed = targetNode.kind === 'condition' && isRedFlagNodeLabel(targetNode.label);
      const sourceIsRed = sourceNode.kind === 'condition' && isRedFlagNodeLabel(sourceNode.label);
      if (targetIsRed || sourceIsRed) {
        redFlagsGuarded += 1;
        continue;
      }
    }
    if (signed === 0) continue;

    const oldWeight = edge.weight ?? 1.0;
    let newWeight = oldWeight + signed;
    if (newWeight < MIN_WEIGHT) newWeight = MIN_WEIGHT;
    if (newWeight > MAX_WEIGHT) newWeight = MAX_WEIGHT;
    const actualDelta = newWeight - oldWeight;
    if (Math.abs(actualDelta) < 1e-6) continue;

    edge.weight = newWeight;
    touched.add(idx);
    totalAbs += Math.abs(actualDelta);
    changes.push({
      edgeId: `${edge.source}::${edge.relation}::${edge.target}`,
      source: edge.source,
      target: edge.target,
      sourceLabel: sourceNode.label,
      targetLabel: targetNode.label,
      relation: edge.relation,
      oldWeight,
      newWeight,
      delta: actualDelta,
    });
  }

  // 3. Mean-reversion decay on un-touched edges. Stops stale paths from
  //    locking in at extreme values when no signal touches them for many
  //    cycles. Decay is a tiny pull toward 1.0; touched edges skip it.
  let decayedEdges = 0;
  if (applyDecay) {
    for (let i = 0; i < graph.edges.length; i += 1) {
      if (touched.has(i)) continue;
      const edge = graph.edges[i];
      if (!edge) continue;
      const w = edge.weight ?? 1.0;
      const drift = DECAY_ALPHA * (1.0 - w);
      if (Math.abs(drift) < 1e-6) continue;
      edge.weight = w + drift;
      decayedEdges += 1;
    }
  }

  // 4. Sort changes for the UI surface.
  const positive = changes.filter((c) => c.delta > 0).sort((a, b) => b.delta - a.delta);
  const negative = changes.filter((c) => c.delta < 0).sort((a, b) => a.delta - b.delta);

  return {
    cycleSeq,
    ranAt: new Date().toISOString(),
    signalsConsumed: signals.length,
    edgesUpdated: changes.length,
    topStrengthened: positive.slice(0, TOP_K_REPORT),
    topWeakened: negative.slice(0, TOP_K_REPORT),
    redFlagsGuarded,
    decayedEdges,
    totalAbsoluteShift: totalAbs,
  };
}

/** Convenience helper for tests: build a graph snapshot containing only
 *  edge-weights keyed by `source::relation::target`. */
export function snapshotEdgeWeights(graph: MedicalGraph): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of graph.edges) {
    out.set(`${e.source}::${e.relation}::${e.target}`, e.weight ?? 1.0);
  }
  return out;
}
