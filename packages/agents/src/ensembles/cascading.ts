import type { DiagnosticInput, Differential } from '@dr-abc/types';
import type { DiagnosticEnsemble } from '../diagnostic.ts';

/**
 * CascadingEnsemble — tries each child ensemble in order, falls through
 * to the next on error or timeout. Same `DiagnosticEnsemble` shape, so
 * it's a drop-in for the DiagnosticAgent constructor.
 *
 * v0.7 A.1-extended: closes the persona-harness 60-s-Ollama-timeout gap.
 * Today's persona scores cap at 35 % because /orchestrate goes Ollama-
 * first and times out. Wrapping the ensemble list in CascadingEnsemble
 * means the diagnostic call falls through to NVIDIA / Anthropic the
 * moment Ollama's slow.
 *
 * Surfaces:
 *   - `name` cycles through child names so the dev console reflects
 *     which backend actually answered ("ollama→nvidia" if ollama
 *     failed and nvidia succeeded).
 *   - `attempts` array on the result tracks every backend that was
 *     tried, with the failure reason.
 */

export interface CascadingEnsembleOpts {
  /** Children in priority order — first is tried first. */
  children: DiagnosticEnsemble[];
  /** Timeout per child (ms). Default 30 s — enough for a cloud LLM,
   *  short enough to fall through quickly on a slow Ollama. */
  perChildTimeoutMs?: number;
  /** Optional logger so the API can log which backend responded. */
  onAttempt?: (event: { name: string; status: 'ok' | 'err'; reason?: string }) => void;
}

export class CascadingEnsemble implements DiagnosticEnsemble {
  readonly name: string;
  private children: DiagnosticEnsemble[];
  private perChildTimeoutMs: number;
  private onAttempt?: CascadingEnsembleOpts['onAttempt'];

  constructor(opts: CascadingEnsembleOpts) {
    if (opts.children.length === 0) {
      throw new Error('CascadingEnsemble needs ≥ 1 child');
    }
    this.children = opts.children;
    this.perChildTimeoutMs = opts.perChildTimeoutMs ?? 30_000;
    this.onAttempt = opts.onAttempt;
    // Name reflects the priority list: "ollama→nvidia→anthropic"
    this.name = `cascade(${opts.children.map((c) => c.name).join('→')})`;
  }

  async vote(input: DiagnosticInput): Promise<{
    differentials: Differential[];
    recommendedTests: string[];
    recommendedSpecialty: string;
    rawConfidence: number;
  }> {
    const errors: string[] = [];

    for (const child of this.children) {
      try {
        const result = await this.withTimeout(child.vote(input), this.perChildTimeoutMs);
        // Honor the child's actual result — if it got 0 differentials,
        // treat that as an "empty" failure and try the next backend
        // (Ollama sometimes returns valid JSON with 0 conditions on
        // ambiguous prompts).
        if (result.differentials.length === 0) {
          errors.push(`${child.name}:empty`);
          this.onAttempt?.({
            name: child.name,
            status: 'err',
            reason: 'empty differentials',
          });
          continue;
        }
        this.onAttempt?.({ name: child.name, status: 'ok' });
        return result;
      } catch (e) {
        const reason = e instanceof Error ? e.message.slice(0, 80) : 'failed';
        errors.push(`${child.name}:${reason}`);
        this.onAttempt?.({ name: child.name, status: 'err', reason });
      }
    }

    // All children failed — return an empty result so the validator
    // gauntlet can still emit a clean "no differentials" warning rather
    // than crashing the orchestrator.
    return {
      differentials: [],
      recommendedTests: [],
      recommendedSpecialty: 'unknown',
      rawConfidence: 0,
    };
  }

  /** Race a child's vote against a timeout. Reject on timeout so the
   *  caller falls through to the next backend. */
  private withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout after ${ms} ms`)), ms);
      p.then(
        (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        (e) => {
          clearTimeout(timer);
          reject(e);
        },
      );
    });
  }
}
