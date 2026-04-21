import { describe, expect, it } from 'bun:test';
import {
  AgentKind,
  type DiagnosticInput,
  type Differential,
  Intent,
  type Task,
} from '@dr-abc/types';
import type { DiagnosticEnsemble } from '../diagnostic.ts';
import {
  CardiologyAgent,
  DermatologyAgent,
  EndocrinologyAgent,
  NeurologyAgent,
  OncologyAgent,
  PulmonologyAgent,
  SPECIALTY_PROMPTS,
  buildAllSpecialists,
  routeToSpecialist,
} from './index.ts';

const STUB_DIFF: Differential = {
  condition: 'Stub condition',
  probability: 0.6,
  supportingEvidence: ['evidence-1', 'evidence-2'],
  counterEvidence: ['counter-1'],
};

class CapturingEnsemble implements DiagnosticEnsemble {
  readonly name = 'capture-stub';
  lastInput: DiagnosticInput | null = null;

  async vote(input: DiagnosticInput) {
    this.lastInput = input;
    return {
      differentials: [STUB_DIFF],
      recommendedTests: ['ECG'],
      recommendedSpecialty: 'whatever',
      rawConfidence: 0.7,
    };
  }
}

function task(text: string): Task<DiagnosticInput> {
  return {
    taskId: 'tsk_test',
    parentTaskId: null,
    intent: Intent.Symptom,
    payload: { text } as DiagnosticInput,
    context: {
      sessionId: 'sess_test',
      patientIdHash: null,
      purposeOfUse: 'TREATMENT',
      consentToken: null,
      locale: 'en-US',
      deviceClass: 'web',
    },
    priority: 5,
    deadlineMs: 5_000,
    trace: [],
    createdAt: Date.now(),
  };
}

describe('routeToSpecialist', () => {
  it('routes "chest pain" to cardiology', () => {
    expect(routeToSpecialist('chest pain workup')).toBe('cardiology');
    expect(routeToSpecialist('STEMI standard load')).toBe('cardiology');
    expect(routeToSpecialist('atrial fibrillation')).toBe('cardiology');
  });
  it('routes neuro queries to neurology', () => {
    expect(routeToSpecialist('migraine + photophobia')).toBe('neurology');
    expect(routeToSpecialist('left-side stroke deficit')).toBe('neurology');
  });
  it('routes cancer-shaped strings to oncology', () => {
    expect(routeToSpecialist('non-small-cell lung CANCER')).toBe('oncology');
    expect(routeToSpecialist('palpable malignancy on exam')).toBe('oncology');
  });
  it('routes asthma / pneumonia to pulmonology', () => {
    expect(routeToSpecialist('asthma exacerbation')).toBe('pulmonology');
    expect(routeToSpecialist('community acquired pneumonia')).toBe('pulmonology');
  });
  it('routes endocrine to endocrinology', () => {
    expect(routeToSpecialist('type 2 diabetes follow-up')).toBe('endocrinology');
    expect(routeToSpecialist('thyroid nodule')).toBe('endocrinology');
  });
  it('routes skin to dermatology', () => {
    expect(routeToSpecialist('melanoma suspicious lesion')).toBe('dermatology');
    expect(routeToSpecialist('eczema flare')).toBe('dermatology');
  });
  it('returns null on unmapped specialty strings', () => {
    expect(routeToSpecialist(undefined)).toBeNull();
    expect(routeToSpecialist('orthopaedic shoulder injury')).toBeNull();
    expect(routeToSpecialist('')).toBeNull();
  });
});

describe('SpecialistAgent', () => {
  it('CardiologyAgent prepends the cardiology prompt to the input text', async () => {
    const ens = new CapturingEnsemble();
    const agent = new CardiologyAgent(ens);
    const result = await agent.run(task('crushing chest pain radiating to left arm'), () => {});
    expect(result.verdict).toBe('pass');
    expect(ens.lastInput?.text).toContain('CARDIOLOGY SPECIALIST');
    expect(ens.lastInput?.text).toContain('crushing chest pain');
    // The data block should report the specialist as the routed specialty,
    // not whatever the ensemble guessed.
    expect(result.data?.recommendedSpecialty).toBe(AgentKind.Cardiology);
    expect(result.data?.modelUsed).toContain('cardiology');
    expect(result.data?.modelUsed).toContain('capture-stub');
  });

  it('all six specialists carry the matching system prompt', async () => {
    const ens = new CapturingEnsemble();
    const map = buildAllSpecialists(ens);
    const cases: Array<[keyof typeof map, string]> = [
      ['cardiology', SPECIALTY_PROMPTS.cardiology.slice(0, 40)],
      ['neurology', SPECIALTY_PROMPTS.neurology.slice(0, 40)],
      ['oncology', SPECIALTY_PROMPTS.oncology.slice(0, 40)],
      ['pulmonology', SPECIALTY_PROMPTS.pulmonology.slice(0, 40)],
      ['endocrinology', SPECIALTY_PROMPTS.endocrinology.slice(0, 40)],
      ['dermatology', SPECIALTY_PROMPTS.dermatology.slice(0, 40)],
    ];
    for (const [id, expectedSnippet] of cases) {
      const ens2 = new CapturingEnsemble();
      const agent = buildAllSpecialists(ens2)[id];
      await agent.run(task('test query'), () => {});
      expect(ens2.lastInput?.text).toContain(expectedSnippet);
    }
  });

  it('all six specialists have distinct kinds matching AgentKind', () => {
    const ens = new CapturingEnsemble();
    const map = buildAllSpecialists(ens);
    expect(map.cardiology.kind).toBe(AgentKind.Cardiology);
    expect(map.neurology.kind).toBe(AgentKind.Neurology);
    expect(map.oncology.kind).toBe(AgentKind.Oncology);
    expect(map.pulmonology.kind).toBe(AgentKind.Pulmonology);
    expect(map.endocrinology.kind).toBe(AgentKind.Endocrinology);
    expect(map.dermatology.kind).toBe(AgentKind.Dermatology);
  });

  it('NeurologyAgent canHandle accepts Symptom + Emergency intents', () => {
    const ens = new CapturingEnsemble();
    const agent = new NeurologyAgent(ens);
    expect(agent.canHandle({ ...task('x'), intent: Intent.Symptom })).toBe(true);
    expect(agent.canHandle({ ...task('x'), intent: Intent.Emergency })).toBe(true);
    expect(agent.canHandle({ ...task('x'), intent: Intent.Research })).toBe(false);
  });

  it('OncologyAgent + DermatologyAgent + EndocrinologyAgent + PulmonologyAgent are constructable', () => {
    const ens = new CapturingEnsemble();
    expect(new OncologyAgent(ens).kind).toBe(AgentKind.Oncology);
    expect(new DermatologyAgent(ens).kind).toBe(AgentKind.Dermatology);
    expect(new EndocrinologyAgent(ens).kind).toBe(AgentKind.Endocrinology);
    expect(new PulmonologyAgent(ens).kind).toBe(AgentKind.Pulmonology);
  });
});
