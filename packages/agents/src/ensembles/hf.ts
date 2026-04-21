import type { DiagnosticInput, Differential } from '@dr-abc/types';
import type { DiagnosticEnsemble } from '../diagnostic.ts';

/**
 * HuggingFaceEnsemble — diagnostic ensemble backed by the Hugging Face
 * Inference Router (OpenAI-compatible chat-completions endpoint).
 *
 * Why this exists:
 *   - Lets users run Mörbius without an Anthropic key.
 *   - Default model is `aaditya/Llama3-OpenBioLLM-8B`, a biomedical
 *     fine-tune of Llama-3 — small enough to be free-tier-friendly,
 *     domain-tuned enough to give useful differentials.
 *   - Override via HF_MODEL (any HF chat model the router serves).
 *
 * Why not Anthropic-style tool use:
 *   - Most HF-hosted open models do not implement tool-calling reliably.
 *   - Instead we use a strict JSON-only system prompt + tolerant parser
 *     that rescues the largest valid JSON object in the reply. Failure
 *     surfaces as `[]` differentials → orchestrator's confidence gate
 *     catches it via the existing minConfidence check.
 *
 * Streaming:
 *   - This V0 is non-streaming (single completion). The agent already
 *     emits two `agent.token` events on either side of the call, so the
 *     UI keeps a live trace. Token-level streaming is a follow-up slice
 *     when we add the standalone Reasoning agent.
 */

const HF_ROUTER_URL = 'https://router.huggingface.co/v1/chat/completions';
const DEFAULT_MODEL = 'aaditya/Llama3-OpenBioLLM-8B';
// HF Inference Router cold-start can take 40-50 s on the free tier
// when the model gets paged out. 50 s gives it room while still
// leaving the orchestrator's 120 s task budget enough headroom for
// a clean cascade fall-through to Ollama if HF dies too.
const REQUEST_TIMEOUT_MS = 50_000;

const SYSTEM_PROMPT = `You are the Diagnostic Agent inside Mörbius, an industrial-grade medical AI fronting the Dr.ABC platform. You produce ranked differential diagnoses for clinicians and informed patients. You never claim certainty; every diagnosis is a probability with explicit supporting and counter-evidence drawn ONLY from the input. You do not fabricate findings, labs, or imaging the user did not state.

OUTPUT CONTRACT — you MUST reply with a single JSON object and nothing else (no markdown fences, no commentary). Schema:

{
  "differentials": [
    {
      "condition": string,
      "icd10": string | null,
      "probability": number between 0 and 1,
      "supportingEvidence": string[],
      "counterEvidence": string[]
    }
  ],
  "recommendedTests": string[],
  "recommendedSpecialty": string
}

Rank differentials highest-probability first; 3-6 entries typical; probabilities should sum near 1.`;

interface RawDifferential {
  condition?: unknown;
  icd10?: unknown;
  probability?: unknown;
  supportingEvidence?: unknown;
  counterEvidence?: unknown;
}

interface RawResponse {
  differentials?: unknown;
  recommendedTests?: unknown;
  recommendedSpecialty?: unknown;
}

export class HuggingFaceEnsemble implements DiagnosticEnsemble {
  readonly name: string;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(opts: { apiKey: string; model?: string }) {
    this.apiKey = opts.apiKey;
    this.model = opts.model ?? DEFAULT_MODEL;
    this.name = `hf:${this.model}`;
  }

  async vote(input: DiagnosticInput): Promise<{
    differentials: Differential[];
    recommendedTests: string[];
    recommendedSpecialty: string;
    rawConfidence: number;
  }> {
    const body = {
      model: this.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserMessage(input) },
      ],
      response_format: { type: 'json_object' as const },
      max_tokens: 2048,
      temperature: 0.2,
    };

    const res = await fetch(HF_ROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`HF inference ${res.status} ${res.statusText}: ${detail.slice(0, 200)}`);
    }

    const completion = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const reply = completion.choices?.[0]?.message?.content ?? '';
    const parsed = parseJsonOrSalvage(reply);
    const shaped = shapeResponse(parsed);

    return {
      ...shaped,
      rawConfidence:
        shaped.differentials.length > 0 ? (shaped.differentials[0]?.probability ?? 0) : 0,
    };
  }
}

function buildUserMessage(input: DiagnosticInput): string {
  const lines: string[] = [];
  lines.push('Patient presentation:', input.text, '');
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
    lines.push('', `Triage assessment: ESI ${input.triage.esi}.`);
    if (input.triage.redFlags.length) {
      lines.push(`Red flags raised: ${input.triage.redFlags.join('; ')}.`);
    }
    lines.push(`Triage rationale: ${input.triage.rationale}`);
  }
  lines.push('', 'Reply with ONE JSON object matching the schema. No prose.');
  return lines.join('\n');
}

/**
 * Tolerant JSON parser. HF models occasionally wrap the JSON in ``` fences
 * or prepend a sentence despite the contract. We strip fences and grab the
 * largest balanced `{...}` block before parsing.
 */
export function parseJsonOrSalvage(reply: string): RawResponse {
  const cleaned = reply.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '');
  try {
    return JSON.parse(cleaned) as RawResponse;
  } catch {
    // pass — fall through to salvage
  }
  const start = cleaned.indexOf('{');
  if (start < 0) return {};
  // Walk forward, counting braces, until balanced.
  let depth = 0;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(cleaned.slice(start, i + 1)) as RawResponse;
        } catch {
          return {};
        }
      }
    }
  }
  return {};
}

export function shapeResponse(raw: RawResponse): {
  differentials: Differential[];
  recommendedTests: string[];
  recommendedSpecialty: string;
} {
  const differentials = Array.isArray(raw.differentials)
    ? raw.differentials.map(shapeDifferential).filter((d): d is Differential => d !== null)
    : [];
  const recommendedTests = Array.isArray(raw.recommendedTests)
    ? raw.recommendedTests.filter((t): t is string => typeof t === 'string')
    : [];
  const recommendedSpecialty =
    typeof raw.recommendedSpecialty === 'string' ? raw.recommendedSpecialty : 'general practice';
  return { differentials, recommendedTests, recommendedSpecialty };
}

function shapeDifferential(raw: unknown): Differential | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as RawDifferential;
  const condition = typeof r.condition === 'string' ? r.condition : null;
  if (!condition) return null;
  const probability = typeof r.probability === 'number' ? clamp01(r.probability) : 0;
  const supportingEvidence = Array.isArray(r.supportingEvidence)
    ? r.supportingEvidence.filter((s): s is string => typeof s === 'string')
    : [];
  const counterEvidence = Array.isArray(r.counterEvidence)
    ? r.counterEvidence.filter((s): s is string => typeof s === 'string')
    : [];
  const icd10 = typeof r.icd10 === 'string' ? r.icd10 : undefined;
  return { condition, icd10, probability, supportingEvidence, counterEvidence };
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
