/**
 * tuner — turn a per-specialty exemplar set into a `TuneProposal` an
 * operator can review + approve in the dev console.
 *
 * The tuner is **prompt-level**, not gradient-level. It rewrites the
 * specialist agent's `specialtyPrompt` addendum (see
 * `specialists/prompts.ts`) by:
 *
 *   1. Picking the worst-performing exemplars in the corpus (the ones
 *      where `wasCorrect === false` if labels exist; otherwise the
 *      most-recent N).
 *   2. Rendering a meta-prompt that asks a model to refine the
 *      current prefix in the light of those failures.
 *   3. (Default mode) Producing a deterministic refinement using a
 *      small set of pattern rules — no network call required, so
 *      tests stay hermetic and the demo works offline.
 *   4. (Optional) Dispatching the meta-prompt to an `LlmRefiner`
 *      callback — the dev console wires this to the active diagnostic
 *      backend so a stronger model (Claude / NIM / HF) gets the final
 *      say when one is configured.
 *
 * The output is **never auto-applied**. The dev console renders it as
 * a queued proposal with a diff against the current prefix; only an
 * operator's approve click writes the new prefix into the live store.
 */

import type { SpecialtyId } from './specialists/prompts.ts';

export interface TunerExemplar {
  id: string;
  /** The chief complaint that opened the consult. */
  input: string;
  /** Final diagnosis recorded at sign-off — the supervisor signal. */
  groundTruth: string;
  /** ICD-10 prefix (3 chars). */
  icd10: string;
  /** What the model said this case was. Optional — when absent the
   *  exemplar is treated as "label only" (we know what it should be
   *  but not what the live model produced). */
  modelOutput?: string;
  /** True when modelOutput substring-matched groundTruth. Default
   *  `false` so unlabelled exemplars look like failures (worst-case
   *  bias is the right default for a tuner). */
  wasCorrect?: boolean;
  /** Optional drugs the Rx engine ended up prescribing. */
  drugs?: string[];
}

export interface TuneProposal {
  /** The specialist this proposal targets. */
  specialty: SpecialtyId;
  /** The current `specialtyPrompt` (input to the tuner). */
  currentPrefix: string;
  /** The refined prefix the tuner proposes. */
  proposedPrefix: string;
  /** The k worst exemplars the tuner reasoned over. */
  exemplars: TunerExemplar[];
  /** Free-text rationale a human can read in the dev console. */
  rationale: string;
  /** The expected delta on the next accuracy-harness run, in
   *  percentage points. Estimated from how many exemplars the new
   *  prefix's added cues would have caught. Best-effort; verified
   *  empirically by the harness. */
  expectedAccuracyDelta: number;
  /** Token-budget guardrail — the proposed prefix must stay under
   *  this length so it doesn't blow the context window. */
  proposedPrefixChars: number;
  /** ISO timestamp of generation. */
  generatedAt: string;
}

/** A fixed-cap on the proposed prefix length. The base prompts all
 *  sit under 500 chars; we allow tunes up to 800 so the refiner has
 *  room to add a couple of cues without runaway growth. */
export const MAX_PROPOSED_PREFIX_CHARS = 800;

/** Pre-flight check — the tuner rejects proposals that fail this
 *  validator before they reach the dev console. */
export function isValidProposal(p: TuneProposal): boolean {
  if (p.proposedPrefix.length === 0) return false;
  if (p.proposedPrefix.length > MAX_PROPOSED_PREFIX_CHARS) return false;
  // Must mention the specialty noun so we don't ship a generic prompt
  // accidentally.
  if (!p.proposedPrefix.toLowerCase().includes(p.specialty)) return false;
  // Must mention at least one ICD-10-shaped code (3 chars + optional
  // dot + digit) — anchors the prefix to real coding.
  if (!/[A-Z]\d{2}(\.\d)?/.test(p.proposedPrefix)) return false;
  return true;
}

