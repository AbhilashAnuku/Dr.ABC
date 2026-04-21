import type { DiagnosticInput, Differential } from '@dr-abc/types';
import type { DiagnosticEnsemble } from '../diagnostic.ts';
import { parseJsonOrSalvage, shapeResponse } from './hf.ts';

/**
 * NvidiaEnsemble — diagnostic ensemble backed by NVIDIA's NIM Inference
 * API at integrate.api.nvidia.com (OpenAI-compatible /v1/chat/completions).
 *
 * Free tier (1 000 credits / month) gives access to frontier-quality
 * generalist models — Llama 3.3 70B, Llama 3.1 405B, NeMoTron 70B,
 * Mixtral 8x22B, Gemma 2, etc. Default = NeMoTron-70B because NVIDIA's
 * own RLHF tune is the strongest follower of the JSON-only output
 * contract among the open weights they host.
 *
 * Reuses the HF backend's parser + shaper — both endpoints return the
 * same OpenAI envelope, so the only thing that differs is URL + auth.
 */

const NIM_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
// Default chosen because (a) it's available on the standard developer
// account tier without explicit model entitlement and (b) it follows
// JSON-only output instructions reliably in our smoke tests. NeMoTron
// 70B is preferable when entitled — override via NVIDIA_MODEL.
const DEFAULT_MODEL = 'meta/llama-3.3-70b-instruct';
// Bumped to 90s on 2026-05-13 — NVIDIA NIM cold-start on the hosted
// endpoint can be 15-30 s, and the original 30 s ceiling was firing on
// every first call of the demo. 90 s keeps the patient seeing real
// diagnostic output instead of "operation timed out."
const REQUEST_TIMEOUT_MS = 90_000;

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

export class NvidiaEnsemble implements DiagnosticEnsemble {
  readonly name: string;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(opts: { apiKey: string; model?: string }) {
    this.apiKey = opts.apiKey;
    this.model = opts.model ?? DEFAULT_MODEL;
    this.name = `nvidia:${this.model}`;
  }

  async vote(input: DiagnosticInput): Promise<{
    differentials: Differential[];
    recommendedTests: string[];
    recommendedSpecialty: string;
    rawConfidence: number;
  }> {
    const res = await fetch(NIM_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserMessage(input) },
        ],
        max_tokens: 2048,
        temperature: 0.2,
        top_p: 0.9,
        stream: false,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`NVIDIA NIM ${res.status} ${res.statusText}: ${detail.slice(0, 200)}`);
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
  const lines: string[] = ['Patient presentation:', input.text, ''];
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
    if (input.triage.redFlags.length)
      lines.push(`Red flags raised: ${input.triage.redFlags.join('; ')}.`);
    lines.push(`Triage rationale: ${input.triage.rationale}`);
  }
  lines.push('', 'Reply with ONE JSON object matching the schema. No prose.');
  return lines.join('\n');
}
