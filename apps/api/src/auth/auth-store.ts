/**
 * AuthStore — user + session persistence.
 *
 * Two implementations behind one interface (same pattern as
 * activity-sink.ts):
 *
 *   - PgAuthStore — Drizzle ORM against `app_user` + `app_session` in
 *     packages/db/src/schema.ts. Preferred when DATABASE_URL is set.
 *   - MemoryAuthStore — in-process Map<email, user>. Graceful fallback
 *     for dev / CI / when Postgres is unreachable.
 *
 * The pick happens once at boot via `pickAuthStore()`. Both surface the
 * same API; the routes never need to know which one is active.
 *
 * Security invariants:
 *   - Passwords are never returned to a caller. Only the hash is
 *     persisted; the routes wrap verify() but never read the hash.
 *   - Session tokens are opaque crypto-random (32 bytes hex). The
 *     server stores the token plaintext indexed by primary key; the
 *     cookie carries it back. Lookup is O(1) and exact-match.
 *   - Expired sessions are filtered at read time; a sweeper can run
 *     periodically to remove them but the in-flight check is what
 *     enforces auth.
 */

export interface AppUser {
  id: string;
  email: string;
  displayName: string;
  locale: string;
  patientIdHash?: string;
  active: boolean;
  createdAt: number;
  lastSignInAt?: number;
}

export interface AppSession {
  token: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
}

export interface AuthStore {
  readonly name: string;
  /** Insert a new user. Throws if email already exists. */
  createUser(input: {
    id: string;
    email: string;
    passwordHash: string;
    displayName: string;
    locale?: string;
  }): Promise<AppUser>;
  /** Look up a user by canonical email. Returns the hash so the routes
   *  can verify. Returns null if missing or inactive. */
  getUserByEmailWithHash(email: string): Promise<{ user: AppUser; passwordHash: string } | null>;
  /** Look up a user by id. */
  getUserById(id: string): Promise<AppUser | null>;
  /** Update lastSignInAt. Non-throwing best-effort. */
  touchLastSignIn(userId: string, ts: number): Promise<void>;
  /** Persist a session. */
  createSession(s: AppSession): Promise<void>;
  /** Look up a session, filtering out expired rows. */
  getSession(token: string): Promise<AppSession | null>;
  /** Delete a session (signout). */
  deleteSession(token: string): Promise<void>;
  /** Optional: revoke every session for a user. Used on password change. */
  deleteAllSessionsForUser(userId: string): Promise<void>;
}

// ============================================================
//  In-memory store — dev / CI / fallback
// ============================================================

export class MemoryAuthStore implements AuthStore {
  readonly name = 'memory';
  private users = new Map<string, { user: AppUser; passwordHash: string }>();
  private sessions = new Map<string, AppSession>();

  async createUser(input: {
    id: string;
    email: string;
    passwordHash: string;
    displayName: string;
    locale?: string;
  }): Promise<AppUser> {
    if (this.users.has(input.email)) {
      throw new Error('email already registered');
    }
    const user: AppUser = {
      id: input.id,
      email: input.email,
      displayName: input.displayName,
      locale: input.locale ?? 'en',
      active: true,
      createdAt: Date.now(),
    };
    this.users.set(input.email, { user, passwordHash: input.passwordHash });
    return user;
  }

  async getUserByEmailWithHash(email: string) {
    const row = this.users.get(email);
    if (!row || !row.user.active) return null;
    return { user: row.user, passwordHash: row.passwordHash };
  }

  async getUserById(id: string): Promise<AppUser | null> {
    for (const row of this.users.values()) {
      if (row.user.id === id && row.user.active) return row.user;
    }
    return null;
  }

  async touchLastSignIn(userId: string, ts: number): Promise<void> {
    for (const row of this.users.values()) {
      if (row.user.id === userId) {
        row.user.lastSignInAt = ts;
        return;
      }
    }
  }

  async createSession(s: AppSession): Promise<void> {
    this.sessions.set(s.token, s);
  }

  async getSession(token: string): Promise<AppSession | null> {
    const s = this.sessions.get(token);
    if (!s) return null;
    if (s.expiresAt <= Date.now()) {
      this.sessions.delete(token);
      return null;
    }
    return s;
  }

  async deleteSession(token: string): Promise<void> {
    this.sessions.delete(token);
  }

  async deleteAllSessionsForUser(userId: string): Promise<void> {
    for (const [token, s] of this.sessions.entries()) {
      if (s.userId === userId) this.sessions.delete(token);
    }
  }

  /** Test helper — total user count. */
  get userCount(): number {
    return this.users.size;
  }
}

// ============================================================
//  Postgres store — Drizzle, lazy-imported (optional peer deps)
// ============================================================

interface PgClient {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  end(): Promise<void>;
}

interface PoolCtor {
  new (cfg: { connectionString: string }): PgClient;
}

export class PgAuthStore implements AuthStore {
  readonly name = 'pg';
  private clientPromise: Promise<PgClient | null> | null = null;
  private readonly fallback = new MemoryAuthStore();

  constructor(private readonly databaseUrl: string) {}

  private async getClient(): Promise<PgClient | null> {
    if (this.clientPromise) return this.clientPromise;
    this.clientPromise = (async () => {
      try {
        // @ts-expect-error optional peer dep
        const pgMod = (await import('pg').catch(() => null)) as { Pool: PoolCtor } | null;
        if (!pgMod) return null;
        return new pgMod.Pool({ connectionString: this.databaseUrl });
      } catch {
        return null;
      }
    })();
    return this.clientPromise;
  }

