import { describe, expect, test } from 'bun:test';
import { ImagingAgent, type VisionBackend } from '@dr-abc/agents';
import {
  type ImagingInput,
  type ImagingModality,
  Intent,
  type OrchestratorEvent,
  type Task,
} from '@dr-abc/types';

const baseContext = {
  sessionId: 'imaging-test',
  patientIdHash: null,
  purposeOfUse: 'TREATMENT' as const,
  consentToken: null,
  locale: 'en-US',
  deviceClass: 'web' as const,
};

// 1×1 transparent PNG, base64-encoded — smallest valid image payload.
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4//8/AwAI/AL+yyMgggAAAABJRU5ErkJggg==';

function makeImagingTask(
  modality: ImagingModality,
  intent: Intent = Intent.ImageAnalysis,
): Task<ImagingInput> {
  return {
    taskId: 'imaging-task',
    parentTaskId: null,
    intent,
    priority: 3,
    deadlineMs: 15_000,
    payload: {
      imageBase64: TINY_PNG_B64,
      mimeType: 'image/png',
      modality,
      bodyRegion: 'chest',
      clinicalContext: 'cough x 5 days',
    },
    context: baseContext,
    trace: [],
    createdAt: Date.now(),
  };
}

const supportedModalities: readonly ImagingModality[] = [
  'xray-chest',
  'ct',
  'mri',
  'ultrasound',
  'dermatology-photo',
];

const happyPathBackend: VisionBackend = {
  name: 'mock-vision',
  modalities: supportedModalities,
  async analyze() {
    return {
      findings: [
        {
          description: 'Increased opacity in right lower lobe',
          location: 'right lower lobe',
          confidence: 0.82,
          severity: 'moderate',
          standardizedScore: { system: 'Lung-RADS', value: '3' },
        },
        {
          description: 'No pneumothorax',
          confidence: 0.95,
          severity: 'mild',
        },
      ],
      impression: 'Right lower lobe opacity, likely community-acquired pneumonia.',
      recommendedFollowup: ['Sputum culture', 'Repeat CXR in 4-6 weeks'],
      rawConfidence: 0.88,
    };
  },
};

const lowConfidenceBackend: VisionBackend = {
  name: 'mock-vision-low',
  modalities: supportedModalities,
  async analyze() {
    return {
      findings: [
        { description: 'Possible nodule, image too noisy to characterize', confidence: 0.3 },
      ],
      impression: 'Indeterminate — defer to specialist.',
      recommendedFollowup: ['Higher-resolution imaging', 'Radiologist over-read'],
      rawConfidence: 0.3,
    };
  },
};

const failingBackend: VisionBackend = {
  name: 'mock-vision-broken',
  modalities: supportedModalities,
  async analyze() {
    throw new Error('vision endpoint 503');
  },
};

describe('ImagingAgent', () => {
  test('canHandle accepts ImageAnalysis, rejects unrelated', () => {
    const agent = new ImagingAgent(happyPathBackend);
    expect(agent.canHandle(makeImagingTask('xray-chest'))).toBe(true);
    expect(agent.canHandle(makeImagingTask('xray-chest', Intent.Symptom))).toBe(false);
  });

  test('happy path — produces structured findings + impression with verdict pass', async () => {
    const agent = new ImagingAgent(happyPathBackend);
    const tokens: string[] = [];
    const emit = (e: OrchestratorEvent) => {
      if (e.type === 'agent.token') tokens.push(e.token);
    };
    const result = await agent.run(makeImagingTask('xray-chest'), emit);

    expect(result.verdict).toBe('pass');
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    expect(result.data.findings.length).toBe(2);
    expect(result.data.impression).toContain('pneumonia');
    expect(result.data.modality).toBe('xray-chest');
    expect(result.data.backendUsed).toBe('mock-vision');
    expect(result.evidence.length).toBeGreaterThan(0);
    expect(tokens.length).toBeGreaterThanOrEqual(2);
  });

  test('low-confidence finding triggers human-review warning per spec §4.4', async () => {
    const agent = new ImagingAgent(lowConfidenceBackend);
    const result = await agent.run(makeImagingTask('ct'), () => {});
    expect(result.warnings.some((w) => w.includes('low-confidence'))).toBe(true);
    // Below minConfidence threshold flips verdict to defer-to-human.
    expect(result.verdict).toBe('defer-to-human');
  });

  test('unsupported modality short-circuits with verdict fail', async () => {
    const limitedBackend: VisionBackend = {
      name: 'limited',
      modalities: ['xray-chest'],
      async analyze() {
        throw new Error('should not be called');
      },
    };
    const agent = new ImagingAgent(limitedBackend);
    const result = await agent.run(makeImagingTask('histopathology'), () => {});
    expect(result.verdict).toBe('fail');
    expect(result.warnings.join(' ')).toContain('does not support');
  });

  test('failure path — backend throws, agent emits agent.failed + verdict fail', async () => {
    const agent = new ImagingAgent(failingBackend);
    const events: OrchestratorEvent[] = [];
    const emit = (e: OrchestratorEvent) => events.push(e);
    const result = await agent.run(makeImagingTask('mri'), emit);
    expect(result.verdict).toBe('fail');
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('vision endpoint 503')]),
    );
    expect(events.some((e) => e.type === 'agent.failed')).toBe(true);
  });

  test('backend can be swapped — agent is backend-agnostic', async () => {
    const customBackend: VisionBackend = {
      name: 'sidecar:monai-v1',
      modalities: ['xray-chest'],
      async analyze() {
        return {
          findings: [{ description: 'No acute findings', confidence: 0.95 }],
          impression: 'Normal chest radiograph.',
          recommendedFollowup: [],
          rawConfidence: 0.95,
        };
      },
    };
    const agent = new ImagingAgent(customBackend);
    const result = await agent.run(makeImagingTask('xray-chest'), () => {});
    expect(result.data.backendUsed).toBe('sidecar:monai-v1');
    expect(result.data.impression).toBe('Normal chest radiograph.');
  });
});
