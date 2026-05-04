import { describe, expect, test } from 'bun:test';
import {
  Bm25Retriever,
  LibraryAgent,
  type LibraryDocument,
  type LibraryInput,
  type Retriever,
  SEED_CORPUS,
  createSeedLibraryAgent,
} from '@dr-abc/agents';
import { Intent, type OrchestratorEvent, type Task } from '@dr-abc/types';

const baseContext = {
  sessionId: 'lib-test',
  patientIdHash: null,
  purposeOfUse: 'EDUCATION' as const,
  consentToken: null,
  locale: 'en-US',
  deviceClass: 'web' as const,
};

function makeTask(payload: unknown, intent: Intent = Intent.ReadAbout): Task<LibraryInput> {
  return {
    taskId: 'lib-task',
    parentTaskId: null,
    intent,
    priority: 4,
    deadlineMs: 5000,
    payload: payload as LibraryInput,
    context: baseContext,
    trace: [],
    createdAt: Date.now(),
  };
}

const tinyCorpus: LibraryDocument[] = [
  {
    id: 't-1',
    text: 'The heart pumps blood through the cardiovascular system.',
    source: 'TestRef A',
    tags: ['heart', 'cardiology'],
  },
  {
    id: 't-2',
    text: 'The brain controls cognition, motor function, and homeostasis.',
    source: 'TestRef B',
    tags: ['brain', 'neurology'],
  },
  {
    id: 't-3',
    text: 'Aspirin inhibits cyclooxygenase enzymes and reduces inflammation.',
    source: 'TestRef C',
    tags: ['pharmacology', 'aspirin'],
  },
];

describe('Bm25Retriever', () => {
  test('returns highest-scoring document for an unambiguous keyword', async () => {
    const r = new Bm25Retriever(tinyCorpus);
    const result = await r.search('heart', 3);
    expect(result.citations.length).toBeGreaterThan(0);
    expect(result.citations[0]?.document.id).toBe('t-1');
    expect(result.citations[0]?.matchedTerms).toContain('heart');
  });

  test('returns empty citations when no terms match', async () => {
    const r = new Bm25Retriever(tinyCorpus);
    const result = await r.search('xyzunknownword', 3);
    expect(result.citations).toEqual([]);
  });

  test('respects topK', async () => {
    const r = new Bm25Retriever(tinyCorpus);
    const result = await r.search('heart brain aspirin', 2);
    expect(result.citations.length).toBeLessThanOrEqual(2);
  });

  test('handles empty corpus gracefully', async () => {
    const r = new Bm25Retriever([]);
    const result = await r.search('anything', 5);
    expect(result.citations).toEqual([]);
  });
});

describe('LibraryAgent', () => {
  test('canHandle accepts ReadAbout, rejects unrelated', () => {
    const agent = new LibraryAgent(new Bm25Retriever(tinyCorpus));
    expect(agent.canHandle(makeTask({ text: 'x' }))).toBe(true);
    expect(agent.canHandle(makeTask({ text: 'x' }, Intent.Symptom))).toBe(false);
  });

  test('happy path on seed corpus — returns ranked citations with verdict pass', async () => {
    const agent = createSeedLibraryAgent();
    const tokens: string[] = [];
    const emit = (e: OrchestratorEvent) => {
      if (e.type === 'agent.token') tokens.push(e.token);
    };
    const result = await agent.run(makeTask({ text: 'tell me about ischemic stroke' }), emit);

    expect(result.verdict).toBe('pass');
    expect(result.confidence).toBeGreaterThan(0.3);
    expect(result.data.citations.length).toBeGreaterThan(0);
    expect(result.data.citations[0]?.source).toContain('I63');
    expect(result.data.retrieverUsed).toBe('bm25-in-memory');
    expect(tokens.length).toBeGreaterThanOrEqual(2);
  });

  test('failure path — query with no matches yields defer-to-human + warning', async () => {
    const agent = new LibraryAgent(new Bm25Retriever(tinyCorpus));
    const result = await agent.run(makeTask({ text: 'gobbledygook nonexistentword' }), () => {});
    expect(result.verdict).toBe('defer-to-human');
    expect(result.data.citations).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  test('retriever can be swapped — Library is agnostic to V0/V1 backend', async () => {
    const fakeRetriever: Retriever = {
      name: 'fake-stub',
      async search(query, _k) {
        return {
          query,
          citations: [
            {
              document: {
                id: 'fake-1',
                text: 'fake passage',
                source: 'FakeRef',
              },
              score: 9.99,
              matchedTerms: ['mock'],
            },
          ],
        };
      },
    };
    const agent = new LibraryAgent(fakeRetriever);
    const result = await agent.run(makeTask({ text: 'anything' }), () => {});
    expect(result.data.retrieverUsed).toBe('fake-stub');
    expect(result.data.citations[0]?.source).toBe('FakeRef');
  });
});

describe('SEED_CORPUS sanity', () => {
  test('every document has id, text, source', () => {
    for (const doc of SEED_CORPUS) {
      expect(doc.id.length).toBeGreaterThan(0);
      expect(doc.text.length).toBeGreaterThan(40);
      expect(doc.source.length).toBeGreaterThan(0);
    }
  });

  test('coverage spans cardio, neuro, allergy, endocrine domains', () => {
    const tags = new Set(SEED_CORPUS.flatMap((d) => d.tags ?? []));
    expect(tags.has('cardiology')).toBe(true);
    expect(tags.has('neurology')).toBe(true);
    expect(tags.has('allergy')).toBe(true);
    expect(tags.has('endocrinology')).toBe(true);
  });
});
