/**
 * ActivitySink — append-only journal for everything meaningful that
 * happens across the app. Powers the Training Cockpit's live feed +
 * per-agent metrics + the future memory agent's input stream.
 *
 * Two implementations behind one interface:
 *
 *   - PgActivitySink — Drizzle ORM against the `activity_log` table in
 *     `packages/db/src/schema.ts`. Preferred when DATABASE_URL is set.
 *   - MemoryActivitySink — bounded in-process ring buffer (5000
 *     entries). The graceful fallback when Postgres is unreachable, and
 *     also the default in dev/CI where no DB is wired.
 *
 * The pick happens once at boot via `pickActivitySink()`. The sink is
 * intentionally tolerant: writes return `Promise<void>` and never
 * throw — callers fire-and-forget. Tail/query throw on the rare
 * configuration error so the cockpit can surface "sink unhealthy".
 */

export interface ActivityEntry {
  id: string;
  ts: number;
  role: 'patient' | 'doctor' | 'student' | 'developer' | 'system';
  userId: string;
  route: string;
  action: string;
  payload?: Record<string, unknown>;
  latencyMs?: number;
  status?: 'ok' | 'error';
}

export interface ActivityQueryFilters {
  since?: number;
  until?: number;
  role?: ActivityEntry['role'];
  route?: string;
  /** Substring match on `action`. */
  action?: string;
  status?: 'ok' | 'error';
  limit?: number;
}

export interface ActivitySink {
  /** Human-readable name surfaced in /health and the cockpit. */
  readonly name: string;
  /** Append a single entry. Never throws. */
  write(entry: ActivityEntry): Promise<void>;
  /** Newest-first paginated query. */
  query(filters: ActivityQueryFilters): Promise<ActivityEntry[]>;
  /** Live tail. Yields entries written *after* the call started. */
  tail(opts?: { signal?: AbortSignal }): AsyncIterable<ActivityEntry>;
  /**
   * Wipe every stored entry. Used by `/audit/reset` to clear a
   * tampered chain so the next signed write seeds a fresh chain
   * head. Memory sinks empty the ring; pg sinks truncate the
   * activity table.
   */
  clear(): Promise<void>;
}

// ============================================================
//  In-memory sink — bounded ring buffer + EventTarget tail
// ============================================================

const DEFAULT_CAP = 5_000;

export class MemoryActivitySink implements ActivitySink {
  readonly name = 'memory';
  private readonly buf: ActivityEntry[] = [];
  private readonly cap: number;
  private readonly bus = new EventTarget();

  constructor(cap = DEFAULT_CAP) {
    this.cap = cap;
  }

  async write(entry: ActivityEntry): Promise<void> {
    this.buf.push(entry);
    if (this.buf.length > this.cap) this.buf.shift();
    // Cheap synchronous fan-out so any active tail() iterators wake up.
    this.bus.dispatchEvent(new CustomEvent('write', { detail: entry }));
  }

  async query(filters: ActivityQueryFilters): Promise<ActivityEntry[]> {
    const limit = filters.limit ?? 200;
    const out: ActivityEntry[] = [];
    // Walk newest-first from the tail of the buffer.
    for (let i = this.buf.length - 1; i >= 0 && out.length < limit; i--) {
      const e = this.buf[i];
      if (!e) continue;
      if (!matches(e, filters)) continue;
      out.push(e);
    }
    return out;
  }

  async *tail(opts?: { signal?: AbortSignal }): AsyncIterable<ActivityEntry> {
    const queue: ActivityEntry[] = [];
    let resolveNext: ((v: ActivityEntry | null) => void) | null = null;

    const onWrite = (ev: Event) => {
      const e = (ev as CustomEvent<ActivityEntry>).detail;
      if (resolveNext) {
        const r = resolveNext;
        resolveNext = null;
        r(e);
      } else {
        queue.push(e);
      }
    };

    this.bus.addEventListener('write', onWrite);
    const cleanup = () => {
      this.bus.removeEventListener('write', onWrite);
      if (resolveNext) {
        resolveNext(null);
        resolveNext = null;
      }
    };
    opts?.signal?.addEventListener('abort', cleanup, { once: true });

    try {
      while (!opts?.signal?.aborted) {
        if (queue.length > 0) {
          const next = queue.shift();
          if (next) yield next;
          continue;
        }
        const next = await new Promise<ActivityEntry | null>((res) => {
          resolveNext = res;
        });
        if (next === null) return;
        yield next;
      }
    } finally {
      cleanup();
    }
  }