/**
 * Pick the k worst exemplars to feed the refiner. Failures first
 * (wasCorrect === false), then the most-recent unlabelled ones,
 * capped at k.
 */
export function pickWorstExemplars(exemplars: TunerExemplar[], k: number): TunerExemplar[] {
  const failures = exemplars.filter((e) => e.wasCorrect === false);
  if (failures.length >= k) return failures.slice(0, k);
  const unlabelled = exemplars.filter((e) => e.wasCorrect === undefined);
  return [...failures, ...unlabelled.slice(0, k - failures.length)];
}

/**
 * Render the meta-prompt the LlmRefiner sees. Pure function — useful
 * for the test suite + the dev-console "see what the tuner sent the
 * model" inspector.
 */
export function renderMetaPrompt(
  specialty: SpecialtyId,
  currentPrefix: string,
  worstExemplars: TunerExemplar[],
): string {
  const exemplarBlock = worstExemplars
    .map((e, i) => {
      const verdict = e.wasCorrect === false ? '✗ MISSED' : '· unlabelled';
      const got = e.modelOutput ? ` · model said: "${e.modelOutput}"` : '';
      return `${i + 1}. [${e.icd10}] ${verdict} — input: "${e.input.slice(0, 140)}" → truth: "${e.groundTruth}"${got}`;
    })
    .join('\n');

  return `You are tuning the system-prompt prefix for the ${specialty} specialist agent.

CURRENT PREFIX (do not delete — refine):
${currentPrefix}

WORST EXEMPLARS (focus on the patterns these reveal):
${exemplarBlock}

Produce a refined prefix that:
- Keeps the same shape (one paragraph, ${MAX_PROPOSED_PREFIX_CHARS} chars max).
- Mentions "${specialty}" verbatim.
- Anchors to at least one ICD-10 code observed above.
- Adds at most 2 new high-yield cues drawn from the failures.
- Removes nothing the current prefix already gets right.

Respond with the refined prefix only. No commentary.`;
}

/**
 * Deterministic refiner — used when no LlmRefiner is configured. Takes
 * the worst exemplars + extracts ICD-10 codes the current prefix
 * doesn't already cover, then appends a "Watch for…" sentence with
 * up to 2 new cues. This produces a meaningful tune without a network
 * call, which keeps the test suite hermetic + the offline demo
 * functional.
 */
export function deterministicRefine(
  specialty: SpecialtyId,
  currentPrefix: string,
  worstExemplars: TunerExemplar[],
): { proposedPrefix: string; rationale: string } {
  // Extract ICD-10 prefixes the current prompt isn't already
  // mentioning.
  const newCodes = worstExemplars
    .map((e) => e.icd10)
    .filter((c) => c.length >= 3 && !currentPrefix.includes(c));
  const uniqueNewCodes = [...new Set(newCodes)].slice(0, 2);

  // Extract diagnosis nouns from the worst exemplars to mention
  // verbatim (gives the model a more specific anchor than the
  // generic specialist taxonomy).
  const newDiagnoses = worstExemplars
    .map((e) => e.groundTruth.toLowerCase())
    .filter((d) => d.length > 3 && !currentPrefix.toLowerCase().includes(d.slice(0, 8)));
  const uniqueNewDiagnoses = [...new Set(newDiagnoses)].slice(0, 2);

  if (uniqueNewCodes.length === 0 && uniqueNewDiagnoses.length === 0) {
    // Nothing new to add — produce a no-op proposal so the dev
    // console can show "tuner found no actionable signal" instead of
    // shipping an identical prefix.
    return {
      proposedPrefix: currentPrefix,
      rationale: 'Tuner found no actionable signal in the worst exemplars · no change.',
    };
  }

  const additions: string[] = [];
  if (uniqueNewDiagnoses.length > 0) {
    additions.push(`Watch for: ${uniqueNewDiagnoses.join(' · ')}.`);
  }
  if (uniqueNewCodes.length > 0) {
    additions.push(`ICD anchors observed in recent misses: ${uniqueNewCodes.join(' · ')}.`);
  }

  // Append the additions to the current prefix, keeping total length
  // under the cap.
  let proposed = `${currentPrefix.trim()}\n${additions.join(' ')}`;
  if (proposed.length > MAX_PROPOSED_PREFIX_CHARS) {
    proposed = `${proposed.slice(0, MAX_PROPOSED_PREFIX_CHARS - 1)}…`;
  }

  const rationale = [
    `Reviewed ${worstExemplars.length} worst exemplars for ${specialty}.`,
    uniqueNewDiagnoses.length > 0
      ? `Added ${uniqueNewDiagnoses.length} diagnosis cue(s): ${uniqueNewDiagnoses.join(', ')}.`
      : null,
    uniqueNewCodes.length > 0
      ? `Added ${uniqueNewCodes.length} ICD anchor(s): ${uniqueNewCodes.join(', ')}.`
      : null,
  ]
    .filter(Boolean)
    .join(' ');

  return { proposedPrefix: proposed, rationale };
}

