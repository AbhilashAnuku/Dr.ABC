import { describe, expect, it } from 'bun:test';
import { SPECIALTY_PROMPTS } from './specialists/prompts.ts';
import {
  MAX_PROPOSED_PREFIX_CHARS,
  type TuneProposal,
  type TunerExemplar,
  deterministicRefine,
  isValidProposal,
  pickWorstExemplars,
  proposeNewPrefix,
  renderMetaPrompt,
} from './tuner.ts';

const failure = (id: string, overrides: Partial<TunerExemplar> = {}): TunerExemplar => ({
  id,
  input: 'Crushing chest pain radiating to left arm',
  groundTruth: 'STEMI',
  icd10: 'I21',
  modelOutput: 'unstable angina',
  wasCorrect: false,
  ...overrides,
});

const unlabelled = (id: string, overrides: Partial<TunerExemplar> = {}): TunerExemplar => ({
  id,
  input: 'severe headache for 6 hours',
  groundTruth: 'Migraine',
  icd10: 'G43',
  ...overrides,
});

describe('pickWorstExemplars', () => {
  it('returns failures first, then unlabelled', () => {
    const ex = [unlabelled('u1'), failure('f1'), unlabelled('u2'), failure('f2')];
    const out = pickWorstExemplars(ex, 3);
    expect(out.length).toBe(3);
    expect(out[0]?.id).toBe('f1');
    expect(out[1]?.id).toBe('f2');
    expect(out[2]?.id).toBe('u1');
  });

  it('caps at k', () => {
    const ex = Array.from({ length: 10 }, (_, i) => failure(`f${i}`));
    expect(pickWorstExemplars(ex, 4).length).toBe(4);
  });

  it('returns the failures even when k > supply', () => {
    const ex = [failure('f1'), failure('f2')];
    const out = pickWorstExemplars(ex, 5);
    expect(out.length).toBe(2);
  });
});

describe('renderMetaPrompt', () => {
  it('mentions specialty + current prefix + every exemplar', () => {
    const meta = renderMetaPrompt('cardiology', SPECIALTY_PROMPTS.cardiology, [
      failure('f1', { icd10: 'I21' }),
      failure('f2', { groundTruth: 'NSTEMI', icd10: 'I21' }),
    ]);
    expect(meta).toContain('cardiology');
    expect(meta).toContain('CURRENT PREFIX');
    expect(meta).toContain('I21');
    expect(meta).toContain('STEMI');
    expect(meta).toContain('NSTEMI');
  });

  it('caps the input excerpt to 140 chars per exemplar', () => {
    const huge = 'a'.repeat(500);
    const meta = renderMetaPrompt('neurology', SPECIALTY_PROMPTS.neurology, [
      failure('f1', { input: huge }),
    ]);
    // The 140-char excerpt should be present; the full 500-char
    // string should not.
    expect(meta).toContain('a'.repeat(140));
    expect(meta).not.toContain('a'.repeat(160));
  });
});

describe('deterministicRefine', () => {
  it('appends a Watch-for line when the exemplars introduce a new diagnosis', () => {
    const result = deterministicRefine('cardiology', SPECIALTY_PROMPTS.cardiology, [
      failure('f1', { groundTruth: 'Brugada syndrome', icd10: 'I49' }),
    ]);
    expect(result.proposedPrefix).toContain('brugada');
    expect(result.proposedPrefix.length).toBeLessThanOrEqual(MAX_PROPOSED_PREFIX_CHARS);
    expect(result.rationale.length).toBeGreaterThan(0);
  });

  it('emits a no-op rationale when nothing new is learnable', () => {
    // A bespoke prefix that already names both the diagnosis (STEMI)
    // and the ICD code (I21) — the deterministic refiner has no
    // novel anchor to add and should report no-op.
    const richPrefix =
      'You are a cardiology specialist. Watch for STEMI / NSTEMI (I21) · aortic dissection · ESC guideline alignment.';
    const result = deterministicRefine('cardiology', richPrefix, [
      failure('f1', { groundTruth: 'STEMI', icd10: 'I21' }),
    ]);
    expect(result.proposedPrefix).toBe(richPrefix);
    expect(result.rationale.toLowerCase()).toContain('no actionable');
  });

  it('truncates at the prefix-char ceiling', () => {
    const huge = 'x'.repeat(MAX_PROPOSED_PREFIX_CHARS + 200);
    const result = deterministicRefine('neurology', huge, [
      failure('f1', { groundTruth: 'New thing', icd10: 'Z99' }),
    ]);
    expect(result.proposedPrefix.length).toBeLessThanOrEqual(MAX_PROPOSED_PREFIX_CHARS);
  });
});

