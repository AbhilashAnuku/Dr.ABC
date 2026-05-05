#!/usr/bin/env bun
/**
 * fetch-pubmed-cases — pull real anonymised case reports from PubMed
 * via NCBI E-utilities. Free, no API key required (we stay under the
 * 3-rps unauthenticated rate limit).
 *
 * What it produces:
 *   F:\huggingface-cache\datasets\dr-abc\pubmed-cases.jsonl
 *
 * Each line is one case report:
 *   { pmid, title, abstract, meshTerms[], journal, year, doi?, specialty? }
 *
 * Why PubMed Case Reports:
 *   - Already de-identified (published clinical literature, no PHI)
 *   - Open API (no key needed for low volume)
 *   - Real diagnostic puzzles (real records rather than a handful of
 *     synthetic placeholders)
 *   - Indexable by MeSH terms → maps cleanly to our specialty taxonomy
 *
 * Run:
 *   bun run scripts/fetch-pubmed-cases.ts                   # default 500
 *   bun run scripts/fetch-pubmed-cases.ts --limit 2000       # bigger pull
 *   bun run scripts/fetch-pubmed-cases.ts --query "diabetes" # specialty-specific
 *
 * NCBI politeness: 350 ms between requests (well under the 3-rps cap),
 * exponential backoff on 429/5xx, retry-after honored.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const CACHE_BASE = process.env.HF_HOME
  ? join(process.env.HF_HOME, 'datasets', 'dr-abc')
  : 'F:\\huggingface-cache\\datasets\\dr-abc';

const E_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const POLITE_MS = 350;

interface Args {
  limit: number;
  query: string;
  resume: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    limit: Number(get('--limit') ?? '500'),
    query: get('--query') ?? '',
    resume: argv.includes('--resume'),
  };
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithBackoff(url: string, attempt = 0): Promise<Response> {
  const r = await fetch(url, {
    headers: {
      'user-agent': 'Mörbius/0.7 (+https://github.com/AbhilashAnuku/Dr.ABC)',
    },
  });
  if (r.ok) return r;
  if ((r.status === 429 || r.status >= 500) && attempt < 5) {
    const retryAfter = Number(r.headers.get('retry-after') ?? '0');
    const wait = retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 1000;
    console.warn(`  ⚠ HTTP ${r.status}; backing off ${wait}ms (attempt ${attempt + 1})`);
    await sleep(wait);
    return fetchWithBackoff(url, attempt + 1);
  }
  throw new Error(`PubMed ${url} → ${r.status}`);
}

interface ESearchResult {
  esearchresult: { idlist: string[]; count: string };
}

interface EFetchAuthor {
  name?: string;
}

interface EFetchArticle {
  uid: string;
  title?: string;
  source?: string; // journal
  pubdate?: string;
  authors?: EFetchAuthor[];
  elocationid?: string; // DOI in 'doi: 10.x/...' shape
}

interface CaseRecord {
  pmid: string;
  title: string;
  abstract: string;
  meshTerms: string[];
  journal: string;
  year: number | null;
  doi: string | null;
  specialty: string | null;
}

const SPECIALTY_HINTS: Array<{ kw: RegExp; name: string }> = [
  { kw: /\b(myocard|cardio|coronary|heart|atrial|ventric|aort)\w*/i, name: 'Cardiology' },
  {
    kw: /\b(neuro|stroke|migraine|epilep|seizur|parkinson|alzheim|demyelin)\w*/i,
    name: 'Neurology',
  },
  { kw: /\b(diabet|thyroid|adrenal|pituitar|endocrine|insulin)\w*/i, name: 'Endocrinology' },
  {
    kw: /\b(carcinoma|leukemi|lymphoma|melanoma|cancer|tumor|sarcoma|metastas)\w*/i,
    name: 'Oncology',
  },
  { kw: /\b(asthma|copd|pneumon|tuberculos|pulmonary|bronch)\w*/i, name: 'Pulmonology' },
  { kw: /\b(derm|psoriasis|eczema|melanoma|skin|rash)\w*/i, name: 'Dermatology' },
  { kw: /\b(nephritis|nephrotic|renal|kidney|dialys)\w*/i, name: 'Nephrology' },
  { kw: /\b(arthritis|lupus|rheumat|sjogren|scleroderma)\w*/i, name: 'Rheumatology' },
  { kw: /\b(crohn|colitis|ibd|hepatitis|cirrhos|gastritis)\w*/i, name: 'Gastroenterology' },
  { kw: /\b(pregnan|obstetric|preeclamps|gynaecol|gynecol)\w*/i, name: 'OB/GYN' },
  { kw: /\b(pediatric|infant|neonat|child)\w*/i, name: 'Pediatrics' },
  { kw: /\b(psychos|schizo|depress|bipolar|anxiety)\w*/i, name: 'Psychiatry' },
];

function specialtyFor(text: string): string | null {
  for (const { kw, name } of SPECIALTY_HINTS) {
    if (kw.test(text)) return name;
  }
  return null;
}

function extractDoi(elocation: string | undefined): string | null {
  if (!elocation) return null;
  const m = elocation.match(/10\.\d{4,9}\/[\w.()/:;\-]+/);
  return m ? m[0] : null;
}

/**
 * EFetch returns XML by default; we ask for the JSON summary instead
 * via efetch's `retmode=xml` for the abstract text but use esummary
 * for structured metadata. Two passes: esummary for metadata, efetch
 * for the abstract text.
 */
