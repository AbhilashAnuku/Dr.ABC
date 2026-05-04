import { describe, expect, test } from 'bun:test';
import { DiagnosticAgent, type DiagnosticEnsemble } from '@dr-abc/agents';
import {
  type AgentResult,
  type DiagnosticInput,
  Intent,
  type OrchestratorEvent,
  type Task,
  type TriageOutput,
} from '@dr-abc/types';

const baseContext = {
  sessionId: 'test-session',
  patientIdHash: null,
  purposeOfUse: 'TREATMENT' as const,
  consentToken: null,
  locale: 'en-US',
  deviceClass: 'web' as const,
};

const triageUpstream: AgentResult<TriageOutput> = {
  agent: 'triage',
  taskId: 'parent-task',
  verdict: 'pass',
  confidence: 0.92,
  data: {
    esi: 2,
    redFlags: ['possible MI'],
    suggestedNextAgent: 'diagnostic',
    rationale: 'Red-flag indicators detected: possible MI. Escalating to ESI 2.',
  },
  evidence: ['red-flag:possible MI'],
  warnings: ['URGENT — escalate to clinician immediately'],
  followUps: [],
  cost: { tokens: 0, ms: 3, usd: 0 },
};

function makeTask(payload: unknown): Task<DiagnosticInput> {
  return {
    taskId: 'parent-task::diagnostic',
    parentTaskId: 'parent-task',
    intent: Intent.Symptom,
    priority: 2,
    deadlineMs: 10_000,
    payload: payload as DiagnosticInput,
    context: baseContext,
    trace: [],
    createdAt: Date.now(),
  };
}

const happyPathEnsemble: DiagnosticEnsemble = {
  name: 'mock-claude',
  async vote() {
    return {
      differentials: [
        {
          condition: 'Acute coronary syndrome',
          icd10: 'I24.9',
          probability: 0.62,
          supportingEvidence: ['crushing chest pain', 'radiation to left arm'],
          counterEvidence: [],
        },
        {
          condition: 'Aortic dissection',
          icd10: 'I71.0',
          probability: 0.18,
          supportingEvidence: ['acute severe chest pain'],
          counterEvidence: ['no back pain reported'],
        },
        {
          condition: 'GERD',
          icd10: 'K21.9',
          probability: 0.1,
          supportingEvidence: ['chest discomfort'],
          counterEvidence: ['radiation pattern atypical'],
        },
      ],
      recommendedTests: ['12-lead ECG', 'troponin', 'CXR'],
      recommendedSpecialty: 'cardiology',
      rawConfidence: 0.62,
    };
  },
};

const failingEnsemble: DiagnosticEnsemble = {
  name: 'mock-claude-broken',
  async vote() {
    throw new Error('upstream LLM 500');
  },
};

describe('DiagnosticAgent', () => {
  test('canHandle returns true for symptom + emergency, false for unrelated', () => {
    const agent = new DiagnosticAgent(happyPathEnsemble);
    expect(agent.canHandle(makeTask({ text: 'x' }))).toBe(true);
    expect(
      agent.canHandle({
        ...makeTask({ text: 'x' }),
        intent: Intent.Emergency,
      }),
    ).toBe(true);
    expect(
      agent.canHandle({
        ...makeTask({ text: 'x' }),
        intent: Intent.AnatomyShow,
      }),
    ).toBe(false);
  });

  test('happy path — produces ranked differentials with verdict pass', async () => {
    const agent = new DiagnosticAgent(happyPathEnsemble);
    const task = makeTask({
      text: 'crushing chest pain radiating to my left arm',
      upstream: triageUpstream,
    });
    const tokens: string[] = [];
    const emit = (e: OrchestratorEvent) => {
      if (e.type === 'agent.token') tokens.push(e.token);
    };

    const result = await agent.run(task, emit);

    expect(result.verdict).toBe('pass');
    expect(result.confidence).toBeGreaterThanOrEqual(0.5);
    expect(result.data.differentials.length).toBe(3);
    expect(result.data.differentials[0]?.condition).toBe('Acute coronary syndrome');
    expect(result.data.recommendedSpecialty).toBe('cardiology');
    expect(result.data.modelUsed).toBe('mock-claude');
    expect(result.evidence.length).toBeGreaterThan(0);
    // Ensure we streamed at least the consultation + result tokens
    expect(tokens.length).toBeGreaterThanOrEqual(2);
  });

  test('triage upstream is propagated into the ensemble', async () => {
    const captured: DiagnosticInput[] = [];
    const spyEnsemble: DiagnosticEnsemble = {
      name: 'spy',
      async vote(input) {
        captured.push(input);
        return {
          differentials: [
            { condition: 'X', probability: 0.7, supportingEvidence: ['a'], counterEvidence: [] },
          ],
          recommendedTests: [],
          recommendedSpecialty: 'general',
          rawConfidence: 0.7,
        };
      },
    };
    const agent = new DiagnosticAgent(spyEnsemble);
    await agent.run(
      makeTask({
        text: 'crushing chest pain',
        upstream: triageUpstream,
      }),
      () => {},
    );

    expect(captured.length).toBe(1);
    const seen = captured[0];
    expect(seen?.text).toBe('crushing chest pain');
    expect(seen?.triage?.esi).toBe(2);
    expect(seen?.triage?.redFlags).toContain('possible MI');
  });

  test('failure path — ensemble throws, agent returns verdict fail with warning', async () => {
    const agent = new DiagnosticAgent(failingEnsemble);
    const events: OrchestratorEvent[] = [];
    const emit = (e: OrchestratorEvent) => events.push(e);
    const result = await agent.run(makeTask({ text: 'severe headache' }), emit);

    expect(result.verdict).toBe('fail');
    expect(result.confidence).toBe(0);
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('upstream LLM 500')]),
    );
    expect(events.some((e) => e.type === 'agent.failed')).toBe(true);
  });

  test('empty differentials → warning surfaced', async () => {
    const emptyEnsemble: DiagnosticEnsemble = {
      name: 'empty',
      async vote() {
        return {
          differentials: [],
          recommendedTests: [],
          recommendedSpecialty: 'general',
          rawConfidence: 0,
        };
      },
    };
    const agent = new DiagnosticAgent(emptyEnsemble);
    const result = await agent.run(makeTask({ text: 'unclear' }), () => {});
    expect(result.warnings).toEqual(expect.arrayContaining(['no differentials produced']));
    // Confidence below minConfidence (0.5) flips verdict to defer-to-human.
    expect(result.verdict).toBe('defer-to-human');
  });
});
