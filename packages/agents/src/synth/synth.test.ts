import { describe, expect, test } from 'bun:test';
import type { Evidence } from '@dr-abc/types';
import {
  checkCitedClaims,
  citedEvidence,
  isClinicalClaim,
  parseCitations,
} from './parse-citations.ts';

const mkEv = (id: string, title = 'Trial X'): Evidence => ({
  id,
  source: 'pubmed',
  title,
  summary: '',
  url: `https://example.com/${id}`,
});

describe('synth/parseCitations', () => {
  test('extracts simple [n] markers', () => {
    const claims = parseCitations(
      'SGLT2 inhibitors reduce HF hospitalisation [1]. Gliflozins also slow CKD progression [2].',
    );
    expect(claims.length).toBe(2);
    expect(claims[0]?.citations).toEqual([1]);
    expect(claims[1]?.citations).toEqual([2]);
  });

  test('handles [1, 2] grouped citations', () => {
    const claims = parseCitations('Beta-blockers improve survival [1, 2, 4].');
    expect(claims[0]?.citations).toEqual([1, 2, 4]);
  });

  test('handles [1][2] adjacent citations', () => {
    const claims = parseCitations('Statins reduce mortality [1][2].');
    expect(claims[0]?.citations).toEqual([1, 2]);
  });

  test('dedupes repeated citations within one sentence', () => {
    const claims = parseCitations('A [3] thing [3] said [3].');
    expect(claims[0]?.citations).toEqual([3]);
  });

  test('keeps the sentence text intact (markers preserved)', () => {
    const claims = parseCitations('Aspirin 75 mg daily reduces secondary MI [1].');
    expect(claims[0]?.text).toContain('[1]');
  });

  test('splits on sentence boundaries, ignoring abbreviations', () => {
    const claims = parseCitations(
      'Dr. Smith found X [1]. Patients e.g. those over 65 benefit [2].',
    );
    expect(claims.length).toBe(2);
  });

  test('empty input returns empty array', () => {
    expect(parseCitations('')).toEqual([]);
  });
});

describe('synth/citedEvidence', () => {
  const ev = [mkEv('a'), mkEv('b'), mkEv('c'), mkEv('d')];

  test('returns only the referenced subset, in citation order', () => {
    const claims = parseCitations('First claim [3]. Second claim [1, 4].');
    const cited = citedEvidence(ev, claims);
    expect(cited.map((e) => e.id)).toEqual(['a', 'c', 'd']);
  });

  test('drops citations that are out of bounds', () => {
    const claims = parseCitations('Claim [99].');
    expect(citedEvidence(ev, claims)).toEqual([]);
  });
});

describe('synth/isClinicalClaim', () => {
  test('flags drug-dose sentences', () => {
    expect(isClinicalClaim('Aspirin 75 mg daily reduces secondary MI risk.')).toBe(true);
  });

  test('flags recommendation language', () => {
    expect(isClinicalClaim('First-line therapy is metformin.')).toBe(true);
  });

  test('flags statistical claims', () => {
    expect(isClinicalClaim('p < 0.001 in the treatment arm.')).toBe(true);
  });

  test('does NOT flag a generic background sentence', () => {
    expect(isClinicalClaim('The condition affects many people worldwide.')).toBe(false);
  });
});

describe('synth/checkCitedClaims', () => {
  test('passes when every clinical claim has a citation', () => {
    const claims = parseCitations(
      'SGLT2 inhibitors reduce HF hospitalisation [1]. Many people are affected.',
    );
    const check = checkCitedClaims(claims);
    expect(check.passed).toBe(true);
  });

  test('fails when a clinical claim lacks a citation', () => {
    const claims = parseCitations(
      'SGLT2 inhibitors reduce HF hospitalisation. Background context here.',
    );
    const check = checkCitedClaims(claims);
    expect(check.passed).toBe(false);
    expect(check.uncitedClaims.length).toBe(1);
  });

  test('does not penalise non-clinical sentences for missing citations', () => {
    const claims = parseCitations(
      'The disease is common. Patients vary in presentation. Statins reduce mortality [1].',
    );
    const check = checkCitedClaims(claims);
    expect(check.passed).toBe(true);
  });
});