async function fetchSummaries(pmids: string[]): Promise<EFetchArticle[]> {
  if (pmids.length === 0) return [];
  const url = `${E_BASE}/esummary.fcgi?db=pubmed&id=${pmids.join(',')}&retmode=json`;
  await sleep(POLITE_MS);
  const r = await fetchWithBackoff(url);
  const j = (await r.json()) as { result?: Record<string, EFetchArticle> };
  return pmids.map((id) => j.result?.[id]).filter((x): x is EFetchArticle => Boolean(x?.uid));
}

/**
 * EFetch with rettype=abstract returns XML containing the abstract +
 * MeSH terms. We parse the bare minimum we need with regex (no XML
 * parser dependency). Robust to missing fields.
 */
async function fetchAbstracts(
  pmids: string[],
): Promise<Map<string, { abstract: string; mesh: string[] }>> {
  const out = new Map<string, { abstract: string; mesh: string[] }>();
  if (pmids.length === 0) return out;
  const url = `${E_BASE}/efetch.fcgi?db=pubmed&id=${pmids.join(',')}&rettype=abstract&retmode=xml`;
  await sleep(POLITE_MS);
  const r = await fetchWithBackoff(url);
  const xml = await r.text();
  // Split per <PubmedArticle> block.
  const blocks = xml.split('<PubmedArticle>');
  for (const block of blocks) {
    const pmid = block.match(/<PMID[^>]*>(\d+)<\/PMID>/)?.[1];
    if (!pmid || !pmids.includes(pmid)) continue;
    // Concatenate every <AbstractText> chunk (structured abstracts have
    // multiple labelled sections like BACKGROUND/METHODS).
    const absMatches = [...block.matchAll(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g)];
    const abstract = absMatches
      .map((m) => decodeXml((m[1] ?? '').trim()))
      .filter((s) => s.length > 0)
      .join(' ');
    const meshMatches = [...block.matchAll(/<DescriptorName[^>]*>([\s\S]*?)<\/DescriptorName>/g)];
    const mesh = meshMatches.map((m) => decodeXml((m[1] ?? '').trim())).filter((s) => s.length > 0);
    out.set(pmid, { abstract, mesh });
  }
  return out;
}

function decodeXml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/<[^>]+>/g, '');
}

async function esearchCaseReports(query: string, limit: number): Promise<string[]> {
  const term = query
    ? `(${query}) AND "Case Reports"[Publication Type]`
    : '"Case Reports"[Publication Type]';
  const url = `${E_BASE}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(term)}&retmax=${limit}&retmode=json&sort=date`;
  await sleep(POLITE_MS);
  const r = await fetchWithBackoff(url);
  const j = (await r.json()) as ESearchResult;
  return j.esearchresult?.idlist ?? [];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outPath = join(CACHE_BASE, 'pubmed-cases.jsonl');
  await mkdir(dirname(outPath), { recursive: true });

  console.log(
    `▸ PubMed case-fetch · target ${args.limit}${args.query ? ` · query "${args.query}"` : ''}`,
  );
  console.log(`▸ Cache: ${outPath}`);

  // Load existing cache so we can resume + dedupe.
  const seen = new Set<string>();
  let existingCount = 0;
  if (args.resume) {
    try {
      const text = await readFile(outPath, 'utf8');
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        const r = JSON.parse(line) as CaseRecord;
        seen.add(r.pmid);
        existingCount++;
      }
      console.log(`▸ Resume: ${existingCount} cached, will skip`);
    } catch {
      // no cache yet
    }
  }

  // 1. ESearch for case-report PMIDs
  const remaining = Math.max(0, args.limit - seen.size);
  if (remaining === 0) {
    console.log('  ✓ Cache already meets target. Done.');
    return;
  }

  const pmids = (await esearchCaseReports(args.query, args.limit + seen.size)).filter(
    (id) => !seen.has(id),
  );
  console.log(`  ▸ ${pmids.length} new PMIDs to ingest`);

  // 2. Walk in batches of 50 (NCBI's recommended chunk size for esummary).
  const BATCH = 50;
  let written = 0;
  for (let i = 0; i < pmids.length; i += BATCH) {
    const batch = pmids.slice(i, i + BATCH);
    const [summaries, abstracts] = await Promise.all([
      fetchSummaries(batch),
      fetchAbstracts(batch),
    ]);
    const records: CaseRecord[] = [];
    for (const s of summaries) {
      const ab = abstracts.get(s.uid);
      if (!ab || ab.abstract.length < 80) continue; // need a real abstract
      const record: CaseRecord = {
        pmid: s.uid,
        title: decodeXml(s.title ?? ''),
        abstract: ab.abstract,
        meshTerms: ab.mesh,
        journal: s.source ?? '',
        year: parseYear(s.pubdate),
        doi: extractDoi(s.elocationid),
        specialty: specialtyFor(`${s.title ?? ''} ${ab.abstract}`),
      };
      records.push(record);
    }
    if (records.length > 0) {
      const lines = records.map((r) => JSON.stringify(r)).join('\n');
      await writeFile(outPath, `${lines}\n`, { flag: 'a' });
      written += records.length;
      console.log(`  ▸ batch ${i / BATCH + 1} → +${records.length} (total written ${written})`);
    }
  }

  console.log(`✓ done · ${written} new case reports cached at ${outPath}`);
}

function parseYear(pubdate: string | undefined): number | null {
  if (!pubdate) return null;
  const m = pubdate.match(/\b(19|20)\d{2}\b/);
  return m ? Number(m[0]) : null;
}

main().catch((err) => {
  console.error('✗ fetch-pubmed-cases failed:', err);
  process.exit(1);
});
