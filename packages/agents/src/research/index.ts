import { BaseAgent } from '@dr-abc/morbius-core';
import {
  AgentKind,
  type Evidence,
  type EvidenceSource,
  Intent,
  type OrchestratorEvent,
  type ResearchInput,
  type ResearchOutput,
  type Task,
} from '@dr-abc/types';
import { searchClinicalTrials } from './clinicaltrials.ts';
import { searchPubmed } from './pubmed.ts';
import { searchWho } from './who.ts';

/**
 * ResearchAgent — fans a query out to PubMed, ClinicalTrials.gov and WHO
 * in parallel, dedupes, and scores by recency × source authority. The
 * synth agent (Day 4) consumes the resulting Evidence[] and weaves
 * footnotes into a clinical answer.
 *
 * Cache:
 *   In-memory Map keyed by `query|sources|limit`. 30-min TTL — long
 *   enough that "ask the same question twice" is fast, short enough
 *   that fresh PubMed records still surface within the day.
 */

const CACHE_TTL_MS = 30 * 60_000;
const cache = new Map<string, { at: number; out: ResearchOutput }>();

const FETCHERS: Record<EvidenceSource, (q: string, limit: number) => Promise<Evidence[]>> = {
  pubmed: searchPubmed,
  clinicaltrials: searchClinicalTrials,
  who: searchWho,
};

const SOURCE_WEIGHT: Record<EvidenceSource, number> = {
  pubmed: 1.0,
  clinicaltrials: 0.85,
  who: 0.95,
};

export class ResearchAgent extends BaseAgent<ResearchInput, ResearchOutput> {
  readonly kind = AgentKind.Research;
  readonly version = '0.1.0';
  readonly minConfidence = 0.4;

  canHandle(task: Task): boolean {
    return task.intent === Intent.Research || task.intent === Intent.ReadAbout;
  }

  protected async reason(
    task: Task<ResearchInput>,
    emit: (e: OrchestratorEvent) => void,
  ): Promise<{
    data: ResearchOutput;
    confidence: number;
    evidence: string[];
    warnings: string[];
  }> {
    const input = normaliseInput(task);
    const cacheKey = makeCacheKey(input);
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      emit({
        type: 'agent.token',
        agent: this.kind,
        token: `Cache hit — ${cached.out.evidence.length} citations`,
      });
      emit({ type: 'evidence.found', agent: this.kind, evidence: cached.out.evidence });
      return {
        data: cached.out,
        confidence: confidenceFor(cached.out.evidence.length),
        evidence: cached.out.evidence.map((e) => `${e.source}:${e.id}`),
        warnings: [],
      };
    }

    emit({
      type: 'agent.token',
      agent: this.kind,
      token: `Querying ${input.sources.join(' + ')}…`,
    });

    const start = Date.now();
    const results = await Promise.allSettled(
      input.sources.map((source) =>
        FETCHERS[source](input.query, input.perSourceLimit).then((evidence) => ({
          source,
          evidence,
        })),
      ),
    );

    const collected: Evidence[] = [];
    const failures: { source: EvidenceSource; error: string }[] = [];
    results.forEach((r, i) => {
      const source = input.sources[i] as EvidenceSource;
      if (r.status === 'fulfilled') {
        collected.push(...r.value.evidence);
      } else {
        failures.push({
          source,
          error: r.reason instanceof Error ? r.reason.message : String(r.reason),
        });
        emit({
          type: 'agent.token',
          agent: this.kind,
          token: `${source} failed — ${failures[failures.length - 1]?.error.slice(0, 60)}`,
        });
      }
    });

    const ranked = rank(dedupe(collected), input.query);
    const elapsedMs = Date.now() - start;

    emit({
      type: 'agent.token',
      agent: this.kind,
      token: `${ranked.length} citations in ${elapsedMs} ms`,
    });
    emit({ type: 'evidence.found', agent: this.kind, evidence: ranked });

    const out: ResearchOutput = {
      query: input.query,
      evidence: ranked,
      failedSources: failures,
      elapsedMs,
    };
    cache.set(cacheKey, { at: Date.now(), out });

    return {
      data: out,
      confidence: confidenceFor(ranked.length),
      evidence: ranked.slice(0, 5).map((e) => `${e.source}:${e.id}`),
      warnings: failures.length > 0 ? [`${failures.length}/3 sources failed`] : [],
    };
  }
}

interface Normalised {
  query: string;
  perSourceLimit: number;
  sources: EvidenceSource[];
}

function normaliseInput(task: Task<ResearchInput>): Normalised {
  const payload = task.payload as ResearchInput | { text?: string; query?: string };
  const query =
    'query' in payload && typeof payload.query === 'string'
      ? payload.query
      : 'text' in payload && typeof payload.text === 'string'
        ? payload.text
        : '';
  const perSourceLimit =
    'perSourceLimit' in payload && typeof payload.perSourceLimit === 'number'
      ? payload.perSourceLimit
      : 8;
  const sources =
    'sources' in payload && Array.isArray(payload.sources) && payload.sources.length > 0
      ? payload.sources
      : (['pubmed', 'clinicaltrials', 'who'] as EvidenceSource[]);
  return { query, perSourceLimit, sources };
}

function makeCacheKey(input: Normalised): string {
  return `${input.sources.join('+')}|${input.perSourceLimit}|${input.query.toLowerCase()}`;
}

export function dedupe(evidence: Evidence[]): Evidence[] {
  const seen = new Set<string>();
  const out: Evidence[] = [];
  for (const e of evidence) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    out.push(e);
  }
  return out;
}

/**
 * Rank by recency × source authority × keyword overlap. Pure, no I/O —
 * sortable for testing.
 */
export function rank(evidence: Evidence[], query: string): Evidence[] {
  const tokens = tokenise(query);
  const currentYear = new Date().getUTCFullYear();
  return [...evidence]
    .map((e) => ({ e, r: relevance(e, tokens, currentYear) }))
    .sort((a, b) => b.r - a.r)
    .map(({ e, r }) => ({ ...e, relevance: r }));
}

function relevance(e: Evidence, tokens: string[], currentYear: number): number {
  const sourceWeight = SOURCE_WEIGHT[e.source] ?? 0.5;
  const recency = typeof e.year === 'number' ? Math.max(0, 1 - (currentYear - e.year) / 25) : 0.5;
  const haystack = `${e.title} ${e.summary}`.toLowerCase();
  const overlap = tokens.length
    ? tokens.filter((t) => haystack.includes(t)).length / tokens.length
    : 0;
  // Weights chosen so a 2024 PubMed paper that mentions every keyword is the
  // top result, ahead of a 2010 trial that only mentions a few. Trial out
  // weights once we land trial-grading later.
  return 0.5 * sourceWeight + 0.3 * recency + 0.2 * overlap;
}

function tokenise(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOP.has(t));
}

const STOP = new Set([
  'and',
  'the',
  'for',
  'with',
  'are',
  'about',
  'into',
  'over',
  'from',
  'this',
  'that',
  'how',
  'why',
  'what',
  'when',
  'who',
  'does',
  'doing',
  'have',
  'has',
  'had',
  'evidence',
  'study',
  'studies',
  'paper',
  'papers',
  'review',
  'meta',
  'analysis',
]);

function confidenceFor(n: number): number {
  if (n === 0) return 0;
  if (n >= 6) return 0.85;
  return 0.4 + (n / 6) * 0.45;
}

export { searchPubmed } from './pubmed.ts';
export { searchClinicalTrials } from './clinicaltrials.ts';
export { searchWho } from './who.ts';
