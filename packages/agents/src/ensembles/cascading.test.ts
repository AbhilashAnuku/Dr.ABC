import { describe, expect, test } from 'bun:test';
import type { DiagnosticInput, Differential } from '@dr-abc/types';
import type { DiagnosticEnsemble } from '../diagnostic.ts';
import { CascadingEnsemble } from './cascading.ts';

const sampleInput: DiagnosticInput = { text: 'crushing chest pain' };

const fakeOk = (n: string, diffs: Differential[]): DiagnosticEnsemble => ({
  name: n,
  vote: async () => ({
    differentials: diffs,
    recommendedTests: ['ECG'],
    recommendedSpecialty: 'cardiology',
    rawConfidence: diffs[0]?.probability ?? 0,
  }),
});

const fakeErr = (n: string, msg: string): DiagnosticEnsemble => ({
  name: n,
  vote: async () => {
    throw new Error(msg);
  },
});

const fakeSlow = (n: string, ms: number): DiagnosticEnsemble => ({
  name: n,
  vote: async () => {
    await new Promise((r) => setTimeout(r, ms));
    return {
      differentials: [
        {
          condition: 'Late MI',
          probability: 0.7,
          icd10: 'I21.9',
          supportingEvidence: ['took too long'],
          counterEvidence: [],
        },
      ],
      recommendedTests: [],
      recommendedSpecialty: 'cardiology',
      rawConfidence: 0.7,
    };
  },
});

const validDiff: Differential[] = [
  {
    condition: 'Acute MI',
    probability: 0.87,
    icd10: 'I21.9',
    supportingEvidence: ['classic STEMI'],
    counterEvidence: [],
  },
];

describe('CascadingEnsemble', () => {
  test('returns first child when it succeeds', async () => {
    const cascade = new CascadingEnsemble({
      children: [fakeOk('a', validDiff), fakeOk('b', validDiff)],
    });
    const r = await cascade.vote(sampleInput);
    expect(r.differentials[0]?.condition).toBe('Acute MI');
  });

  test('falls through on first child throwing', async () => {
    const attempts: Array<{ name: string; status: string; reason?: string }> = [];
    const cascade = new CascadingEnsemble({
      children: [fakeErr('a', 'boom'), fakeOk('b', validDiff)],
      onAttempt: (e) => attempts.push(e),
    });
    const r = await cascade.vote(sampleInput);
    expect(r.differentials[0]?.condition).toBe('Acute MI');
    expect(attempts).toHaveLength(2);
    expect(attempts[0]?.status).toBe('err');
    expect(attempts[0]?.reason).toContain('boom');
    expect(attempts[1]?.status).toBe('ok');
  });

  test('falls through on first child returning empty differentials', async () => {
    const cascade = new CascadingEnsemble({
      children: [fakeOk('a', []), fakeOk('b', validDiff)],
    });
    const r = await cascade.vote(sampleInput);
    expect(r.differentials[0]?.condition).toBe('Acute MI');
  });

  test('falls through on timeout', async () => {
    const cascade = new CascadingEnsemble({
      children: [fakeSlow('slow', 5000), fakeOk('fast', validDiff)],
      perChildTimeoutMs: 100,
    });
    const r = await cascade.vote(sampleInput);
    expect(r.differentials[0]?.condition).toBe('Acute MI');
  });

  test('returns empty when every child fails', async () => {
    const cascade = new CascadingEnsemble({
      children: [fakeErr('a', 'down'), fakeErr('b', 'down'), fakeErr('c', 'down')],
    });
    const r = await cascade.vote(sampleInput);
    expect(r.differentials).toHaveLength(0);
    expect(r.recommendedSpecialty).toBe('unknown');
    expect(r.rawConfidence).toBe(0);
  });

  test('name reflects the priority chain', () => {
    const cascade = new CascadingEnsemble({
      children: [fakeOk('ollama', validDiff), fakeOk('nvidia', validDiff)],
    });
    expect(cascade.name).toBe('cascade(ollama→nvidia)');
  });

  test('throws on empty children array', () => {
    expect(() => new CascadingEnsemble({ children: [] })).toThrow();
  });
});
