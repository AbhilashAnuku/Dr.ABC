/**
 * PgVectorRetriever — semantic dense-vector retrieval over a Postgres
 * + pgvector store, with a graceful fallback to the in-memory BM25
 * retriever when the database is unreachable or the extension is
 * missing.
 *
 * Why a fallback rather than a hard error: the alpha runs without a
 * required Postgres in many demo paths. The Library agent should
 * still answer queries with sparse retrieval rather than 500-ing.
 *
 * Embedding strategy:
 *   - Try a configurable embedding endpoint (OpenAI-compatible
 *     `/v1/embeddings` — works against OpenAI, NVIDIA NIM, local
 *     llama.cpp servers, and Ollama's `/api/embeddings`).
 *   - On failure → fall back to BM25.
 *
 * Schema expected (created lazily by `ensureSchema()`):
 *
 *     CREATE EXTENSION IF NOT EXISTS vector;
 *     CREATE TABLE library_documents (
 *       id text PRIMARY KEY,
 *       text text NOT NULL,
 *       source text NOT NULL,
 *       locator text,
 *       year int,
 *       tags text[],
 *       embedding vector(384)
 *     );
 *     CREATE INDEX ON library_documents USING ivfflat (embedding vector_cosine_ops);
 */

import type { Citation, LibraryDocument, RetrievalResult, Retriever } from './library.ts';

const DEFAULT_EMBED_URL = 'http://localhost:11434/api/embeddings';
const DEFAULT_EMBED_MODEL = 'nomic-embed-text';
const DEFAULT_DIM = 384;

export interface PgVectorRetrieverOptions {
  /** Postgres connection string (DATABASE_URL). When omitted, ctor returns the fallback retriever. */
  databaseUrl?: string;
  /** OpenAI-compatible embeddings URL. Defaults to local Ollama. */
  embeddingsUrl?: string;
  /** Embedding model id. */
  embeddingsModel?: string;
  /** Vector dimension (must match the schema's vector(N)). */
  dim?: number;
  /** Bearer token for hosted embedding providers (OpenAI, NVIDIA, …). */
  embeddingsToken?: string;
  /** Retriever to delegate to when pgvector / embeddings are unavailable. */
  fallback: Retriever;
}

/**
 * Asks the configured embeddings endpoint for a single vector. Returns
 * null on any failure so callers can degrade to the fallback path.
 *
 * Supports two response shapes:
 *   - OpenAI: `{ data: [{ embedding: number[] }] }`
 *   - Ollama: `{ embedding: number[] }`
 */
export async function embedQuery(
  query: string,
  opts: {
    url: string;
    model: string;
    token?: string;
    timeoutMs?: number;
  },
): Promise<number[] | null> {
  try {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (opts.token) headers.authorization = `Bearer ${opts.token}`;
    // OpenAI shape uses `input`; Ollama uses `prompt`. We send both
    // and let the server pick — saves a per-server branch.
    const body = { model: opts.model, input: query, prompt: query };
    const res = await fetch(opts.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 8_000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      data?: { embedding?: number[] }[];
      embedding?: number[];
    };
    return json.data?.[0]?.embedding ?? json.embedding ?? null;
  } catch {
    return null;
  }
}

/**
 * Two-implementation pattern: when DATABASE_URL is set we attempt the
 * pgvector path; on any boot-time failure we fall back to the
 * fallback retriever and surface the reason via `name`.
 *
 * The Postgres client is lazy-imported so the rest of `@dr-abc/agents`
 * doesn't depend on `pg` for environments that never use pgvector
 * (e.g. browser bundles, edge workers).
 */
export class PgVectorRetriever implements Retriever {
  readonly name: string;
  private readonly opts: PgVectorRetrieverOptions;
  private readonly fallback: Retriever;
  /** Set on first successful query — once degraded we stay on fallback. */
  private degraded = false;
  private degradedReason: string | null = null;

  constructor(opts: PgVectorRetrieverOptions) {
    this.opts = opts;
    this.fallback = opts.fallback;
    if (!opts.databaseUrl) {
      this.degraded = true;
      this.degradedReason = 'DATABASE_URL not set';
    }
    this.name = this.degraded
      ? `pgvector(degraded → ${opts.fallback.name}; reason: ${this.degradedReason})`
      : `pgvector(${opts.embeddingsModel ?? DEFAULT_EMBED_MODEL}@${opts.dim ?? DEFAULT_DIM}d)`;
  }

