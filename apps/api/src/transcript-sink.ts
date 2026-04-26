/**
 * TranscriptSink — durable consult-conversation store.
 *
 * Same Pg-or-memory pattern as activity-sink.ts:
 *   - PgTranscriptSink   uses Drizzle against `consult_messages`
 *                        (set DATABASE_URL to enable).
 *   - MemoryTranscriptSink is the bounded in-process fallback so the
 *                        REST surface stays alive without a DB.
 *
 * The web client persists to localStorage for instant resume + POSTs
 * each turn here so the same conversation is reachable from a
 * different device or after a browser-storage clear. Writes return
 * Promise<void> and never throw — fire-and-forget at the call site.
 */

export interface TranscriptTurn {
  id: string;
  consultId: string;
  userId: string;
  ts: number;
  role: string;
  text: string;
  meta?: Record<string, unknown>;
}

export interface TranscriptSink {
  readonly name: string;
  write(turn: TranscriptTurn): Promise<void>;
  list(consultId: string, userId: string): Promise<TranscriptTurn[]>;
  recent(userId: string, limit: number): Promise<TranscriptTurn[]>;
}

// ============================================================
//  In-memory sink — bounded by total entries to prevent runaway
// ============================================================

const DEFAULT_CAP = 5_000;

export class MemoryTranscriptSink implements TranscriptSink {
  readonly name = 'memory';
  private buf: TranscriptTurn[] = [];
  constructor(private cap = DEFAULT_CAP) {}

  async write(turn: TranscriptTurn): Promise<void> {
    this.buf.push(turn);
    if (this.buf.length > this.cap) this.buf.shift();
  }

  async list(consultId: string, userId: string): Promise<TranscriptTurn[]> {
    return this.buf
      .filter((t) => t.consultId === consultId && t.userId === userId)
      .sort((a, b) => a.ts - b.ts);
  }

  async recent(userId: string, limit: number): Promise<TranscriptTurn[]> {
    return this.buf
      .filter((t) => t.userId === userId)
      .sort((a, b) => b.ts - a.ts)
      .slice(0, limit);
  }
}

// ============================================================
//  Postgres sink — best-effort dynamic Drizzle import. Falls back
//                  to memory if the import or connect fails so the
//                  api server still boots without a DB.
// ============================================================

interface PgEnv {
  DATABASE_URL?: string;
}

export async function pickTranscriptSink(env: PgEnv): Promise<TranscriptSink> {
  const memory = new MemoryTranscriptSink();
  if (!env.DATABASE_URL) return memory;
  try {
    // @ts-expect-error optional peer dep — same pattern as activity-sink.ts
    const pgMod = (await import('pg').catch(() => null)) as {
      Pool: new (cfg: { connectionString: string }) => unknown;
    } | null;
    // @ts-expect-error optional peer dep
    const drizzleMod = (await import('drizzle-orm/node-postgres').catch(() => null)) as {
      // biome-ignore lint/suspicious/noExplicitAny: drizzle handle inferred at runtime
      drizzle: (pool: unknown) => any;
    } | null;
    // @ts-expect-error optional peer dep
    const opsMod = (await import('drizzle-orm').catch(() => null)) as {
      // biome-ignore lint/suspicious/noExplicitAny: drizzle ops are runtime-typed
      and: (...c: unknown[]) => any;
      // biome-ignore lint/suspicious/noExplicitAny: drizzle ops are runtime-typed
      asc: (col: unknown) => any;
      // biome-ignore lint/suspicious/noExplicitAny: drizzle ops are runtime-typed
      desc: (col: unknown) => any;
      // biome-ignore lint/suspicious/noExplicitAny: drizzle ops are runtime-typed
      eq: (col: unknown, v: unknown) => any;
    } | null;
    if (!pgMod || !drizzleMod || !opsMod) return memory;
    const { consultMessage } = await import('@dr-abc/db');
    const pool = new pgMod.Pool({ connectionString: env.DATABASE_URL });
    const db = drizzleMod.drizzle(pool);
    const { and, asc, desc, eq } = opsMod;

    const sink: TranscriptSink = {
      name: 'postgres',
      async write(turn) {
        await memory.write(turn);
        try {
          await db
            .insert(consultMessage)
            .values({
              id: turn.id,
              consultId: turn.consultId,
              userId: turn.userId,
              ts: turn.ts,
              role: turn.role,
              text: turn.text,
              meta: turn.meta ?? null,
            })
            .onConflictDoNothing();
        } catch {
          // swallow — memory mirror already has the turn
        }
      },
      async list(consultId, userId) {
        try {
          const rows = await db
            .select()
            .from(consultMessage)
            .where(and(eq(consultMessage.consultId, consultId), eq(consultMessage.userId, userId)))
            .orderBy(asc(consultMessage.ts));
          return (rows as Array<TranscriptTurn & { meta: Record<string, unknown> | null }>).map(
            (r) => ({ ...r, meta: r.meta ?? undefined }),
          );
        } catch {
          return memory.list(consultId, userId);
        }
      },
      async recent(userId, limit) {
        try {
          const rows = await db
            .select()
            .from(consultMessage)
            .where(eq(consultMessage.userId, userId))
            .orderBy(desc(consultMessage.ts))
            .limit(limit);
          return (rows as Array<TranscriptTurn & { meta: Record<string, unknown> | null }>).map(
            (r) => ({ ...r, meta: r.meta ?? undefined }),
          );
        } catch {
          return memory.recent(userId, limit);
        }
      },
    };
    return sink;
  } catch {
    return memory;
  }
}
