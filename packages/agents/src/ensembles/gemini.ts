import type { DiagnosticInput, Differential } from '@dr-abc/types';
import type { DiagnosticEnsemble } from '../diagnostic.ts';
import { parseJsonOrSalvage, shapeResponse } from './hf.ts';

/**
 * GeminiEnsemble — Google Gemini API as a diagnostic backend.
 *
 * Adds the Gemini API as a zero-budget backend.
 * Gemini's free tier (Gemini 2.0 Flash / 1.5 Pro) covers demo traffic
 * easily; this gives Mörbius a third free reasoning path beside
 * NVIDIA NIM and HuggingFace OpenBioLLM. Anthropic stays out of the
 * default cascade.
 *
 * Uses the v1beta `generativelanguage.googleapis.com` REST surface
 * (no SDK install needed). Same JSON-only output contract as the
 * other ensembles, same `vote()` signature so it slots into the
 * existing cascade without parsing changes.
 */

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_MODEL = 'gemini-2.0-flash';
const REQUEST_TIMEOUT_MS = 45_000;

const SYSTEM_PROMPT = `You are the Diagnostic Agent inside Mörbius, an industrial-grade medical AI fronting the Dr.ABC platform. You produce ranked differential diagnoses for clinicians and informed patients. Never claim certainty; every diagnosis is a probability with explicit supporting and counter-evidence drawn ONLY from the input. Do not fabricate findings, labs, or imaging the user did not state.

OUTPUT CONTRACT — reply with a single JSON object and nothing else (no markdown fences, no commentary). Schema:

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

export class GeminiEnsemble implements DiagnosticEnsemble {
  readonly name: string;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(opts: { apiKey: string; model?: string }) {
    this.apiKey = opts.apiKey;
    this.model = opts.model ?? DEFAULT_MODEL;
    this.name = `gemini:${this.model}`;
  }

  async vote(input: DiagnosticInput): Promise<{
    differentials: Differential[];
    recommendedTests: string[];
    recommendedSpecialty: string;
    rawConfidence: number;
  }> {
    const url = `${GEMINI_BASE}/models/${this.model}:generateContent?key=${this.apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: buildUserMessage(input) }] }],
        generationConfig: {
          temperature: 0.2,
          topP: 0.9,
          maxOutputTokens: 2048,
          responseMimeType: 'application/json',
        },
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Gemini ${res.status} ${res.statusText}: ${detail.slice(0, 200)}`);
    }

    const completion = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const reply = completion.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
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
    if (v.systolic !== undefined && v.diastolic !== undefined) {
      parts.push(`BP ${v.systolic}/${v.diastolic}`);
    }
    if (v.spo2Pct !== undefined) parts.push(`SpO2 ${v.spo2Pct}%`);
    if (v.tempC !== undefined) parts.push(`T ${v.tempC}°C`);
    if (v.rrPerMin !== undefined) parts.push(`RR ${v.rrPerMin}`);
    if (parts.length) lines.push(`Vitals: ${parts.join(' · ')}`);
  }
  return lines.join('\n');
}
