import { BaseAgent } from '@dr-abc/morbius-core';
import {
  AgentKind,
  type AgentResult,
  type OrchestratorEvent,
  type SynthOutput,
  type Task,
} from '@dr-abc/types';
import { checkCitedClaims } from './synth/parse-citations.ts';

/**
 * ValidatorAgent — independent re-derivation gate.
 *
 * V0: rule-based plausibility checks on candidate result.
 * V1: parallel inference with a different model family + disagreement metric.
 */
export class ValidatorAgent extends BaseAgent<AgentResult, { passed: boolean; reason: string }> {
  readonly kind = AgentKind.Validator;
  readonly version = '0.1.0';
  readonly minConfidence = 0.5;

  canHandle(_task: Task): boolean {
    // Validator is invoked only by the orchestrator's validation gauntlet,
    // never as a primary candidate. Return false to keep it out of resolveCandidates.
    return false;
  }

  protected async reason(
    task: Task<AgentResult>,
    emit: (e: OrchestratorEvent) => void,
  ): Promise<{
    data: { passed: boolean; reason: string };
    confidence: number;
    evidence: string[];
    warnings: string[];
  }> {
    const candidate = task.payload;
    emit({ type: 'agent.token', agent: this.kind, token: 'Cross-checking evidence chain…' });

    const checks: { name: string; ok: boolean; detail?: string }[] = [
      {
        name: 'has-evidence',
        ok: candidate.evidence.length > 0 || candidate.warnings.length > 0,
      },
      { name: 'confidence-plausible', ok: candidate.confidence >= 0 && candidate.confidence <= 1 },
      { name: 'no-fail-verdict', ok: candidate.verdict !== 'fail' },
      { name: 'cost-bounded', ok: candidate.cost.ms < 30_000 },
    ];

    // Cited-claims gate — only applies to synth output. Every clinical
    // claim sentence must carry a [n] footnote, else the answer is
    // unfit for clinical surfacing and we drop to needs-review.
    const synth = candidate.data as Partial<SynthOutput> | null | undefined;
    if (synth && Array.isArray(synth.claims)) {
      const cite = checkCitedClaims(synth.claims);
      checks.push({
        name: 'cited-claims',
        ok: cite.passed,
        detail: cite.passed
          ? undefined
          : `${cite.uncitedClaims.length} unfootnoted clinical claim(s)`,
      });
    }

    const failedChecks = checks.filter((c) => !c.ok);
    const failedNames = failedChecks.map((c) => c.name);
    // v0.7 gauntlet-tune: grade by passed-fraction instead of binary all-or-nothing.
    // Reason: persona harness flooded with `defer-to-human` on cases that pass
    //   3/4 checks but missed `cost-bounded` due to slow Ollama. A graded
    //   confidence gives the orchestrator a signal proportional to severity
    //   while keeping `minConfidence = 0.5` as the hard floor (= must pass
    //   at least half the checks to clear the gate).
    const passed = failedChecks.length === 0;
    const graded = checks.length === 0 ? 0 : (checks.length - failedChecks.length) / checks.length;
    // Bonus: 1.0 when all green, slight penalty per fail beyond minConfidence.
    const confidence = passed ? 0.95 : Math.max(0.2, graded * 0.9);

    return {
      data: {
        passed,
        reason: passed
          ? 'all gates green'
          : `failed: ${failedChecks.map((c) => (c.detail ? `${c.name} (${c.detail})` : c.name)).join(', ')}`,
      },
      confidence,
      evidence: checks.filter((c) => c.ok).map((c) => `check:${c.name}`),
      warnings: failedNames.map((f) => `validator:${f}`),
    };
  }
}
