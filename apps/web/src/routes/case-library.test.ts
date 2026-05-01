import { describe, expect, it } from 'bun:test';
import { specialtyTone } from '../components/case-library/case-card.tsx';
import { SEED_CASES } from '../lib/case-seed.ts';
import { __test } from './case-library.tsx';

const { uniqueSpecialties, filterCases } = __test;

describe('case-library helpers', () => {
  describe('uniqueSpecialties', () => {
    it('returns one entry per distinct specialty, sorted', () => {
      const out = uniqueSpecialties(SEED_CASES);
      expect(out.length).toBeGreaterThan(0);
      expect(out).toEqual([...out].sort());
      const set = new Set(out);
      expect(set.size).toBe(out.length);
    });

    it('every specialty in the seed shows up', () => {
      const seen = new Set(SEED_CASES.map((c) => c.specialty));
      const out = new Set(uniqueSpecialties(SEED_CASES));
      for (const s of seen) {
        expect(out.has(s)).toBe(true);
      }
    });
  });

  describe('filterCases', () => {
    it('returns the full set when query + specialty are empty', () => {
      expect(filterCases(SEED_CASES, '', null).length).toBe(SEED_CASES.length);
      expect(filterCases(SEED_CASES, '   ', null).length).toBe(SEED_CASES.length);
    });

    it('filters by specialty', () => {
      const out = filterCases(SEED_CASES, '', 'Cardiology');
      expect(out.length).toBeGreaterThan(0);
      for (const c of out) expect(c.specialty).toBe('Cardiology');
    });

    it('matches by ICD-10 prefix', () => {
      const out = filterCases(SEED_CASES, 'I21', null);
      expect(out.some((c) => c.icd10.startsWith('I21'))).toBe(true);
    });

    it('matches by diagnosis text (case-insensitive)', () => {
      expect(filterCases(SEED_CASES, 'Migraine', null).length).toBeGreaterThan(0);
      expect(filterCases(SEED_CASES, 'migraine', null).length).toBeGreaterThan(0);
    });

    it('matches by case ID', () => {
      const out = filterCases(SEED_CASES, 'C001', null);
      expect(out.length).toBe(1);
      expect(out[0]?.id).toBe('C001');
    });

    it('matches by drug name', () => {
      const out = filterCases(SEED_CASES, 'Metformin', null);
      expect(out.some((c) => c.drugs.includes('Metformin'))).toBe(true);
    });

    it('matches by chief-complaint substring', () => {
      const out = filterCases(SEED_CASES, 'photophobia', null);
      expect(out.length).toBeGreaterThan(0);
      for (const c of out) expect(c.chiefComplaint.toLowerCase()).toContain('photophobia');
    });

    it('combines query + specialty (AND)', () => {
      const out = filterCases(SEED_CASES, 'pain', 'Cardiology');
      for (const c of out) {
        expect(c.specialty).toBe('Cardiology');
        expect(
          c.chiefComplaint.toLowerCase().includes('pain') ||
            c.diagnosis.toLowerCase().includes('pain'),
        ).toBe(true);
      }
    });

    it('returns empty when nothing matches', () => {
      expect(filterCases(SEED_CASES, 'mörbiusxin-zzz', null)).toEqual([]);
    });
  });
});

describe('specialtyTone', () => {
  it('maps every seed specialty to a non-empty tone', () => {
    for (const c of SEED_CASES) {
      const t = specialtyTone(c.specialty);
      expect(t.ring.length).toBeGreaterThan(0);
      expect(t.chip.length).toBeGreaterThan(0);
    }
  });
  it('falls back to internal tone on unknown', () => {
    const t = specialtyTone('quantum-radiology-zzz');
    expect(t.ring.length).toBeGreaterThan(0);
  });
});