  async clear(): Promise<void> {
    this.buf.length = 0;
  }

  /** Test helper — exposes the underlying buffer length. */
  get size(): number {
    return this.buf.length;
  }
}

function matches(e: ActivityEntry, f: ActivityQueryFilters): boolean {
  if (f.since !== undefined && e.ts < f.since) return false;
  if (f.until !== undefined && e.ts > f.until) return false;
  if (f.role && e.role !== f.role) return false;
  if (f.route && e.route !== f.route) return false;
  if (f.action && !e.action.includes(f.action)) return false;
  if (f.status && (e.status ?? 'ok') !== f.status) return false;
  return true;
}

// ============================================================
//  Postgres sink — Drizzle, lazy-imported so the API runtime
//  doesn't pull `pg` when DATABASE_URL is unset.
// ============================================================

interface DbHandle {
  insert(table: unknown): { values(row: unknown): { execute(): Promise<void> } };
  select(): {
    from(table: unknown): {
      where?(...args: unknown[]): unknown;
      orderBy?(...args: unknown[]): unknown;
      limit?(n: number): unknown;
    };
  };
}

export class PgActivitySink implements ActivitySink {
  readonly name = 'pgvector';
  private dbPromise: Promise<DbHandle | null> | null = null;
  private readonly fallback = new MemoryActivitySink();

  constructor(private readonly databaseUrl: string) {}

  private async getDb(): Promise<DbHandle | null> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = (async () => {
      try {
        // @ts-expect-error optional peer deps, not in package.json
        const pgMod = (await import('pg').catch(() => null)) as {
          Pool: new (cfg: { connectionString: string }) => unknown;
        } | null;
        // @ts-expect-error optional peer dep
        const drizzleMod = (await import('drizzle-orm/node-postgres').catch(() => null)) as {
          drizzle: (pool: unknown) => DbHandle;
        } | null;
        if (!pgMod || !drizzleMod) return null;
        const pool = new pgMod.Pool({ connectionString: this.databaseUrl });
        return drizzleMod.drizzle(pool);
      } catch {
        return null;
      }
    })();
    return this.dbPromise;
  }

  async write(entry: ActivityEntry): Promise<void> {
    // Always write through to the in-memory fallback so the tail() SSE
    // stream stays live even if PG is degraded — the cockpit doesn't
    // care which backing store the entry lives in.
    await this.fallback.write(entry);
    const db = await this.getDb();
    if (!db) return;
    try {
      // Lazy schema import keeps `@dr-abc/db` out of the runtime path
      // for builds that never touch Postgres.
      const { activityLog } = await import('@dr-abc/db');
      await db
        .insert(activityLog)
        .values({
          id: entry.id,
          ts: entry.ts,
          role: entry.role,
          userId: entry.userId,
          route: entry.route,
          action: entry.action,
          payload: entry.payload ?? null,
          latencyMs: entry.latencyMs ?? null,
          status: entry.status ?? 'ok',
        })
        .execute();
    } catch {
      // Swallow — the in-memory fallback already has the entry.
    }
  }

  async query(filters: ActivityQueryFilters): Promise<ActivityEntry[]> {
    // For now we serve queries from the in-memory mirror. A proper
    // Drizzle SELECT lands once the full DB layer is wired (Stage 8 —
    // continuous learning over historical activity).
    return this.fallback.query(filters);
  }

  tail(opts?: { signal?: AbortSignal }): AsyncIterable<ActivityEntry> {
    return this.fallback.tail(opts);
  }

  async clear(): Promise<void> {
    await this.fallback.clear();
    // Best-effort PG truncate — never throws.
    const db = await this.getDb();
    if (!db) return;
    try {
      const { activityLog } = await import('@dr-abc/db');
      // biome-ignore lint/suspicious/noExplicitAny: drizzle delete typed weakly here
      const delAny = (db as any).delete?.(activityLog);
      if (delAny?.execute) await delAny.execute();
    } catch {
      /* swallow */
    }
  }
}

// ============================================================
//  Boot-time pick
// ============================================================

export function pickActivitySink(env: { DATABASE_URL?: string }): ActivitySink {
  if (env.DATABASE_URL && env.DATABASE_URL.length > 0) {
    return new PgActivitySink(env.DATABASE_URL);
  }
  return new MemoryActivitySink();
}
