import { describe, expect, test } from 'bun:test';
import type { Evidence } from '@dr-abc/types';
import { dedupe, rank } from './index.ts';
import { parseYear } from './pubmed.ts';
import { FACT_SHEETS, searchWho } from './who.ts';

describe('research/pubmed: parseYear', () => {
  test('extracts the first 4-digit year', () => {
    expect(parseYear('2024 Mar 15')).toBe(2024);
    expect(parseYear('2019')).toBe(2019);
    expect(parseYear('Apr 1998')).toBe(1998);
  });

  test('returns undefined for missing or malformed', () => {
    expect(parseYear(undefined)).toBeUndefined();
    expect(parseYear('')).toBeUndefined();
    expect(parseYear('Spring')).toBeUndefined();
  });
});

describe('research: dedupe', () => {
  test('keeps the first occurrence of each id', () => {
    const a: Evidence = mkEvidence('pubmed:1', 2024);
    const b: Evidence = mkEvidence('pubmed:1', 2020);
    const c: Evidence = mkEvidence('pubmed:2', 2023);
    const out = dedupe([a, b, c]);
    expect(out.length).toBe(2);
    expect(out[0]?.year).toBe(2024);
  });

  test('empty input is empty output', () => {
    expect(dedupe([])).toEqual([]);
  });
});

describe('research: rank', () => {
  test('ranks recent + on-topic + authoritative ahead of stale', () => {
    const recent2024Pubmed: Evidence = {
      ...mkEvidence('pubmed:a', 2024),
      title: 'SGLT2 inhibitors in heart failure',
      summary: 'A meta-analysis of dapagliflozin and empagliflozin trials.',
    };
    const old2005Trial: Evidence = {
      ...mkEvidence('ctgov:b', 2005),
      source: 'clinicaltrials',
      title: 'Glucose lowering registry',
      summary: 'Old multicentre study.',
    };
    const ranked = rank([old2005Trial, recent2024Pubmed], 'SGLT2 heart failure');
    expect(ranked[0]?.id).toBe('pubmed:a');
    expect(ranked[0]?.relevance).toBeGreaterThan(ranked[1]?.relevance ?? 0);
  });

  test('attaches a relevance score to every result', () => {
    const r = rank([mkEvidence('pubmed:x', 2020)], 'asthma');
    expect(typeof r[0]?.relevance).toBe('number');
  });

  test('handles empty query — still sorts by source × recency', () => {
    const r = rank([mkEvidence('pubmed:p', 2024), mkEvidence('ctgov:c', 2024)], '');
    // both have same recency + overlap=0 → source weight breaks tie
    expect(r[0]?.source).toBe('pubmed');
  });
});

describe('research/who: searchWho', () => {
  test('matches by title', async () => {
    const r = await searchWho('asthma');
    expect(r[0]?.title).toContain('Asthma');
    expect(r[0]?.url).toContain('news-room/fact-sheets/detail/asthma');
  });

  test('matches by alias', async () => {
    const r = await searchWho('high blood pressure');
    expect(r[0]?.title).toContain('Hypertension');
  });

  test('returns empty array when nothing matches', async () => {
    const r = await searchWho('a-completely-unknown-topic-xyzzy');
    expect(r).toEqual([]);
  });

  test('every fact sheet has a non-empty summary + url', () => {
    for (const f of FACT_SHEETS) {
      expect(f.summary.length).toBeGreaterThan(20);
      expect(f.slug).toBeTruthy();
      expect(f.title).toBeTruthy();
    }
  });
});

function mkEvidence(id: string, year: number): Evidence {
  return {
    id,
    source: 'pubmed',
    title: 'placeholder',
    summary: 'placeholder summary',
    url: `https://example.com/${id}`,
    year,
  };
}
