/**
 * Firecrawl client — minimal wrapper around v1's scrape + extract.
 *
 * Two methods cover Morbius's two use-cases:
 *
 *   scrape(url)   — grab clean markdown from a single page (good for
 *                   guideline pages, leaflet content, NICE / ESC
 *                   pathways, etc.). Used by the Library agent when
 *                   the local retriever returns < 3 hits.
 *
 *   extract(urls, schema) — pull structured rows out of multiple
 *                   pages with a JSON schema. Used by the nightly
 *                   research-cycle to ingest PubMed abstracts as
 *                   { title, abstract, doi, authors, journal, date }
 *                   rows into sample-data/pubmed-YYYY-MM.json.
 *
 * No third-party SDK — plain HTTPS POST, JSON, bearer auth.
 *
 * Requires a provisioned FIRECRAWL_API_KEY.
 */

const FIRECRAWL_BASE = 'https://api.firecrawl.dev/v1';

export interface FirecrawlConfig {
  apiKey: string;
}

export function readFirecrawlConfig(
  env: Partial<Record<string, string>> = process.env,
): FirecrawlConfig | null {
  const apiKey = env.FIRECRAWL_API_KEY;
  if (!apiKey) return null;
  return { apiKey };
}

export interface ScrapeResult {
  markdown: string;
  html?: string;
  metadata?: Record<string, unknown>;
  /** Source URL, echoed back from the response. */
  sourceUrl: string;
}

/**
 * Single-page scrape. Returns the page rendered as clean markdown +
 * metadata. Drop into the Library agent's evidence-block builder when
 * the BM25 / pgvector retriever has no hits.
 */
export async function firecrawlScrape(
  cfg: FirecrawlConfig,
  url: string,
  opts: { formats?: Array<'markdown' | 'html'>; onlyMainContent?: boolean } = {},
): Promise<ScrapeResult> {
  const res = await fetch(`${FIRECRAWL_BASE}/scrape`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      url,
      formats: opts.formats ?? ['markdown'],
      onlyMainContent: opts.onlyMainContent ?? true,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Firecrawl scrape ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    success?: boolean;
    data?: {
      markdown?: string;
      html?: string;
      metadata?: Record<string, unknown>;
    };
  };
  return {
    markdown: json.data?.markdown ?? '',
    html: json.data?.html,
    metadata: json.data?.metadata,
    sourceUrl: url,
  };
}

export interface ExtractRow {
  [key: string]: unknown;
}

/**
 * Structured extraction across N urls with a JSON schema. Returns
 * rows. Used by the research-cycle's PubMed ingestion.
 */
export async function firecrawlExtract(
  cfg: FirecrawlConfig,
  urls: string[],
  schema: Record<string, unknown>,
  prompt?: string,
): Promise<ExtractRow[]> {
  const res = await fetch(`${FIRECRAWL_BASE}/extract`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      urls,
      schema,
      prompt:
        prompt ??
        'Extract the structured fields per the schema. Skip rows where any required field cannot be resolved confidently.',
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Firecrawl extract ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as { success?: boolean; data?: ExtractRow[] | ExtractRow };
  if (Array.isArray(json.data)) return json.data;
  if (json.data && typeof json.data === 'object') return [json.data];
  return [];
}
