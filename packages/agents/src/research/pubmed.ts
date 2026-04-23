import type { Evidence } from '@dr-abc/types';

/**
 * NCBI PubMed fetcher — uses the free E-utilities API. No key required;
 * NCBI asks for ≤ 3 requests per second without a key, ≤ 10 with one.
 *
 *   esearch.fcgi  →  PMID list for a query
 *   esummary.fcgi →  title, journal, authors, year per PMID
 *
 * We avoid efetch (full XML) for speed; abstracts can be fetched on demand
 * by the synth agent if a citation is selected.
 */

const ESEARCH = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi';
const ESUMMARY = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi';
const TOOL = 'dr-abc-morbius';
const EMAIL = 'abhilashanuku14@gmail.com';
const TIMEOUT_MS = 8_000;

interface ESearchResult {
  esearchresult?: {
    idlist?: string[];
    count?: string;
    retmax?: string;
  };
}

interface ESummaryAuthor {
  name?: string;
  authtype?: string;
}

interface ESummaryRecord {
  uid?: string;
  title?: string;
  fulljournalname?: string;
  source?: string;
  pubdate?: string;
  authors?: ESummaryAuthor[];
  elocationid?: string;
  articleids?: { idtype?: string; value?: string }[];
}

interface ESummaryResult {
  result?: Record<string, ESummaryRecord | string[]>;
}

export async function searchPubmed(query: string, limit = 10): Promise<Evidence[]> {
  // Bound the query — extremely long inputs blow up E-utilities.
  const term = query.slice(0, 500);

  const idsRes = await fetch(
    `${ESEARCH}?db=pubmed&retmode=json&retmax=${limit}&sort=relevance&tool=${TOOL}&email=${EMAIL}&term=${encodeURIComponent(term)}`,
    { signal: AbortSignal.timeout(TIMEOUT_MS) },
  );
  if (!idsRes.ok) throw new Error(`PubMed esearch ${idsRes.status}`);
  const idsJson = (await idsRes.json()) as ESearchResult;
  const ids = idsJson.esearchresult?.idlist ?? [];
  if (ids.length === 0) return [];

  const sumRes = await fetch(
    `${ESUMMARY}?db=pubmed&retmode=json&tool=${TOOL}&email=${EMAIL}&id=${ids.join(',')}`,
    { signal: AbortSignal.timeout(TIMEOUT_MS) },
  );
  if (!sumRes.ok) throw new Error(`PubMed esummary ${sumRes.status}`);
  const sumJson = (await sumRes.json()) as ESummaryResult;
  const result = sumJson.result ?? {};

  return ids.map((pmid) => recordToEvidence(pmid, result[pmid] as ESummaryRecord | undefined));
}

function recordToEvidence(pmid: string, rec: ESummaryRecord | undefined): Evidence {
  const title = rec?.title?.replace(/<\/?[^>]+>/g, '').trim() || `PubMed record ${pmid}`;
  const journal = rec?.fulljournalname || rec?.source || '';
  const year = parseYear(rec?.pubdate);
  const authors = (rec?.authors ?? [])
    .map((a) => a.name)
    .filter((n): n is string => typeof n === 'string')
    .slice(0, 3);
  const doi =
    (rec?.articleids ?? []).find((a) => a.idtype === 'doi')?.value || rec?.elocationid || '';

  const summary = [
    authors.length ? `${authors.join(', ')}${authors.length === 3 ? ' et al.' : ''}` : null,
    journal ? journal : null,
    year ? String(year) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return {
    id: `pubmed:${pmid}`,
    source: 'pubmed',
    title,
    summary,
    url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
    year,
    meta: { pmid, journal, doi },
  };
}

export function parseYear(pubdate: string | undefined): number | undefined {
  if (!pubdate) return undefined;
  const match = pubdate.match(/(19|20)\d{2}/);
  return match ? Number.parseInt(match[0], 10) : undefined;
}
