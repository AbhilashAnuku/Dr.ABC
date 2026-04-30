import { describe, expect, it } from 'bun:test';
import type { MemoryEntry } from './morbius-memory.ts';
import {
  buildCorpusFromEntries,
  inferEsi,
  isCacheFresh,
  normaliseSpecialty,
  stratify,
} from './training-corpus.ts';

const makeEntry = (id: string, overrides: Partial<MemoryEntry> = {}): MemoryEntry => ({
  id,
  userId: 'u1',
  ts: Number(id.replace(/[^\d]/g, '')) || Date.now(),
  chiefComplaint: 'fever for 2 days',
  diagnosis: 'Viral URI',
  icd10: 'J06.9',
  specialty: 'internal medicine',
  drugs: ['Acetaminophen'],
  outcome: 'resolved',
  source: 'consult',
  embedding: {},
  ...overrides,
});

describe('inferEsi', () => {
  it('maps STEMI / cardiac arrest cues to ESI 1', () => {
    expect(inferEsi('STEMI · anterior wall')).toBe(1);
    expect(inferEsi('cardiac arrest')).toBe(1);
  });

  it('maps crushing chest pain / appendicitis / a-fib cues to ESI 2', () => {
    expect(inferEsi('crushing chest pain radiating to left arm')).toBe(2);
    expect(inferEsi('RLQ pain consistent with appendicitis')).toBe(2);
    expect(inferEsi('palpitations · atrial fibrillation new-onset')).toBe(2);
  });

  it('maps fever / migraine to ESI 3', () => {
    expect(inferEsi('migraine without aura')).toBe(3);
    expect(inferEsi('fever 38.6 with cough')).toBe(3);
  });

  it('maps routine-acuity cues to ESI 4', () => {
    expect(inferEsi('sore throat for 2 days')).toBe(4);
    expect(inferEsi('itchy rash on forearm')).toBe(4);
  });

  it('falls through to ESI 5 for asymptomatic / screening visits', () => {
    expect(inferEsi('routine annual physical')).toBe(5);
  });
});

describe('normaliseSpecialty', () => {
  it('collapses casing + plural variants', () => {
    expect(normaliseSpecialty('Cardiology')).toBe('cardiology');
    expect(normaliseSpecialty('CARDIO')).toBe('cardiology');
    expect(normaliseSpecialty('Pulmonology')).toBe('pulmonology');
    expect(normaliseSpecialty('Pulmo')).toBe('pulmonology');
    expect(normaliseSpecialty('Pediatrics')).toBe('pediatrics');
    expect(normaliseSpecialty('Internal medicine')).toBe('internal-medicine');
  });

  it('returns "general" for empty / nullish', () => {
    expect(normaliseSpecialty(null)).toBe('general');
    expect(normaliseSpecialty(undefined)).toBe('general');
    expect(normaliseSpecialty('')).toBe('general');
  });
});

describe('stratify', () => {
  it('caps each (specialty, esiBucket) bucket at perBucketCap', () => {
    const exemplars = Array.from({ length: 20 }, (_, i) => ({
      id: `ex_${i}`,
      input: 'crushing chest pain',
      groundTruth: 'STEMI',
      icd10: 'I21',
      specialty: 'cardiology',
      esiBucket: 1 as const,
      drugs: [],
      ts: 1_700_000_000_000 + i * 1000,
    }));
    const out = stratify(exemplars, { perBucketCap: 4 });
    expect(out.length).toBe(4);
    // newest-first within the bucket
    expect(out[0]?.ts).toBeGreaterThan(out[3]?.ts ?? 0);
  });

  it('respects the global totalCap', () => {
    const exemplars = Array.from({ length: 50 }, (_, i) => ({
      id: `ex_${i}`,
      input: 'sore throat',
      groundTruth: 'pharyngitis',
      icd10: 'J02',
      specialty: i % 2 === 0 ? 'pediatrics' : 'internal-medicine',
      esiBucket: 4 as const,
      drugs: [],
      ts: 1_700_000_000_000 + i * 1000,
    }));
    const out = stratify(exemplars, { perBucketCap: 100, totalCap: 6 });
    expect(out.length).toBe(6);
  });
});

describe('buildCorpusFromEntries', () => {
  it('drops memory entries that have no diagnosis', () => {
    const entries: MemoryEntry[] = [
      makeEntry('100', { diagnosis: 'STEMI', specialty: 'cardiology' }),
      makeEntry('101', { diagnosis: undefined }),
    ];
    const corpus = buildCorpusFromEntries(entries);
    expect(corpus.exemplars.length).toBe(1);
    expect(corpus.stats.sourceMemorySize).toBe(2);
  });

  it('produces stats with per-specialty + per-ESI breakdown', () => {
    const entries: MemoryEntry[] = [
      makeEntry('100', {
        diagnosis: 'STEMI',
        specialty: 'cardiology',
        chiefComplaint: 'crushing chest pain radiating to left arm',
      }),
      makeEntry('101', {
        diagnosis: 'Migraine',
        specialty: 'neurology',
        chiefComplaint: 'severe headache for 6 hours',
      }),
      makeEntry('102', {
        diagnosis: 'Strep pharyngitis',
        specialty: 'pediatrics',
        chiefComplaint: 'sore throat for 2 days',
      }),
    ];
    const corpus = buildCorpusFromEntries(entries);
    expect(corpus.stats.totalExemplars).toBe(3);
    expect(corpus.stats.perSpecialty.cardiology).toBe(1);
    expect(corpus.stats.perSpecialty.neurology).toBe(1);
    expect(corpus.stats.perSpecialty.pediatrics).toBe(1);
    expect(corpus.stats.perEsiBucket[2]).toBe(1); // crushing chest pain
    expect(corpus.stats.perEsiBucket[3]).toBe(1); // severe headache
    expect(corpus.stats.perEsiBucket[4]).toBe(1); // sore throat
  });

  it('is deterministic over the same input + opts', () => {
    const entries = Array.from({ length: 30 }, (_, i) =>
      makeEntry(`${i + 100}`, {
        diagnosis: i % 2 === 0 ? 'Migraine' : 'STEMI',
        specialty: i % 2 === 0 ? 'neurology' : 'cardiology',
        chiefComplaint: i % 2 === 0 ? 'severe headache' : 'crushing chest pain',
      }),
    );
    const a = buildCorpusFromEntries(entries, { perBucketCap: 3 });
    const b = buildCorpusFromEntries(entries, { perBucketCap: 3 });
    expect(a.exemplars.map((e) => e.id)).toEqual(b.exemplars.map((e) => e.id));
  });
});

describe('isCacheFresh', () => {
  it('returns false for null cache', () => {
    expect(isCacheFresh(null, 10)).toBe(false);
  });

  it('returns true when memory has grown by < 5 entries', () => {
    const cached = {
      exemplars: [],
      stats: {
        totalExemplars: 0,
        perSpecialty: {},
        perEsiBucket: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as const,
        sourceMemorySize: 20,
        builtAt: '',
      },
    };
    expect(isCacheFresh(cached, 22)).toBe(true);
    expect(isCacheFresh(cached, 23)).toBe(true);
    expect(isCacheFresh(cached, 24)).toBe(true);
    expect(isCacheFresh(cached, 25)).toBe(false);
  });
});
