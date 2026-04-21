import Anthropic from '@anthropic-ai/sdk';
import { BaseAgent } from '@dr-abc/morbius-core';
import {
  AgentKind,
  type AgentResult,
  type DiagnosticInput,
  type DiagnosticOutput,
  type Differential,
  Intent,
  type OrchestratorEvent,
  type Task,
  type TriageOutput,
} from '@dr-abc/types';
import { CascadingEnsemble } from './ensembles/cascading.ts';
import { GeminiEnsemble } from './ensembles/gemini.ts';
import { HuggingFaceEnsemble } from './ensembles/hf.ts';
import { NvidiaEnsemble } from './ensembles/nvidia.ts';
import { OllamaEnsemble } from './ensembles/ollama.ts';

/**
 * DiagnosticEnsemble — the swappable surface for differential reasoning.
 *
 *   V0 (this PR):  SingleClaudeEnsemble — one structured Claude call.
 *   V1 (later):    MoEEnsemble — fan-out to specialty sub-models with Bayesian
 *                  weighting per chief complaint. Same interface; drop-in.
 */
export interface DiagnosticEnsemble {
  readonly name: string;
  vote(input: DiagnosticInput): Promise<{
    differentials: Differential[];
    recommendedTests: string[];
    recommendedSpecialty: string;
    rawConfidence: number;
  }>;
}

const SYSTEM_PROMPT = `You are the Diagnostic Agent inside Mörbius, an industrial-grade medical AI \
fronting the Dr.ABC platform. You produce ranked differential diagnoses for clinicians and \
informed patients. You never claim certainty; every diagnosis is a probability with explicit \
supporting and counter-evidence drawn ONLY from the input. You do not fabricate findings, \
labs, or imaging the user did not state. When a Triage Agent has already flagged a red flag, \
weight the differential toward conditions consistent with that escalation. You always emit \
structured output via the submit_differential_diagnosis tool — never freeform prose.`;

const DIAGNOSTIC_TOOL = {
  name: 'submit_differential_diagnosis',
  description:
    'Submit the ranked differential diagnosis with per-condition probability, evidence, and recommended next steps.',
  input_schema: {
    type: 'object' as const,
    properties: {
      differentials: {
        type: 'array',
        description:
          'Ranked list of candidate diagnoses, highest probability first. 3–6 entries typical.',
        items: {
          type: 'object',
          properties: {
            condition: { type: 'string', description: 'Plain-language diagnosis name.' },
            icd10: { type: 'string', description: 'ICD-10-CM code if confidently mappable.' },
            probability: {
              type: 'number',
              minimum: 0,
              maximum: 1,
              description: 'Posterior probability across the candidate set; should sum near 1.',
            },
            supportingEvidence: {
              type: 'array',
              items: { type: 'string' },
              description: 'Specific findings from the input that argue FOR this diagnosis.',
            },
            counterEvidence: {
              type: 'array',
              items: { type: 'string' },
              description: 'Specific findings or absent findings that argue AGAINST.',
            },
          },
          required: ['condition', 'probability', 'supportingEvidence', 'counterEvidence'],
        },
      },
      recommendedTests: {
        type: 'array',
        items: { type: 'string' },
        description: 'Highest-yield next investigations (labs, imaging, exam maneuvers).',
      },
      recommendedSpecialty: {
        type: 'string',
        description: 'Primary clinical specialty for handoff (e.g. "cardiology", "neurology").',
      },
    },
    required: ['differentials', 'recommendedTests', 'recommendedSpecialty'],
  },
};

/**
 * Default ensemble: one Claude call with strict structured output via tool use.
 * Uses prompt caching on the system + tool definition for repeat-call efficiency.
 */
export class SingleClaudeEnsemble implements DiagnosticEnsemble {
  readonly name: string;
  private client: Anthropic;

  constructor(opts: { apiKey: string; model?: string }) {
    this.client = new Anthropic({ apiKey: opts.apiKey });
    this.name = opts.model ?? 'claude-sonnet-4-6';
  }

