import type { DiagnosticInput, Differential } from '@dr-abc/types';
import type { DiagnosticEnsemble } from '../diagnostic.ts';
import { parseJsonOrSalvage, shapeResponse } from './hf.ts';

/**
 * OllamaEnsemble — diagnostic ensemble talking to a local Ollama daemon.
 *
 * Why this exists:
 *   - Fully sovereign — no API key, no outbound network, runs on a
 *     local machine. Matches the "local-first" pillar of the
 *     architecture spec (§3 Privacy Tiers).
 *   - Default INFERENCE model is `llama3.1:8b` — the largest model that
 *     fits on a 16 GB box (Q4_K_M needs ~5 GB RAM at
 *     runtime, leaves headroom for browser + API + py-svc).
 *   - Default TRAINING / fine-tuning target stays Llama 3.3 70b Instruct
 *     (AGENTS.md §10) — that path runs on a 64 GB+ workstation or
 *     GPU-offload setup, not the 16 GB laptop. 70b at Q4_K_M needs
 *     ~49 GB RAM for inference; on a 16 GB box it loads to disk but
 *     cannot serve a request.
 *   - Override anytime via OLLAMA_MODEL — meditron, medllama2,
 *     llama3.3:70b-instruct-q4_K_M (on capable hardware) all work.
 *   - Reuses the HF backend's tolerant parser + shaper for structured
 *     output discipline. Ollama's `format: "json"` forces JSON mode but
 *     small open models still occasionally drift.
 */

const DEFAULT_BASE_URL = 'http://localhost:11434';
// Practical inference fit on 16 GB hardware. Override per-deploy:
//   capable workstation: OLLAMA_MODEL=llama3.3:70b-instruct-q4_K_M
//   med-tuned baselines: OLLAMA_MODEL=meditron  |  medllama2
const DEFAULT_MODEL = 'llama3.1:8b';
const REQUEST_TIMEOUT_MS = 60_000;

const SYSTEM_PROMPT = `You are the Diagnostic Agent inside Mörbius. Produce ranked differential diagnoses. Reply with a single JSON object only, no prose, schema:
{
  "differentials": [
    { "condition": string, "icd10": string | null, "probability": 0..1, "supportingEvidence": string[], "counterEvidence": string[] }
  ],
  "recommendedTests": string[],
  "recommendedSpecialty": string
}
Rank highest probability first; 3-6 entries; use only findings stated.`;

export class OllamaEnsemble implements DiagnosticEnsemble {
  readonly name: string;
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(opts: { baseUrl?: string; model?: string }) {
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.model = opts.model ?? DEFAULT_MODEL;
    this.name = `ollama:${this.model}`;
  }

  async vote(input: DiagnosticInput): Promise<{
    differentials: Differential[];
    recommendedTests: string[];
    recommendedSpecialty: string;
    rawConfidence: number;
  }> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserMessage(input) },
        ],
        format: 'json',
        stream: false,
        options: { temperature: 0.2 },
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Ollama ${res.status} ${res.statusText}: ${detail.slice(0, 200)}`);
    }

    const completion = (await res.json()) as { message?: { content?: string } };
    const reply = completion.message?.content ?? '';
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
    if (v.hrBpm !== undefined) parts.push(`HR ${v.hrBpm}`);
    if (v.systolic !== undefined && v.diastolic !== undefined)
      parts.push(`BP ${v.systolic}/${v.diastolic}`);
    if (v.spo2Pct !== undefined) parts.push(`SpO2 ${v.spo2Pct}%`);
    if (v.tempC !== undefined) parts.push(`Temp ${v.tempC}°C`);
    if (v.rrPerMin !== undefined) parts.push(`RR ${v.rrPerMin}`);
    if (parts.length) lines.push(`Vitals: ${parts.join(', ')}`);
  }
  if (input.triage) {
    lines.push('', `Triage ESI ${input.triage.esi}.`);
    if (input.triage.redFlags.length) lines.push(`Red flags: ${input.triage.redFlags.join('; ')}.`);
    lines.push(`Triage rationale: ${input.triage.rationale}`);
  }
  lines.push('', 'Reply with ONE JSON object. No prose.');
  return lines.join('\n');
}
