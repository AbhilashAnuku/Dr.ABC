import { describe, expect, it } from 'bun:test';
import { cosine, embed, recallToPromptContext, tokenise } from './morbius-memory.ts';

describe('tokenise', () => {
  it('drops stopwords + non-alpha + tokens of length ≤ 2', () => {
    expect(tokenise('I have a sharp pain in my chest')).toEqual(['sharp', 'pain', 'chest']);
  });

  it('lowercases + handles punctuation', () => {
    expect(tokenise('Crushing CHEST pain — radiating to LEFT arm.')).toEqual([
      'crushing',
      'chest',
      'pain',
      'radiating',
      'left',
      'arm',
    ]);
  });

  it('returns empty for empty input', () => {
    expect(tokenise('')).toEqual([]);
    expect(tokenise('   ')).toEqual([]);
  });
});

describe('embed', () => {
  it('returns an L2-normalised TF vector', () => {
    const v = embed('chest pain chest');
    // Two unique tokens after stopword filter: chest (count 2), pain (count 1)
    // L2 norm = sqrt(4 + 1) = sqrt(5)
    const norm = Math.sqrt((v.chest ?? 0) ** 2 + (v.pain ?? 0) ** 2);
    expect(norm).toBeCloseTo(1, 5);
  });

  it('returns {} for empty / stopword-only input', () => {
    expect(embed('')).toEqual({});
    expect(embed('the and of to')).toEqual({});
  });
});

describe('cosine', () => {
  it('is 1.0 for identical normalised vectors', () => {
    const a = embed('crushing chest pain radiating');
    expect(cosine(a, a)).toBeCloseTo(1, 5);
  });

  it('is high for very similar texts', () => {
    const a = embed('crushing chest pain radiating to left arm');
    const b = embed('crushing chest pain in left arm');
    expect(cosine(a, b)).toBeGreaterThan(0.7);
  });

  it('is low for unrelated texts', () => {
    const a = embed('crushing chest pain');
    const b = embed('itchy skin rash dermatitis');
    expect(cosine(a, b)).toBeLessThan(0.1);
  });

  it('is 0 when no shared tokens', () => {
    expect(cosine(embed('alpha beta gamma'), embed('delta epsilon zeta'))).toBe(0);
  });
});

describe('recallToPromptContext', () => {
  it('returns empty string when no hits', () => {
    expect(recallToPromptContext([])).toBe('');
  });

  it('renders each hit on its own line with chief complaint + diagnosis + drugs', () => {
    const ctx = recallToPromptContext([
      {
        score: 0.7,
        entry: {
          id: 'm1',
          userId: 'u1',
          ts: Date.now() - 86_400_000 * 3,
          chiefComplaint: 'crushing chest pain',
          diagnosis: 'STEMI',
          drugs: ['Aspirin', 'Atorvastatin'],
          source: 'consult',
          embedding: {},
        },
      },
    ]);
    expect(ctx).toContain('Memory recall');
    expect(ctx).toContain('crushing chest pain');
    expect(ctx).toContain('STEMI');
    expect(ctx).toContain('Aspirin');
    expect(ctx).toContain('d ago');
  });
});