  async vote(input: DiagnosticInput): Promise<{
    differentials: Differential[];
    recommendedTests: string[];
    recommendedSpecialty: string;
    rawConfidence: number;
  }> {
    const response = await this.client.messages.create({
      model: this.name,
      // Bumped from 2048 → 4096 so structured-output tool calls have
      // room for full evidence + counter-evidence per differential.
      // The diagnostic stage budget is tight (~3s p95); 4096 tokens at
      // Sonnet's ~80 t/s sits inside that window.
      max_tokens: 4096,
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      tools: [{ ...DIAGNOSTIC_TOOL, cache_control: { type: 'ephemeral' } }],
      tool_choice: { type: 'tool', name: DIAGNOSTIC_TOOL.name },
      messages: [{ role: 'user', content: this.buildUserMessage(input) }],
    });

    const toolUse = response.content.find((c) => c.type === 'tool_use');
    if (!toolUse || toolUse.type !== 'tool_use') {
      throw new Error('Diagnostic model did not invoke the structured-output tool');
    }

    const data = toolUse.input as DiagnosticOutput;
    const rawConfidence =
      data.differentials.length > 0 ? (data.differentials[0]?.probability ?? 0) : 0;

    return {
      differentials: data.differentials,
      recommendedTests: data.recommendedTests,
      recommendedSpecialty: data.recommendedSpecialty,
      rawConfidence,
    };
  }

  private buildUserMessage(input: DiagnosticInput): string {
    const lines: string[] = [];
    lines.push('Patient presentation:');
    lines.push(input.text);
    lines.push('');
    if (input.ageYears !== undefined) lines.push(`Age: ${input.ageYears}`);
    if (input.sex) lines.push(`Sex: ${input.sex}`);
    if (input.vitals) {
      const v = input.vitals;
      const parts: string[] = [];
      if (v.hrBpm !== undefined) parts.push(`HR ${v.hrBpm} bpm`);
      if (v.systolic !== undefined && v.diastolic !== undefined)
        parts.push(`BP ${v.systolic}/${v.diastolic}`);
      if (v.spo2Pct !== undefined) parts.push(`SpO2 ${v.spo2Pct}%`);
      if (v.tempC !== undefined) parts.push(`Temp ${v.tempC}°C`);
      if (v.rrPerMin !== undefined) parts.push(`RR ${v.rrPerMin}`);
      if (parts.length) lines.push(`Vitals: ${parts.join(', ')}`);
    }
    if (input.triage) {
      lines.push('');
      lines.push(`Triage assessment: ESI ${input.triage.esi}.`);
      if (input.triage.redFlags.length) {
        lines.push(`Red flags raised: ${input.triage.redFlags.join('; ')}.`);
      }
      lines.push(`Triage rationale: ${input.triage.rationale}`);
    }
    lines.push('');
    lines.push(
      'Produce a ranked differential. Use only findings stated above. Submit via the tool.',
    );
    return lines.join('\n');
  }
}

export class DiagnosticAgent extends BaseAgent<DiagnosticInput, DiagnosticOutput> {
  readonly kind = AgentKind.Diagnostic;
  readonly version = '0.1.0';
  readonly minConfidence = 0.5;

  constructor(private ensemble: DiagnosticEnsemble) {
    super();
  }

  canHandle(task: Task): boolean {
    return task.intent === Intent.Symptom || task.intent === Intent.Emergency;
  }

