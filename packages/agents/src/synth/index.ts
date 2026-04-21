import { BaseAgent } from '@dr-abc/morbius-core';
import {
  AgentKind,
  type Evidence,
  Intent,
  type OrchestratorEvent,
  type SynthConfidence,
  type SynthInput,
  type SynthOutput,
  type Task,
} from '@dr-abc/types';
import { citedEvidence, parseCitations } from './parse-citations.ts';
import { type SynthBackend, trySynthBackend } from './synth-backend.ts';

/**
 * EvidenceSynthAgent — turns a ResearchOutput evidence list + a question
 * into a tightly-scoped, footnoted answer card. The Validator then runs
 * its cited-claims gate against the parsed claims.
 *
 * Output discipline:
 *   - ≤ 6 sentences
 *   - Every clinical claim must end with `[n]` matching an evidence index
 *   - No new claims beyond what the evidence supports
 *
 * Confidence rating is derived from the citation distribution:
 *   - high   = at least 3 distinct sources cited and the answer covers
 *              the question's primary clinical question
 *   - medium = 2 sources OR uneven coverage
 *   - low    = 1 source OR contradictory evidence
 */

const SYNTHESIS_PROMPT =
  'You are the Evidence-Synth agent inside Mörbius. You receive a clinical question and an array of EVIDENCE items, each with an index (1-based), title, summary, and source. Produce a synthesised answer in plain English, ≤ 6 sentences total. Every sentence containing a clinical claim MUST end with one or more footnote markers like [1] or [2,4] referencing the evidence indices that support it. Do NOT introduce claims that no evidence supports. Do NOT cite sources you did not use. Do NOT include any markdown headings or bullet points — the output is one short paragraph.';

export class EvidenceSynthAgent extends BaseAgent<SynthInput, SynthOutput> {
  readonly kind = AgentKind.Research; // shares the Research kind for now
  readonly version = '0.1.0';
  readonly minConfidence = 0.4;

  constructor(private backend: SynthBackend) {
    super();
  }

  canHandle(task: Task): boolean {
    return task.intent === Intent.Research;
  }

  protected async reason(
    task: Task<SynthInput>,
    emit: (e: OrchestratorEvent) => void,
  ): Promise<{
    data: SynthOutput;
    confidence: number;
    evidence: string[];
    warnings: string[];
  }> {
    const input = task.payload;
    if (!input.evidence || input.evidence.length === 0) {
      throw new Error('synth requires non-empty evidence');
    }

    emit({
      type: 'agent.token',
      agent: this.kind,
      token: `Synthesising ${input.evidence.length} citations via ${this.backend.name}…`,
    });

    const start = Date.now();
    const userPrompt = buildPrompt(input.query, input.evidence);
    const answer = (
      await this.backend.chat({
        system: SYNTHESIS_PROMPT,
        user: userPrompt,
        maxTokens: input.maxTokens ?? 512,
      })
    ).trim();

    const claims = parseCitations(answer);
    const cited = citedEvidence(input.evidence, claims);
    const confidence = scoreConfidence(claims, cited);
    const elapsedMs = Date.now() - start;

    emit({
      type: 'agent.token',
      agent: this.kind,
      token: `${claims.length} claims · ${cited.length} sources · ${confidence}`,
    });

    const data: SynthOutput = {
      query: input.query,
      answer,
      claims,
      citedEvidence: cited,
      confidence,
      modelUsed: this.backend.name,
      elapsedMs,
    };

    return {
      data,
      confidence: numericConfidence(confidence),
      evidence: cited.map((e) => `${e.source}:${e.id}`),
      warnings: cited.length === 0 ? ['no citations referenced — gate will fail'] : [],
    };
  }
}

function buildPrompt(query: string, evidence: Evidence[]): string {
  const lines: string[] = ['QUESTION:', query, '', 'EVIDENCE:'];
  evidence.forEach((e, i) => {
    lines.push(`[${i + 1}] (${e.source}, ${e.year ?? '—'}) ${e.title}`);
    if (e.summary) lines.push(`    ${e.summary}`);
  });
  lines.push('');
  lines.push('Now write a ≤ 6 sentence synthesis. Every clinical claim ends with [n] markers.');
  return lines.join('\n');
}

function scoreConfidence(
  claims: ReturnType<typeof parseCitations>,
  cited: Evidence[],
): SynthConfidence {
  const distinctSources = new Set(cited.map((e) => e.source)).size;
  const claimsWithCitation = claims.filter((c) => c.citations.length > 0).length;
  if (cited.length >= 3 && distinctSources >= 2 && claimsWithCitation >= 3) return 'high';
  if (cited.length >= 2 && claimsWithCitation >= 2) return 'medium';
  return 'low';
}

function numericConfidence(c: SynthConfidence): number {
  if (c === 'high') return 0.85;
  if (c === 'medium') return 0.65;
  return 0.4;
}

export { trySynthBackend, type SynthBackend } from './synth-backend.ts';
export {
  parseCitations,
  citedEvidence,
  isClinicalClaim,
  checkCitedClaims,
  type CitedClaimsCheck,
} from './parse-citations.ts';