  async createUser(input: {
    id: string;
    email: string;
    passwordHash: string;
    displayName: string;
    locale?: string;
  }): Promise<AppUser> {
    const client = await this.getClient();
    if (!client) return this.fallback.createUser(input);
    const locale = input.locale ?? 'en';
    try {
      const res = await client.query<{
        id: string;
        email: string;
        display_name: string;
        locale: string;
        patient_id_hash: string | null;
        active: boolean;
        created_at: Date;
      }>(
        `insert into app_user (id, email, password_hash, display_name, locale)
         values ($1, $2, $3, $4, $5)
         returning id, email, display_name, locale, patient_id_hash, active, created_at`,
        [input.id, input.email, input.passwordHash, input.displayName, locale],
      );
      const row = res.rows[0];
      if (!row) throw new Error('insert returned no row');
      return {
        id: row.id,
        email: row.email,
        displayName: row.display_name,
        locale: row.locale,
        patientIdHash: row.patient_id_hash ?? undefined,
        active: row.active,
        createdAt: new Date(row.created_at).getTime(),
      };
    } catch (err: unknown) {
      if (err instanceof Error && /duplicate key|unique/i.test(err.message)) {
        throw new Error('email already registered');
      }
      throw err;
    }
  }

  async getUserByEmailWithHash(email: string) {
    const client = await this.getClient();
    if (!client) return this.fallback.getUserByEmailWithHash(email);
    const res = await client.query<{
      id: string;
      email: string;
      password_hash: string;
      display_name: string;
      locale: string;
      patient_id_hash: string | null;
      active: boolean;
      created_at: Date;
      last_sign_in_at: Date | null;
    }>(
      `select id, email, password_hash, display_name, locale, patient_id_hash, active, created_at, last_sign_in_at
         from app_user where email = $1 and active = true limit 1`,
      [email],
    );
    const row = res.rows[0];
    if (!row) return null;
    return {
      user: {
        id: row.id,
        email: row.email,
        displayName: row.display_name,
        locale: row.locale,
        patientIdHash: row.patient_id_hash ?? undefined,
        active: row.active,
        createdAt: new Date(row.created_at).getTime(),
        lastSignInAt: row.last_sign_in_at ? new Date(row.last_sign_in_at).getTime() : undefined,
      },
      passwordHash: row.password_hash,
    };
  }

  async getUserById(id: string): Promise<AppUser | null> {
    const client = await this.getClient();
    if (!client) return this.fallback.getUserById(id);
    const res = await client.query<{
      id: string;
      email: string;
      display_name: string;
      locale: string;
      patient_id_hash: string | null;
      active: boolean;
      created_at: Date;
      last_sign_in_at: Date | null;
    }>(
      `select id, email, display_name, locale, patient_id_hash, active, created_at, last_sign_in_at
         from app_user where id = $1 and active = true limit 1`,
      [id],
    );
    const row = res.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      locale: row.locale,
      patientIdHash: row.patient_id_hash ?? undefined,
      active: row.active,
      createdAt: new Date(row.created_at).getTime(),
      lastSignInAt: row.last_sign_in_at ? new Date(row.last_sign_in_at).getTime() : undefined,
    };
  }

  async touchLastSignIn(userId: string, ts: number): Promise<void> {
    const client = await this.getClient();
    if (!client) return this.fallback.touchLastSignIn(userId, ts);
    await client
      .query('update app_user set last_sign_in_at = $2 where id = $1', [userId, new Date(ts)])
      .catch(() => {
        /* best-effort */
      });
  }

  async createSession(s: AppSession): Promise<void> {
    const client = await this.getClient();
    if (!client) return this.fallback.createSession(s);
    await client.query(
      `insert into app_session (token, user_id, created_at, expires_at)
         values ($1, $2, $3, $4)`,
      [s.token, s.userId, new Date(s.createdAt), new Date(s.expiresAt)],
    );
  }

  async getSession(token: string): Promise<AppSession | null> {
    const client = await this.getClient();
    if (!client) return this.fallback.getSession(token);
    const res = await client.query<{
      token: string;
      user_id: string;
      created_at: Date;
      expires_at: Date;
    }>(
      `select token, user_id, created_at, expires_at
         from app_session
        where token = $1 and expires_at > now() limit 1`,
      [token],
    );
    const row = res.rows[0];
    if (!row) return null;
    return {
      token: row.token,
      userId: row.user_id,
      createdAt: new Date(row.created_at).getTime(),
      expiresAt: new Date(row.expires_at).getTime(),
    };
  }

  async deleteSession(token: string): Promise<void> {
    const client = await this.getClient();
    if (!client) return this.fallback.deleteSession(token);
    await client.query('delete from app_session where token = $1', [token]);
  }

  async deleteAllSessionsForUser(userId: string): Promise<void> {
    const client = await this.getClient();
    if (!client) return this.fallback.deleteAllSessionsForUser(userId);
    await client.query('delete from app_session where user_id = $1', [userId]);
  }
}

// ============================================================
//  Boot pick
// ============================================================

export function pickAuthStore(): AuthStore {
  const url = process.env.DATABASE_URL;
  if (url?.trim()) return new PgAuthStore(url);
  return new MemoryAuthStore();
}