  protected async reason(
    task: Task<DiagnosticInput>,
    emit: (e: OrchestratorEvent) => void,
  ): Promise<{
    data: DiagnosticOutput;
    confidence: number;
    evidence: string[];
    warnings: string[];
  }> {
    const input = this.normalizeInput(task);

    emit({
      type: 'agent.token',
      agent: this.kind,
      token: `Consulting ${this.ensemble.name} on ${input.text.slice(0, 60)}…`,
    });

    const vote = await this.ensemble.vote(input);

    emit({
      type: 'agent.token',
      agent: this.kind,
      token: `${vote.differentials.length} differentials ranked, top: ${vote.differentials[0]?.condition ?? '—'}`,
    });

    const data: DiagnosticOutput = {
      differentials: vote.differentials,
      recommendedTests: vote.recommendedTests,
      recommendedSpecialty: vote.recommendedSpecialty,
      modelUsed: this.ensemble.name,
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
   * Pull a clean DiagnosticInput from a Task that may carry either:
   *  - a direct DiagnosticInput payload (when invoked alone), or
   *  - an upstream Triage AgentResult chained by the orchestrator.
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

export type DiagnosticBackendKind =
  | 'anthropic'
  | 'nvidia'
  | 'huggingface'
  | 'gemini'
  | 'ollama'
  | 'offline';

interface BackendEnv {
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
  NVIDIA_API_KEY?: string;
  NVIDIA_MODEL?: string;
  HF_API_TOKEN?: string;
  HF_MODEL?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  OLLAMA_BASE_URL?: string;
  OLLAMA_MODEL?: string;
  /** Hard pin — when set, only this backend is tried. Throws "offline"
   *  if its credentials/host aren't available. Locks the demo to a
   *  specific provider regardless of what other env vars
   *  are around. */
  MORBIUS_BACKEND?: string;
  /** Comma-separated priority list overriding the default order. e.g.
   *  `BACKEND_PRIORITY=ollama,nvidia,anthropic,huggingface`. Unknown
   *  entries are silently dropped. */
  BACKEND_PRIORITY?: string;
}

/**
 * Default priority — **local-first**. Ollama tried first per the
 * standing rule: local model is the base; cloud providers are
 * fallbacks. Cloud APIs are tried in cost-ascending order: NVIDIA NIM
 * (free 1k credits/mo) before Anthropic (paid) before Hugging Face
 * (free shared pool but flakier than NIM).
 *
 * Override with `BACKEND_PRIORITY` env var or pin with `MORBIUS_BACKEND`.
 */
export const DEFAULT_BACKEND_PRIORITY: ReadonlyArray<DiagnosticBackendKind> = [
  // Hard-pin to NVIDIA NIM free tier only.
  // Hugging Face, Ollama, Anthropic and Gemini stay reachable as explicit
  // MORBIUS_BACKEND=... pins for side-by-side comparison runs but are
  // never auto-cascaded — defense path runs exclusively on the free
  // NVIDIA developer credits to keep cost at zero and behaviour
  // deterministic.
  'nvidia',
];

/**
 * Resolve the effective priority order from env. Honours
 * `MORBIUS_BACKEND` (single-pin) > `BACKEND_PRIORITY` (custom order)
 * > `DEFAULT_BACKEND_PRIORITY` (local-first).
 */
export function resolveBackendPriority(env: BackendEnv): ReadonlyArray<DiagnosticBackendKind> {
  const valid: ReadonlySet<DiagnosticBackendKind> = new Set([
    'anthropic',
    'nvidia',
    'huggingface',
    'gemini',
    'ollama',
  ]);
  if (env.MORBIUS_BACKEND) {
    const pinned = env.MORBIUS_BACKEND.trim().toLowerCase() as DiagnosticBackendKind;
    if (valid.has(pinned)) return [pinned];
  }
  if (env.BACKEND_PRIORITY) {
    const list = env.BACKEND_PRIORITY.split(',')
      .map((s) => s.trim().toLowerCase() as DiagnosticBackendKind)
      .filter((s) => valid.has(s));
    if (list.length > 0) return list;
  }
  return DEFAULT_BACKEND_PRIORITY;
}

/** Per-backend availability check — returns true when the env can
 *  back this kind. Ollama is special: it only needs *either* a
 *  base-URL or a model override, otherwise we still try the default
 *  localhost endpoint (per the local-first standing rule). */
function isBackendAvailable(kind: DiagnosticBackendKind, env: BackendEnv): boolean {
  switch (kind) {
    case 'anthropic':
      return Boolean(env.ANTHROPIC_API_KEY);
    case 'nvidia':
      return Boolean(env.NVIDIA_API_KEY);
    case 'huggingface':
      return Boolean(env.HF_API_TOKEN);
    case 'gemini':
      return Boolean(env.GEMINI_API_KEY);
    case 'ollama':
      // Local Ollama on the default port is always considered
      // available — the OllamaEnsemble's HTTP request will fail at
      // call time if the daemon isn't running, and the orchestrator
      // gracefully degrades to the next backend in the priority list.
      // The env vars only override host/model; their absence is fine.
      return true;
    default:
      return false;
  }
}

function buildEnsemble(kind: DiagnosticBackendKind, env: BackendEnv) {
  switch (kind) {
    case 'anthropic':
      return env.ANTHROPIC_API_KEY
        ? new SingleClaudeEnsemble({
            apiKey: env.ANTHROPIC_API_KEY,
            model: env.ANTHROPIC_MODEL,
          })
        : null;
    case 'nvidia':
      return env.NVIDIA_API_KEY
        ? new NvidiaEnsemble({ apiKey: env.NVIDIA_API_KEY, model: env.NVIDIA_MODEL })
        : null;
    case 'huggingface':
      return env.HF_API_TOKEN
        ? new HuggingFaceEnsemble({ apiKey: env.HF_API_TOKEN, model: env.HF_MODEL })
        : null;
    case 'gemini':
      return env.GEMINI_API_KEY
        ? new GeminiEnsemble({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL })
        : null;
    case 'ollama':
      return new OllamaEnsemble({ baseUrl: env.OLLAMA_BASE_URL, model: env.OLLAMA_MODEL });
    default:
      return null;
  }
}

/**
 * Convenience factory — local-first.
 *
 * Walks the resolved priority order and returns the first backend the
 * env can support. Default order is **Ollama → NVIDIA → Anthropic →
 * HuggingFace** so a fresh checkout with no API keys still gets a
 * working diagnostic agent against the local Ollama daemon (per the
 * local-first standing rule).
 *
 * Set `MORBIUS_BACKEND=anthropic` to pin a single provider, or
 * `BACKEND_PRIORITY=anthropic,ollama` to flip to cloud-first for
 * benchmarking.
 */
export function tryCreateDiagnosticAgent(env: BackendEnv): DiagnosticAgent | null {
  const priority = resolveBackendPriority(env);
  // v0.7 A.1-extended: instead of picking the FIRST available backend
  // and hoping it doesn't time out, build a CascadingEnsemble of every
  // available backend in priority order. The diagnostic agent now
  // automatically falls through to the next backend on Ollama 60-s
  // timeouts. Closes the persona-harness 35 % cap.
  const ensembles: DiagnosticEnsemble[] = [];
  for (const kind of priority) {
    if (!isBackendAvailable(kind, env)) continue;
    const ensemble = buildEnsemble(kind, env);
    if (ensemble) ensembles.push(ensemble);
  }
  if (ensembles.length === 0) return null;
  if (ensembles.length === 1) return new DiagnosticAgent(ensembles[0] as DiagnosticEnsemble);

  // 30-s per child fits inside DiagnosticAgent's deadline; if Ollama
  // hangs, we fall through to NVIDIA/Anthropic in time. cascading.ts
  // type-imports DiagnosticEnsemble from this file — no runtime cycle.
  return new DiagnosticAgent(
    new CascadingEnsemble({
      children: ensembles,
      perChildTimeoutMs: 30_000,
    }),
  );
}

/** Pure helper — used by the API to surface the chosen backend on /health. */
export function pickDiagnosticBackend(env: BackendEnv): DiagnosticBackendKind {
  const priority = resolveBackendPriority(env);
  for (const kind of priority) {
    if (isBackendAvailable(kind, env)) return kind;
  }
  return 'offline';
}
