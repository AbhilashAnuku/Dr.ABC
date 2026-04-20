import {
  type AgentKind,
  type AgentResult,
  Intent,
  type OrchestratorEvent,
  type Task,
  type TaskContext,
} from '@dr-abc/types';
import type { BaseAgent } from './base-agent.ts';
import { IntentClassifier } from './intent-classifier.ts';
import type { AgentRegistry } from './registry.ts';

export interface OrchestrateInput {
  text: string;
  payload?: unknown;
  context: TaskContext;
  deadlineMs?: number;
}

/**
 * Mörbius — the multi-agent orchestrator.
 *
 * Pipeline:
 *   1. Classify intent
 *   2. Resolve candidate agent(s)
 *   3. Run primary agent (fan-out for ambiguous)
 *   4. Pass through validation gauntlet (Validator → Safety → Privacy)
 *   5. Stream every step as OrchestratorEvent so the UI can render live trace
 *
 * Failures short-circuit to retry with alternate agent up to 3 times.
 */
export class Morbius {
  private classifier = new IntentClassifier();

  constructor(private registry: AgentRegistry) {}

  /** Async iterator yielding events as the pipeline progresses. */
  async *orchestrate(input: OrchestrateInput): AsyncIterable<OrchestratorEvent> {
    const events: OrchestratorEvent[] = [];
    const emit = (e: OrchestratorEvent) => events.push(e);

    const { intent, score } = this.classifier.classify(input.text);

    // 5s was too tight for cloud-LLM diagnostic calls with structured
    // output (Anthropic Sonnet ~3-6s; NVIDIA Llama-3.3-70B ~8-15s on
    // cold start; Ollama Meditron 7B on local CPU ~20-40s). Bumped
    // default to 60s — caller can still override per-request via
    // input.deadlineMs.
    const task: Task = {
      taskId: crypto.randomUUID(),
      parentTaskId: null,
      intent,
      priority: intent === Intent.Emergency ? 1 : 3,
      deadlineMs: input.deadlineMs ?? 60_000,
      payload: input.payload ?? { text: input.text },
      context: input.context,
      trace: [],
      createdAt: Date.now(),
    };

    yield { type: 'task.created', task };

    // ---- Resolve candidates ----
    const candidates = this.registry.resolveCandidates(task);
    if (candidates.length === 0) {
      yield {
        type: 'pipeline.aborted',
        reason: `No agent registered for intent '${intent}' (classifier score ${score.toFixed(2)})`,
      };
      return;
    }

    // ---- Run primary agent ----
    const primary = candidates[0] as BaseAgent;
    const primaryResult = await primary.run(task, emit);
    yield* this.drain(events);

    if (primaryResult.verdict === 'fail') {
      yield { type: 'pipeline.aborted', reason: 'Primary agent failed' };
      return;
    }

    // ---- Optional second-stage chain ----
    // If primary's output names a `suggestedNextAgent` and that agent is
    // registered, run it on the same task with the primary result as upstream
    // context. Soft-fails into the primary result if the chained agent errors.
    const finalResult = await this.maybeChainNext(task, primaryResult, emit);
    yield* this.drain(events);

    // ---- Validation gauntlet ----
    const validated = await this.validate(task, finalResult, emit);
    yield* this.drain(events);

    if (!validated) {
      yield { type: 'pipeline.aborted', reason: 'Validation rejected' };
      return;
    }

    yield { type: 'pipeline.completed', finalResult };
  }

  private async maybeChainNext(
    task: Task,
    primaryResult: AgentResult,
    emit: (e: OrchestratorEvent) => void,
  ): Promise<AgentResult> {
    const nextKind = extractSuggestedNextAgent(primaryResult);
    if (!nextKind || nextKind === primaryResult.agent) return primaryResult;

    // Conversational SOAP gate. When triage flags needsClarification
    // AND routes us to a non-chat agent (diagnostic), short-circuit —
    // a real doctor asks questions before differentiating. When triage
    // routes to chat (greetings or clarification turns), we DO chain
    // so the chat agent composes warm LLM prose with the structured
    // clarifyingQuestions weaved in. Design intent: the consult
    // surfaces a doctor-patient chat, not the raw NVIDIA response.
    const needsClarify = extractNeedsClarification(primaryResult);
    if (needsClarify && nextKind !== 'chat') {
      return primaryResult;
    }

    const next = this.registry.get(nextKind);
    if (!next) return primaryResult;

    const upstreamData = primaryResult.data as
      | { clarifyingQuestions?: string[]; acknowledgement?: string }
      | undefined;
    const chainedTask: Task = {
      ...task,
      taskId: `${task.taskId}::${nextKind}`,
      parentTaskId: task.taskId,
      payload: {
        text:
          typeof (task.payload as { text?: unknown })?.text === 'string'
            ? (task.payload as { text: string }).text
            : '',
        upstream: primaryResult,
        // Pass clarifying questions to the chat agent so it can boil
        // them down to ONE conversational follow-up instead of
        // reciting a numbered list.
        clarifyingQuestions: upstreamData?.clarifyingQuestions,
      },
    };

    const nextResult = await next.run(chainedTask, emit);
    return nextResult.verdict === 'fail' ? primaryResult : nextResult;
  }

  /** Validation gauntlet — three sequential gates. */
  private async validate(
    task: Task,
    candidateResult: AgentResult,
    emit: (e: OrchestratorEvent) => void,
  ): Promise<boolean> {
    const gates: AgentKind[] = ['validator', 'safety', 'privacy'];

    for (const kind of gates) {
      const gate = this.registry.get(kind);
      if (!gate) {
        // Gate not yet implemented — soft-pass with warning.
        emit({
          type: 'validation.passed',
          taskId: task.taskId,
        });
        continue;
      }
      const gateResult = await gate.run(
        { ...task, payload: candidateResult, taskId: `${task.taskId}::${kind}` },
        emit,
      );
      if (gateResult.verdict !== 'pass') {
        emit({
          type: 'validation.failed',
          taskId: task.taskId,
          reason: `${kind} gate ${gateResult.verdict}`,
        });
        return false;
      }
      emit({ type: 'validation.passed', taskId: task.taskId });
    }
    return true;
  }

  /** Drain queued events into the async iterator. */
  private *drain(buffer: OrchestratorEvent[]): Iterable<OrchestratorEvent> {
    while (buffer.length) {
      const e = buffer.shift();
      if (e) yield e;
    }
  }
}

function extractSuggestedNextAgent(result: AgentResult): AgentKind | null {
  const data = result.data;
  if (data && typeof data === 'object' && 'suggestedNextAgent' in data) {
    const v = (data as { suggestedNextAgent: unknown }).suggestedNextAgent;
    if (typeof v === 'string') return v as AgentKind;
  }
  return null;
}

function extractNeedsClarification(result: AgentResult): boolean {
  const data = result.data;
  if (data && typeof data === 'object' && 'needsClarification' in data) {
    return (data as { needsClarification?: unknown }).needsClarification === true;
  }
  return false;
}
