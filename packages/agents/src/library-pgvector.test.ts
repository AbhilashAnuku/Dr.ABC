import { describe, expect, mock, test } from 'bun:test';
import { PgVectorRetriever, embedQuery, tryCreatePgVectorRetriever } from './library-pgvector.ts';
import type { RetrievalResult, Retriever } from './library.ts';

const DUMMY_FALLBACK: Retriever = {
  name: 'bm25(seed)',
  async search(query: string, k: number): Promise<RetrievalResult> {
    return {
      query,
      citations: [
        {
          document: { id: 'fb1', text: `fallback for ${query}`, source: 'seed' },
          score: 0.42,
          matchedTerms: [query],
        },
      ],
      retrieverUsed: 'bm25(seed)',
    };
  },
};

describe('PgVectorRetriever fallback', () => {
  test('starts in degraded state when DATABASE_URL is missing', () => {
    const r = new PgVectorRetriever({ fallback: DUMMY_FALLBACK });
    expect(r.name).toContain('degraded');
    expect(r.name).toContain('DATABASE_URL not set');
  });

  test('search delegates to the fallback when degraded', async () => {
    const r = new PgVectorRetriever({ fallback: DUMMY_FALLBACK });
    const result = await r.search('chest pain', 3);
    expect(result.retrieverUsed).toBe('bm25(seed)');
    expect(result.citations[0]?.document.id).toBe('fb1');
  });

  test('falls back when the embeddings endpoint returns nothing', async () => {
    const fetchMock = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: [] }),
      } as unknown as Response),
    );
    const original = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const r = new PgVectorRetriever({
        databaseUrl: 'postgres://does-not-matter',
        embeddingsUrl: 'http://localhost:11434/api/embeddings',
        fallback: DUMMY_FALLBACK,
      });
      const result = await r.search('asthma', 3);
      // No vector → degrade → fallback fires.
      expect(result.retrieverUsed).toBe('bm25(seed)');
      expect(fetchMock).toHaveBeenCalled();
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('tryCreatePgVectorRetriever factory', () => {
  test('returns the fallback when DATABASE_URL is unset', () => {
    const r = tryCreatePgVectorRetriever({}, DUMMY_FALLBACK);
    expect(r).toBe(DUMMY_FALLBACK);
  });

  test('returns a PgVectorRetriever when DATABASE_URL is set', () => {
    const r = tryCreatePgVectorRetriever(
      { DATABASE_URL: 'postgres://x', EMBEDDINGS_MODEL: 'nomic-embed-text', EMBEDDINGS_DIM: '768' },
      DUMMY_FALLBACK,
    );
    expect(r).toBeInstanceOf(PgVectorRetriever);
    expect(r.name).toContain('nomic-embed-text');
    expect(r.name).toContain('768d');
  });
});

describe('embedQuery', () => {
  test('parses OpenAI-shaped responses', async () => {
    const fetchMock = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
      } as unknown as Response),
    );
    const original = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const v = await embedQuery('q', { url: 'http://x', model: 'm' });
      expect(v).toEqual([0.1, 0.2, 0.3]);
    } finally {
      globalThis.fetch = original;
    }
  });

  test('parses Ollama-shaped responses', async () => {
    const fetchMock = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ embedding: [0.4, 0.5] }),
      } as unknown as Response),
    );
    const original = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const v = await embedQuery('q', { url: 'http://x', model: 'm' });
      expect(v).toEqual([0.4, 0.5]);
    } finally {
      globalThis.fetch = original;
    }
  });

  test('returns null on non-OK response', async () => {
    const fetchMock = mock(() =>
      Promise.resolve({ ok: false, status: 503 } as unknown as Response),
    );
    const original = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const v = await embedQuery('q', { url: 'http://x', model: 'm' });
      expect(v).toBeNull();
    } finally {
      globalThis.fetch = original;
    }
  });
});