export interface ProposeOpts {
  /** Worst-exemplar fan-in. Default 6. */
  worstK?: number;
  /** Optional LLM refiner; when present, used instead of the
   *  deterministic path. The dev console wires this to the active
   *  diagnostic backend (Claude / NIM / HF / Ollama) when configured. */
  llmRefiner?: (metaPrompt: string) => Promise<string>;
}

/**
 * Top-level entry point: build a TuneProposal for one specialty.
 * The LLM path is best-effort — any failure falls through to the
 * deterministic refiner so the dev console always gets a proposal
 * to render (with a clear rationale of which path produced it).
 */
export async function proposeNewPrefix(
  specialty: SpecialtyId,
  currentPrefix: string,
  exemplars: TunerExemplar[],
  opts: ProposeOpts = {},
): Promise<TuneProposal> {
  const worst = pickWorstExemplars(exemplars, opts.worstK ?? 6);

  let proposedPrefix = currentPrefix;
  let rationale = '';

  if (opts.llmRefiner && worst.length > 0) {
    const meta = renderMetaPrompt(specialty, currentPrefix, worst);
    try {
      const llm = (await opts.llmRefiner(meta)).trim();
      if (llm.length > 0 && llm.length <= MAX_PROPOSED_PREFIX_CHARS) {
        proposedPrefix = llm;
        rationale = `LLM-refined from ${worst.length} worst exemplars.`;
      } else {
        const det = deterministicRefine(specialty, currentPrefix, worst);
        proposedPrefix = det.proposedPrefix;
        rationale = `LLM produced an out-of-bounds output (${llm.length} chars); fell back to deterministic refiner. ${det.rationale}`;
      }
    } catch (err) {
      const det = deterministicRefine(specialty, currentPrefix, worst);
      proposedPrefix = det.proposedPrefix;
      rationale = `LLM refiner failed (${err instanceof Error ? err.message : 'unknown'}); fell back to deterministic refiner. ${det.rationale}`;
    }
  } else {
    const det = deterministicRefine(specialty, currentPrefix, worst);
    proposedPrefix = det.proposedPrefix;
    rationale = det.rationale || 'Deterministic refiner · no exemplars to learn from.';
  }

  // Estimate the accuracy delta — a coarse heuristic: each new ICD
  // anchor that appears in a worst-exemplar input is worth ~1.5pp on
  // the next harness run. Bounded conservatively.
  const newCodes =
    proposedPrefix.match(/[A-Z]\d{2}(?:\.\d)?/g)?.filter((c) => !currentPrefix.includes(c)) ?? [];
  const expectedAccuracyDelta = Math.min(newCodes.length * 1.5, 8);

  return {
    specialty,
    currentPrefix,
    proposedPrefix,
    exemplars: worst,
    rationale,
    expectedAccuracyDelta,
    proposedPrefixChars: proposedPrefix.length,
    generatedAt: new Date().toISOString(),
  };
}
