import { BaseAgent } from '@dr-abc/morbius-core';
import {
  type AgentKind,
  type AgentResult,
  type DiagnosticInput,
  type DiagnosticOutput,
  Intent,
  type OrchestratorEvent,
  type Task,
  type TriageOutput,
} from '@dr-abc/types';
import type { DiagnosticEnsemble } from '../diagnostic.ts';

/**
 * Abstract base for the six Stage-8 specialist agents (cardiology,
 * neurology, oncology, pulmonology, endocrinology, dermatology). Each
 * subclass overrides `kind` and `specialtyPrompt`; everything else
 * (input normalisation, ensemble dispatch, evidence extraction) lives
 * here.
 *
 * Why share the ensemble: model clients are stateless. Spinning up a
 * fresh Anthropic / NVIDIA / HF client per specialty would just
 * burn memory. The specialist's signature contribution is the system
 * prompt — we prepend it to the user `text` field so any backend
 * (tool-use Claude or JSON-mode Llama) sees it as authoritative
 * context regardless of how the underlying ensemble structures its
 * own system prompt.
 */
export abstract class SpecialistAgent extends BaseAgent<DiagnosticInput, DiagnosticOutput> {
  abstract override readonly kind: AgentKind;
  override readonly version = '0.1.0';
  override readonly minConfidence = 0.5;
  abstract readonly specialtyPrompt: string;

  constructor(protected ensemble: DiagnosticEnsemble) {
    super();
  }

  canHandle(task: Task): boolean {
    return task.intent === Intent.Symptom || task.intent === Intent.Emergency;
  }

  protected override async reason(
    task: Task<DiagnosticInput>,
    emit: (e: OrchestratorEvent) => void,
  ): Promise<{
    data: DiagnosticOutput;
    confidence: number;
    evidence: string[];
    warnings: string[];
  }> {
    const input = this.normalizeInput(task);
    const augmented: DiagnosticInput = {
      ...input,
      text: `${this.specialtyPrompt}\n\n---\n\nPATIENT INPUT:\n${input.text}`,
    };

    emit({
      type: 'agent.token',
      agent: this.kind,
      token: `${this.kind} reasoning via ${this.ensemble.name} on ${input.text.slice(0, 60)}…`,
    });

    const vote = await this.ensemble.vote(augmented);

    emit({
      type: 'agent.token',
      agent: this.kind,
      token: `${vote.differentials.length} differentials, top: ${vote.differentials[0]?.condition ?? '—'}`,
    });

    const data: DiagnosticOutput = {
      differentials: vote.differentials,
      recommendedTests: vote.recommendedTests,
      // The specialist owns this column too — overwrites whatever the
      // ensemble guessed with the specialist's own kind so downstream
      // consumers see the actual dispatcher, not a mid-call hallucination.
      recommendedSpecialty: this.kind,
      modelUsed: `${this.kind}/${this.ensemble.name}`,
    };

    const evidence = vote.differentials
      .slice(0, 3)
      .flatMap((d) => d.supportingEvidence.slice(0, 2).map((e) => `${d.condition}:${e}`));

    return {
      data,
      confidence: vote.rawConfidence,
      evidence,
      warnings: vote.differentials.length === 0 ? ['no differentials produced'] : [],
    };
  }

  /**
   * Mirrors DiagnosticAgent.normalizeInput but kept independent so the
   * two can drift if the specialist ever wants extra fields the
   * generalist doesn't (e.g. "prior cardiac events" for cardiology).
   */
  private normalizeInput(task: Task<DiagnosticInput>): DiagnosticInput {
    const payload = task.payload as
      | DiagnosticInput
      | { text: string; upstream?: AgentResult<TriageOutput>; vitals?: DiagnosticInput['vitals'] }
      | ({ upstream?: AgentResult<TriageOutput> } & Partial<TriageOutput>);

    const upstream = (payload as { upstream?: AgentResult<TriageOutput> }).upstream;
    const text =
      'text' in payload && typeof payload.text === 'string'
        ? payload.text
        : (upstream?.evidence.join(' · ') ?? '');

    return {
      text,
      triage: upstream?.data,
      vitals:
        'vitals' in payload
          ? (payload as { vitals?: DiagnosticInput['vitals'] }).vitals
          : undefined,
      ageYears: (payload as DiagnosticInput).ageYears,
      sex: (payload as DiagnosticInput).sex,
    };
  }
}