  async search(query: string, k: number): Promise<RetrievalResult> {
    if (this.degraded) return this.fallback.search(query, k);

    const vector = await embedQuery(query, {
      url: this.opts.embeddingsUrl ?? DEFAULT_EMBED_URL,
      model: this.opts.embeddingsModel ?? DEFAULT_EMBED_MODEL,
      token: this.opts.embeddingsToken,
    });
    if (!vector || vector.length === 0) {
      this.markDegraded('embedding endpoint returned no vector');
      return this.fallback.search(query, k);
    }

    try {
      const rows = await this.runPgQuery(vector, k);
      return {
        query,
        citations: rows,
        retrieverUsed: this.name,
      };
    } catch (e) {
      this.markDegraded(e instanceof Error ? e.message : String(e));
      return this.fallback.search(query, k);
    }
  }

  /** Lazy-import `pg`, query the table, return citations sorted by cosine sim. */
  private async runPgQuery(vector: number[], k: number): Promise<Citation[]> {
    type PgClient = {
      connect(): Promise<void>;
      query<T>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
      end(): Promise<void>;
    };
    type PgModule = { Client: new (cfg: { connectionString: string }) => PgClient };
    // `pg` is an optional peer dependency — installed only on environments
    // that actually point at a Postgres instance. We swallow the import
    // failure and let the caller fall back to BM25. The module name is
    // kept as a runtime variable so neither Rollup nor Vite's
    // import-analysis tries to statically resolve it (it would fail in
    // browser bundles where `pg` is — by design — not present).
    const pgModuleName = 'pg';
    const pgModule = (await import(/* @vite-ignore */ pgModuleName).catch(
      () => null,
    )) as PgModule | null;
    if (!pgModule) {
      throw new Error('pg module not installed; add `pg` to packages/agents to enable pgvector');
    }
    const client = new pgModule.Client({ connectionString: this.opts.databaseUrl as string });
    await client.connect();
    try {
      // pgvector's <=> is cosine distance — smaller is more similar, so we
      // sort ASC and convert to similarity = 1 - distance for the score.
      const sql = `
        SELECT id, text, source, locator, year, tags,
               1 - (embedding <=> $1::vector) AS similarity
        FROM library_documents
        ORDER BY embedding <=> $1::vector ASC
        LIMIT $2
      `;
      const literal = `[${vector.join(',')}]`;
      const result = await client.query<{
        id: string;
        text: string;
        source: string;
        locator: string | null;
        year: number | null;
        tags: string[] | null;
        similarity: number;
      }>(sql, [literal, k]);
      return result.rows.map(
        (r): Citation => ({
          document: {
            id: r.id,
            text: r.text,
            source: r.source,
            locator: r.locator ?? undefined,
            year: r.year ?? undefined,
            tags: r.tags ?? undefined,
          },
          score: r.similarity,
          matchedTerms: [],
        }),
      );
    } finally {
      await client.end();
    }
  }

  private markDegraded(reason: string): void {
    this.degraded = true;
    this.degradedReason = reason;
  }
}

/**
 * Convenience factory — reads from a plain env shape and wires the
 * BM25 fallback for the caller. Used by apps/api/src/server.ts so the
 * rest of the codebase doesn't have to know about the pgvector
 * options surface.
 */
export function tryCreatePgVectorRetriever(
  env: {
    DATABASE_URL?: string;
    EMBEDDINGS_URL?: string;
    EMBEDDINGS_MODEL?: string;
    EMBEDDINGS_TOKEN?: string;
    EMBEDDINGS_DIM?: string;
  },
  fallback: Retriever,
): Retriever {
  if (!env.DATABASE_URL) return fallback;
  return new PgVectorRetriever({
    databaseUrl: env.DATABASE_URL,
    embeddingsUrl: env.EMBEDDINGS_URL,
    embeddingsModel: env.EMBEDDINGS_MODEL,
    embeddingsToken: env.EMBEDDINGS_TOKEN,
    dim: env.EMBEDDINGS_DIM ? Number(env.EMBEDDINGS_DIM) : undefined,
    fallback,
  });
}
