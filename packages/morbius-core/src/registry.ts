import type { AgentKind, Task } from '@dr-abc/types';
import type { BaseAgent } from './base-agent.ts';

/**
 * AgentRegistry — runtime catalog of all agents Mörbius can dispatch to.
 * Indexed by kind for O(1) lookup; resolves candidates by Task.canHandle.
 */
export class AgentRegistry {
  private byKind = new Map<AgentKind, BaseAgent>();
  private all: BaseAgent[] = [];

  /**
   * Register or replace by `kind`. Idempotent — calling with the same
   * kind a second time swaps in the new agent (used by the API server's
   * `rebuildAgents()` when env keys change at runtime via /dev/env-keys
   * or /dev/env-persist, and the diagnostic / imaging agents need to
   * pick up the new credentials without a process restart).
   */
  register(agent: BaseAgent): this {
    const existing = this.byKind.get(agent.kind);
    if (existing) {
      this.byKind.set(agent.kind, agent);
      const idx = this.all.indexOf(existing);
      if (idx >= 0) this.all[idx] = agent;
      return this;
    }
    this.byKind.set(agent.kind, agent);
    this.all.push(agent);
    return this;
  }

  get(kind: AgentKind): BaseAgent | undefined {
    return this.byKind.get(kind);
  }

  /** Return all agents that claim to handle the given task. */
  resolveCandidates(task: Task): BaseAgent[] {
    return this.all.filter((a) => a.canHandle(task));
  }

  list(): readonly BaseAgent[] {
    return this.all;
  }
}