describe('isValidProposal', () => {
  const base: TuneProposal = {
    specialty: 'cardiology',
    currentPrefix: 'old',
    proposedPrefix: 'You are a cardiology specialist. Look at I21 and adjacent codes.',
    exemplars: [],
    rationale: '',
    expectedAccuracyDelta: 0,
    proposedPrefixChars: 64,
    generatedAt: '',
  };

  it('accepts a well-formed proposal', () => {
    expect(isValidProposal(base)).toBe(true);
  });

  it('rejects empty proposals', () => {
    expect(isValidProposal({ ...base, proposedPrefix: '' })).toBe(false);
  });

  it('rejects proposals over the char ceiling', () => {
    expect(
      isValidProposal({
        ...base,
        proposedPrefix: `cardiology I21 ${'a'.repeat(MAX_PROPOSED_PREFIX_CHARS)}`,
      }),
    ).toBe(false);
  });

  it('rejects proposals that drop the specialty noun', () => {
    expect(
      isValidProposal({
        ...base,
        proposedPrefix: 'You are a doctor. Look at I21.',
      }),
    ).toBe(false);
  });

  it('rejects proposals that drop ICD-10 anchoring', () => {
    expect(
      isValidProposal({
        ...base,
        proposedPrefix: 'You are a cardiology specialist with no codes.',
      }),
    ).toBe(false);
  });
});

describe('proposeNewPrefix', () => {
  it('returns a valid proposal via the deterministic path when no LLM is configured', async () => {
    const proposal = await proposeNewPrefix('cardiology', SPECIALTY_PROMPTS.cardiology, [
      failure('f1', { groundTruth: 'Takotsubo cardiomyopathy', icd10: 'I51' }),
    ]);
    expect(proposal.specialty).toBe('cardiology');
    expect(proposal.currentPrefix).toBe(SPECIALTY_PROMPTS.cardiology);
    expect(proposal.proposedPrefix.length).toBeGreaterThan(0);
    expect(isValidProposal(proposal)).toBe(true);
    expect(proposal.expectedAccuracyDelta).toBeGreaterThanOrEqual(0);
    expect(proposal.exemplars.length).toBe(1);
  });

  it('uses the LLM refiner when present and the output is in-bounds', async () => {
    const proposal = await proposeNewPrefix(
      'cardiology',
      SPECIALTY_PROMPTS.cardiology,
      [failure('f1', { groundTruth: 'Takotsubo', icd10: 'I51' })],
      {
        llmRefiner: async () =>
          'You are a cardiology specialist. Watch for takotsubo (I51) and stress-induced cardiomyopathy.',
      },
    );
    expect(proposal.proposedPrefix).toContain('takotsubo');
    expect(proposal.rationale.toLowerCase()).toContain('llm');
  });

  it('falls back to deterministic when the LLM returns garbage', async () => {
    const proposal = await proposeNewPrefix(
      'cardiology',
      SPECIALTY_PROMPTS.cardiology,
      [failure('f1', { groundTruth: 'Takotsubo', icd10: 'I51' })],
      { llmRefiner: async () => '' },
    );
    expect(proposal.rationale.toLowerCase()).toContain('deterministic');
    expect(proposal.proposedPrefix).toContain('takotsubo');
  });

  it('falls back to deterministic when the LLM throws', async () => {
    const proposal = await proposeNewPrefix(
      'cardiology',
      SPECIALTY_PROMPTS.cardiology,
      [failure('f1', { groundTruth: 'Takotsubo', icd10: 'I51' })],
      {
        llmRefiner: async () => {
          throw new Error('network down');
        },
      },
    );
    expect(proposal.rationale.toLowerCase()).toContain('failed');
    expect(proposal.rationale.toLowerCase()).toContain('network down');
  });
});
