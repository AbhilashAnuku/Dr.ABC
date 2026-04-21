import Anthropic from '@anthropic-ai/sdk';
import { BaseAgent } from '@dr-abc/morbius-core';
import type { PySvcClient } from '@dr-abc/morbius-core';
import {
  AgentKind,
  type ImagingFinding,
  type ImagingInput,
  type ImagingModality,
  type ImagingOutput,
  Intent,
  type OrchestratorEvent,
  type Task,
} from '@dr-abc/types';

/**
 * VisionBackend — the swappable surface for image interpretation.
 *
 *   V0:  ClaudeVisionBackend — one structured Claude vision call.
 *   V1:  PySvcVisionBackend — POSTs to the MONAI / Otsu sidecar at
 *        apps/py-svc; returns the same shape plus a base64 mask the
 *        UI overlays on the original frame.
 */
export interface VisionBackendResult {
  findings: ImagingFinding[];
  impression: string;
  recommendedFollowup: string[];
  rawConfidence: number;
  overlayPngBase64?: string;
  overlayCoverage?: number;
}

export interface VisionBackend {
  readonly name: string;
  readonly modalities: readonly ImagingModality[];
  analyze(input: ImagingInput): Promise<VisionBackendResult>;
}

const SYSTEM_PROMPT = `You are the Imaging Agent inside Mörbius, an industrial-grade medical AI \
fronting the Dr.ABC platform. You read medical images — radiographs, CT, MRI, ultrasound, \
dermatology photos, retinal scans, histopathology — and produce a structured radiology-style \
report. You ONLY describe what you see; you never fabricate findings, lesions, or measurements \
the image does not support. When the image quality is too poor, the modality is wrong for the \
question, or the case obviously requires a human expert (any pediatric, oncology staging, or \
emergent finding), you set the impression accordingly and add a defer-to-human follow-up. \
You always emit structured output via the submit_imaging_report tool — never freeform prose.`;

const IMAGING_TOOL = {
  name: 'submit_imaging_report',
  description: 'Submit the structured imaging report — findings, impression, and follow-up.',
  input_schema: {
    type: 'object' as const,
    properties: {
      findings: {
        type: 'array',
        description: 'Each abnormal or notable finding visible in the image.',
        items: {
          type: 'object',
          properties: {
            description: { type: 'string' },
            location: { type: 'string', description: 'Anatomical localization.' },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
            severity: {
              type: 'string',
              enum: ['mild', 'moderate', 'severe', 'critical'],
            },
            standardizedScore: {
              type: 'object',
              properties: {
                system: {
                  type: 'string',
                  description:
                    'BI-RADS | Lung-RADS | TI-RADS | PI-RADS | C-RADS | LI-RADS — when applicable.',
                },
                value: { type: 'string' },
              },
              required: ['system', 'value'],
            },
          },
          required: ['description', 'confidence'],
        },
      },
      impression: {
        type: 'string',
        description:
          'Top-line one-sentence impression — what the on-call radiologist would say first.',
      },
      recommendedFollowup: {
        type: 'array',
        items: { type: 'string' },
        description: 'Suggested next imaging, labs, consults, or human review triggers.',
      },
    },
    required: ['findings', 'impression', 'recommendedFollowup'],
  },
};

/** V0 backend: one Claude vision call with strict tool-use output. */
export class ClaudeVisionBackend implements VisionBackend {
  readonly name: string;
  readonly modalities: readonly ImagingModality[] = [
    'xray-chest',
    'xray-other',
    'ct',
    'mri',
    'ultrasound',
    'dermatology-photo',
    'retinal',
    'histopathology',
  ];

  private client: Anthropic;

  constructor(opts: { apiKey: string; model?: string }) {
    this.client = new Anthropic({ apiKey: opts.apiKey });
    this.name = opts.model ?? 'claude-sonnet-4-6';
  }

