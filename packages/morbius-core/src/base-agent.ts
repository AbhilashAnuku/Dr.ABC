import type { AgentKind, AgentResult, OrchestratorEvent, Task, Verdict } from '@dr-abc/types';

/**
 * BaseAgent — the contract every specialist agent honors.
 * Sandboxed, versioned, with built-in deadline + cost tracking.
 */
export abstract class BaseAgent<TPayload = unknown, TData = unknown> {
  abstract readonly kind: AgentKind;
  abstract readonly version: string;
  abstract readonly minConfidence: number;

  /** Override to declare which intents this agent claims. */
  abstract canHandle(task: Task): boolean;

  /** Concrete agents implement their reasoning here. */
  protected abstract reason(
    task: Task<TPayload>,
    emit: (e: OrchestratorEvent) => void,
  ): Promise<{ data: TData; confidence: number; evidence: string[]; warnings: string[] }>;

  /** Public entry point — wraps reason() with deadline, cost tracking, error envelope. */
  async run(
    task: Task<TPayload>,
    emit: (e: OrchestratorEvent) => void,
  ): Promise<AgentResult<TData>> {
    const startedAt = Date.now();
    emit({ type: 'agent.started', agent: this.kind, taskId: task.taskId });

    const deadline = startedAt + task.deadlineMs;
    const deadlineSignal = AbortSignal.timeout(task.deadlineMs);

    try {
      const { data, confidence, evidence, warnings } = await this.withDeadline(
        () => this.reason(task, emit),
        deadlineSignal,
      );

      const verdict: Verdict = confidence >= this.minConfidence ? 'pass' : 'defer-to-human';
      const ms = Date.now() - startedAt;

      const result: AgentResult<TData> = {
        agent: this.kind,
        taskId: task.taskId,
        verdict,
        confidence,
        data,
        evidence,
        warnings,
        followUps: [],
        cost: { tokens: 0, ms, usd: 0 },
      };

      emit({ type: 'agent.completed', result });
      return result;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      emit({ type: 'agent.failed', agent: this.kind, error: reason });

      return {
        agent: this.kind,
        taskId: task.taskId,
        verdict: 'fail',
        confidence: 0,
        data: null as unknown as TData,
        evidence: [],
        warnings: [reason],
        followUps: [],
        cost: { tokens: 0, ms: Date.now() - startedAt, usd: 0 },
      };
    } finally {
      // Reserved for telemetry flush
      void deadline;
    }
  }

  private async withDeadline<T>(fn: () => Promise<T>, signal: AbortSignal): Promise<T> {
    return await Promise.race([
      fn(),
      new Promise<T>((_, reject) => {
        signal.addEventListener('abort', () =>
          reject(new Error(`Deadline exceeded for agent ${this.kind}`)),
        );
      }),
    ]);
  }
}
