import { describe, expect, test } from 'bun:test';
import {
  DEMO_BUNDLE,
  DEMO_PATIENT_HASH,
  InMemoryProfileStore,
  type PatientBundle,
  ProfileAgent,
  type ProfileInput,
  type ProfileStore,
  createDemoProfileAgent,
} from '@dr-abc/agents';
import { Intent, type OrchestratorEvent, type Task } from '@dr-abc/types';

const baseContext = {
  sessionId: 'profile-test',
  patientIdHash: null as string | null,
  purposeOfUse: 'TREATMENT' as const,
  consentToken: null,
  locale: 'en-US',
  deviceClass: 'web' as const,
};

function makeTask(payload: ProfileInput, patientIdHash: string | null = null): Task<ProfileInput> {
  return {
    taskId: 'profile-task',
    parentTaskId: null,
    intent: Intent.ProfileOp,
    priority: 4,
    deadlineMs: 5000,
    payload,
    context: { ...baseContext, patientIdHash },
    trace: [],
    createdAt: Date.now(),
  };
}

describe('InMemoryProfileStore', () => {
  test('reads a seeded bundle by patient id hash', async () => {
    const store = new InMemoryProfileStore([DEMO_BUNDLE]);
    const bundle = await store.read(DEMO_PATIENT_HASH);
    expect(bundle).not.toBeNull();
    expect(bundle?.patient.displayName).toBe('Architect Demo Patient');
    expect(bundle?.allergies.length).toBe(1);
    expect(bundle?.conditions[0]?.code).toBe('I10');
  });

  test('returns null for unknown patient', async () => {
    const store = new InMemoryProfileStore();
    const bundle = await store.read('does-not-exist');
    expect(bundle).toBeNull();
  });

  test('addAllergy appends to bundle and is readable on next read', async () => {
    const store = new InMemoryProfileStore([DEMO_BUNDLE]);
    const before = await store.read(DEMO_PATIENT_HASH);
    const beforeCount = before?.allergies.length ?? 0;
    const row = await store.addAllergy({
      patientIdHash: DEMO_PATIENT_HASH,
      substance: 'Sulfa',
      category: 'medication',
      criticality: 'high',
    });
    expect(row.substance).toBe('Sulfa');
    const after = await store.read(DEMO_PATIENT_HASH);
    expect(after?.allergies.length).toBe(beforeCount + 1);
  });

  test('addAllergy throws for unknown patient', async () => {
    const store = new InMemoryProfileStore();
    await expect(
      store.addAllergy({
        patientIdHash: 'unknown',
        substance: 'X',
        category: 'food',
      }),
    ).rejects.toThrow('Patient not found');
  });

  test('addCondition writes a condition row', async () => {
    const store = new InMemoryProfileStore([DEMO_BUNDLE]);
    await store.addCondition({
      patientIdHash: DEMO_PATIENT_HASH,
      display: 'Type 2 diabetes mellitus',
      code: 'E11.9',
      severity: 'moderate',
    });
    const bundle = await store.read(DEMO_PATIENT_HASH);
    expect(bundle?.conditions.find((c) => c.code === 'E11.9')).toBeDefined();
  });
});

describe('ProfileAgent', () => {
  test('canHandle accepts ProfileOp, rejects unrelated', () => {
    const agent = createDemoProfileAgent();
    expect(agent.canHandle(makeTask({ action: { kind: 'read', patientIdHash: 'x' } }))).toBe(true);
    expect(
      agent.canHandle({
        ...makeTask({ action: { kind: 'read', patientIdHash: 'x' } }),
        intent: Intent.Symptom,
      }),
    ).toBe(false);
  });

  test('read action returns the demo bundle with high confidence', async () => {
    const agent = createDemoProfileAgent();
    const tokens: string[] = [];
    const emit = (e: OrchestratorEvent) => {
      if (e.type === 'agent.token') tokens.push(e.token);
    };
    const result = await agent.run(
      makeTask({ action: { kind: 'read', patientIdHash: DEMO_PATIENT_HASH } }),
      emit,
    );
    expect(result.verdict).toBe('pass');
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    expect(result.data.bundle?.patient.displayName).toBe('Architect Demo Patient');
    expect(result.data.action).toBe('read');
    expect(tokens.length).toBeGreaterThan(0);
  });

  test('read with unknown patient returns defer-to-human', async () => {
    const agent = createDemoProfileAgent();
    const result = await agent.run(
      makeTask({ action: { kind: 'read', patientIdHash: 'nonexistent' } }),
      () => {},
    );
    expect(result.verdict).toBe('defer-to-human');
    expect(result.warnings).toEqual(expect.arrayContaining(['profile-not-found']));
    expect(result.data.bundle).toBeNull();
  });

  test('add-allergy action appends to the bundle', async () => {
    const agent = createDemoProfileAgent();
    const result = await agent.run(
      makeTask({
        action: {
          kind: 'add-allergy',
          patientIdHash: DEMO_PATIENT_HASH,
          substance: 'Latex',
          category: 'environment',
          criticality: 'high',
        },
      }),
      () => {},
    );
    expect(result.verdict).toBe('pass');
    expect(result.data.action).toBe('add-allergy');
    expect(result.data.bundle?.allergies.find((a) => a.substance === 'Latex')).toBeDefined();
  });

  test('add-condition action writes via the store', async () => {
    const agent = createDemoProfileAgent();
    const result = await agent.run(
      makeTask({
        action: {
          kind: 'add-condition',
          patientIdHash: DEMO_PATIENT_HASH,
          display: 'Asthma',
          code: 'J45.909',
          severity: 'mild',
        },
      }),
      () => {},
    );
    expect(result.verdict).toBe('pass');
    expect(result.data.bundle?.conditions.find((c) => c.code === 'J45.909')).toBeDefined();
  });

  test('falls back to context.patientIdHash when no explicit action provided', async () => {
    const agent = createDemoProfileAgent();
    const result = await agent.run(makeTask({}, DEMO_PATIENT_HASH), () => {});
    expect(result.verdict).toBe('pass');
    expect(result.data.action).toBe('read');
  });

  test('throws when no action AND no patientIdHash on context', async () => {
    const agent = createDemoProfileAgent();
    const result = await agent.run(makeTask({}), () => {});
    // BaseAgent catches the throw, sets verdict=fail
    expect(result.verdict).toBe('fail');
    expect(result.warnings.join(' ')).toContain('without an explicit action');
  });

  test('store can be swapped — agent is store-agnostic', async () => {
    const fakeStore: ProfileStore = {
      name: 'fake-store',
      async read() {
        const bundle: PatientBundle = {
          patient: {
            ...DEMO_BUNDLE.patient,
            id: 'fake-id',
            displayName: 'Fake Patient',
          },
          coverage: [],
          allergies: [],
          conditions: [],
        };
        return bundle;
      },
      async addAllergy() {
        throw new Error('not implemented');
      },
      async addCondition() {
        throw new Error('not implemented');
      },
    };
    const agent = new ProfileAgent(fakeStore);
    const result = await agent.run(
      makeTask({ action: { kind: 'read', patientIdHash: 'anything' } }),
      () => {},
    );
    expect(result.data.storeUsed).toBe('fake-store');
    expect(result.data.bundle?.patient.displayName).toBe('Fake Patient');
  });
});