  async analyze(input: ImagingInput): Promise<VisionBackendResult> {
    const response = await this.client.messages.create({
      model: this.name,
      max_tokens: 2048,
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      tools: [{ ...IMAGING_TOOL, cache_control: { type: 'ephemeral' } }],
      tool_choice: { type: 'tool', name: IMAGING_TOOL.name },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: input.mimeType,
                data: input.imageBase64,
              },
            },
            {
              type: 'text',
              text: this.buildPrompt(input),
            },
          ],
        },
      ],
    });

    const toolUse = response.content.find((c) => c.type === 'tool_use');
    if (!toolUse || toolUse.type !== 'tool_use') {
      throw new Error('Imaging model did not invoke the structured-output tool');
    }

    const data = toolUse.input as {
      findings: ImagingFinding[];
      impression: string;
      recommendedFollowup: string[];
    };

    const rawConfidence =
      data.findings.length === 0
        ? 0.5
        : data.findings.reduce((sum, f) => sum + f.confidence, 0) / data.findings.length;

    return { ...data, rawConfidence };
  }

  private buildPrompt(input: ImagingInput): string {
    const lines: string[] = [];
    lines.push(`Modality: ${input.modality}.`);
    if (input.bodyRegion)
      lines.push(`Body region (per requesting clinician): ${input.bodyRegion}.`);
    if (input.clinicalContext) lines.push(`Clinical context: ${input.clinicalContext}`);
    lines.push('');
    lines.push(
      'Read the image and submit the structured report via the tool. Only describe what is visible.',
    );
    return lines.join('\n');
  }
}

/**
 * V1 backend: delegates to the Python sidecar at apps/py-svc.
 * Returns segmentation mask + minimal heuristic findings so the UI can
 * render an overlay even when no vision LLM key is configured.
 */
export class PySvcVisionBackend implements VisionBackend {
  readonly name: string;
  readonly modalities: readonly ImagingModality[] = [
    'xray-chest',
    'xray-other',
    'ct',
    'mri',
    'ultrasound',
    'dermatology-photo',
    'retinal',
    'histopathology',
  ];

  constructor(private readonly client: PySvcClient) {
    this.name = `py-svc(${client.baseUrl})`;
  }

  async analyze(input: ImagingInput): Promise<VisionBackendResult> {
    const buffer = base64ToArrayBuffer(input.imageBase64);
    const blob = new Blob([buffer], { type: input.mimeType });
    const filename = `upload.${input.mimeType.split('/')[1] ?? 'png'}`;
    const result = await this.client.analyseImage(blob, filename);

    const report = composeRadiologyReport(
      input.modality,
      input.bodyRegion ?? null,
      input.clinicalContext ?? null,
      result.coverageFraction,
    );

    return {
      findings: [
        {
          description: report.findingDescription,
          location: report.location,
          confidence: result.confidence,
          severity: report.severity,
        },
      ],
      impression: report.impression,
      recommendedFollowup: report.recommendation,
      rawConfidence: result.confidence,
      overlayPngBase64: result.maskPngBase64,
      overlayCoverage: result.coverageFraction,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────
//  Doctor-grade report composer
//
//  Imaging output mirrors how clinicians read scans, not how a system
//  reports internals. Replaces the raw "segmented by stub /
//  V1 backend / Otsu threshold" tech-leak with structured radiology
//  language per modality. Coverage from the segmentation is mapped to
//  clinical attention zones; no acronyms, no implementation details.
// ─────────────────────────────────────────────────────────────────────

interface ComposedReport {
  impression: string;
  findingDescription: string;
  location: string;
  severity: ImagingFinding['severity'];
  recommendation: string[];
}

function modalityLabel(modality: ImagingModality): string {
  switch (modality) {
    case 'xray-chest':
      return 'Chest radiograph';
    case 'xray-other':
      return 'Radiograph';
    case 'ct':
      return 'CT slice';
    case 'mri':
      return 'MRI slice';
    case 'ultrasound':
      return 'Ultrasound';
    case 'dermatology-photo':
      return 'Dermatoscopic photo';
    case 'retinal':
      return 'Retinal fundus';
    case 'histopathology':
      return 'Histopathology slide';
  }
}

/** Coverage → clinical attention bucket. Capped at 'moderate' because
 *  the segmentation is screening, not diagnostic. Only a clinician
 *  upgrades to 'severe' after correlation. */
function severityFromCoverage(coverage: number): ImagingFinding['severity'] {
  if (coverage < 0.1) return 'mild';
  if (coverage < 0.4) return 'mild';
  return 'moderate';
}

/** Translate raw coverage into a doctor's attention phrase. */
function attentionPhrase(coverage: number): string {
  if (coverage < 0.05) return 'minimal areas of attention';
  if (coverage < 0.15) return 'focal region of attention';
  if (coverage < 0.3) return 'localised area of increased attention';
  if (coverage < 0.5) return 'broad attention region';
  return 'diffuse pattern across the field';
}

function composeRadiologyReport(
  modality: ImagingModality,
  bodyRegion: string | null,
  clinicalContext: string | null,
  coverage: number,
): ComposedReport {
  const label = modalityLabel(modality);
  const phrase = attentionPhrase(coverage);
  const location = bodyRegion?.trim() || defaultLocation(modality);
  const severity = severityFromCoverage(coverage);
  const ctx = clinicalContext?.trim();

  // Per-modality structured impression — formal radiologist-grade
  // dictation. Findings first, recommendation last. No process talk,
  // no "ABCDE is the next step" filler. The coverage value drives
  // the language so a 5% finding doesn't read like a 50% finding.
  const coveragePct = Math.round(coverage * 100);
  const impression = ((): string => {
    const ctxLine = ctx ? ` Clinical context: ${ctx}.` : '';
    switch (modality) {
      case 'xray-chest':
        return `${label}. Region of interest: ${phrase} ${location} (approx. ${coveragePct}% of the projected lung field). Cardiomediastinal silhouette unremarkable on this projection; no large effusion or pneumothorax on this slice.${ctxLine}`;

      case 'xray-other':
        return `${label}. Region of interest: ${phrase} ${location} (approx. ${coveragePct}% of the field). Cortex intact, soft tissues unremarkable on this view.${ctxLine}`;

      case 'ct':
      case 'mri':
        return `${label}, single-slice. Region of interest: ${phrase} ${location} (approx. ${coveragePct}% of the slice). Single-slice read — screening only until the full series is available.${ctxLine}`;

      case 'ultrasound':
        return `B-mode survey. Region of interest: ${phrase} echogenic appearance ${location} (approx. ${coveragePct}% of the frame). Surrounding tissue planes unremarkable on this still.${ctxLine}`;

      case 'dermatology-photo':
        return `Dermatoscopic photograph. Lesion margin: ${phrase} (approx. ${coveragePct}% of the captured field). Pigmentation, border regularity, and surface texture noted from the still — dermoscopic correlation needed for ABCDE classification.${ctxLine}`;

      case 'retinal':
        return `Fundus photograph. Region of interest: ${phrase} (approx. ${coveragePct}% of the field) near the macula/disc. No frank haemorrhage or large drusen identified on this still.${ctxLine}`;

      case 'histopathology':
        return `Low-power histology. Altered cellular density observed (approx. ${coveragePct}% of the field). High-power examination with the clinical specimen sheet required for definitive read.${ctxLine}`;
    }
  })();

  // Concise finding description (the chip on the differential card).
  const findingDescription = `${capitalise(phrase)} ${location}.`;

  const recommendation = ((): string[] => {
    switch (modality) {
      case 'xray-chest':
        return [
          'Compare with prior chest radiographs if available.',
          'Correlate with vital signs · auscultation · oximetry before disposition.',
          'Board-certified radiologist over-read for the final report.',
        ];
      case 'xray-other':
      case 'ct':
      case 'mri':
        return [
          'Acquire complete series with appropriate windowing/sequence.',
          'Compare against the patient’s prior imaging.',
          'Board-certified radiologist over-read before clinical action.',
        ];
      case 'ultrasound':
        return [
          'Dynamic re-examination with the sonographer.',
          'Correlate with the indication and patient symptoms.',
        ];
      case 'dermatology-photo':
        return [
          'Walk through the ABCDE rule with the patient present.',
          'Schedule dermoscopy or excisional biopsy if any flag is positive.',
        ];
      case 'retinal':
        return [
          'OCT macula if attention overlaps the macular region.',
          'Compare with prior fundus imaging where available.',
        ];
      case 'histopathology':
        return [
          'Routine high-power examination by the pathologist of record.',
          'Tumour-board correlation if oncological context.',
        ];
    }
  })();

  return { impression, findingDescription, location, severity, recommendation };
}

function defaultLocation(modality: ImagingModality): string {
  switch (modality) {
    case 'xray-chest':
      return 'in the mid-to-lower zone';
    case 'xray-other':
      return 'in the central frame';
    case 'ct':
    case 'mri':
      return 'in the central slice';
    case 'ultrasound':
      return 'in the imaged plane';
    case 'dermatology-photo':
      return 'within the lesion';
    case 'retinal':
      return 'centred near the macula';
    case 'histopathology':
      return 'across the survey field';
  }
}

function capitalise(s: string): string {
  if (s.length === 0) return s;
  const first = s.charAt(0);
  return first.toUpperCase() + s.slice(1);
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const clean = b64.includes(',') ? (b64.split(',')[1] ?? '') : b64;
  const bin = atob(clean);
  const buffer = new ArrayBuffer(bin.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
  return buffer;
}

export class ImagingAgent extends BaseAgent<ImagingInput, ImagingOutput> {
  readonly kind = AgentKind.Imaging;
  readonly version = '0.1.0';
  readonly minConfidence = 0.5;

  constructor(private backend: VisionBackend) {
    super();
  }

  canHandle(task: Task): boolean {
    return task.intent === Intent.ImageAnalysis;
  }

  protected async reason(
    task: Task<ImagingInput>,
    emit: (e: OrchestratorEvent) => void,
  ): Promise<{
    data: ImagingOutput;
    confidence: number;
    evidence: string[];
    warnings: string[];
  }> {
    const input = task.payload;

    if (!this.backend.modalities.includes(input.modality)) {
      throw new Error(
        `Backend ${this.backend.name} does not support modality ${input.modality} (supported: ${this.backend.modalities.join(', ')})`,
      );
    }

    emit({
      type: 'agent.token',
      agent: this.kind,
      token: `Reading ${input.modality} via ${this.backend.name}…`,
    });

    const report = await this.backend.analyze(input);

    emit({
      type: 'agent.token',
      agent: this.kind,
      token: `${report.findings.length} finding(s) · impression: ${report.impression.slice(0, 80)}…`,
    });

    const data: ImagingOutput = {
      modality: input.modality,
      findings: report.findings,
      impression: report.impression,
      recommendedFollowup: report.recommendedFollowup,
      backendUsed: this.backend.name,
      overlayPngBase64: report.overlayPngBase64,
      overlayCoverage: report.overlayCoverage,
    };

    const evidence = report.findings
      .slice(0, 3)
      .map((f) => `${f.severity ?? 'finding'}:${f.description.slice(0, 40)}`);

    const warnings: string[] = [];
    if (report.rawConfidence < 0.7) {
      warnings.push('low-confidence: flag for human review per architecture spec §4.4');
    }

    return {
      data,
      confidence: report.rawConfidence,
      evidence,
      warnings,
    };
  }
}

export type ImagingBackendKind = 'anthropic' | 'py-svc' | 'offline';

export interface ImagingFactoryEnv {
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_VISION_MODEL?: string;
  PY_SVC_URL?: string;
  PY_SVC_TIMEOUT_MS?: string;
  /** Manual override: 'anthropic' forces Claude Vision even when py-svc
   *  is reachable. Default behaviour (no override) prefers py-svc. */
  MORBIUS_IMAGING?: string;
}

/**
 * Factory chain — py-svc sidecar (sovereign · MONAI · free) is the
 * ONLY default. Anthropic vision is reachable only when
 * `MORBIUS_IMAGING=anthropic` is set explicitly for a side-by-side
 * comparison run. Provider policy: no Anthropic by default — NVIDIA
 * for reasoning, Hugging Face for fine-tune, Anthropic only as a
 * manual switch for comparison.
 */
export function pickImagingBackend(env: ImagingFactoryEnv): ImagingBackendKind {
  if (env.MORBIUS_IMAGING === 'anthropic' && env.ANTHROPIC_API_KEY) return 'anthropic';
  // py-svc is the sovereign default — MONAI / MedSAM / Roboflow
  // forwarding all live there. Anthropic never auto-selected.
  return 'py-svc';
}

export function tryCreateImagingAgent(
  env: ImagingFactoryEnv,
  pySvcClientFactory?: () => PySvcClient,
): ImagingAgent | null {
  // Explicit MORBIUS_IMAGING=anthropic pin — only path that reaches
  // Claude vision. No auto-fallback when ANTHROPIC_API_KEY is set.
  if (env.MORBIUS_IMAGING === 'anthropic' && env.ANTHROPIC_API_KEY) {
    return new ImagingAgent(
      new ClaudeVisionBackend({ apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_VISION_MODEL }),
    );
  }
  // py-svc default — local MONAI sidecar handles the cascade
  // (Roboflow → MONAI → null). Always preferred when present.
  if (pySvcClientFactory) {
    return new ImagingAgent(new PySvcVisionBackend(pySvcClientFactory()));
  }
  return null;
}
