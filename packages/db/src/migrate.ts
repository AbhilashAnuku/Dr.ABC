/**
 * @dr-abc/db migrate -- apply every .sql file in ../migrations/ in
 * lexical order against DATABASE_URL.
 *
 * Idempotent: every migration uses CREATE TABLE IF NOT EXISTS /
 * CREATE INDEX IF NOT EXISTS so re-runs are safe. A
 * `_drizzle_migrations` ledger tracks which files have already
 * been applied so we don't re-execute on every boot.
 *
 * Why this instead of drizzle-kit migrate?
 *   drizzle-kit pulls the network on first run to fetch its CLI
 *   bundle and the local-first rule keeps optional cloud
 *   deps out of the boot path. A 60-line bun script is enough.
 *
 * Run via:
 *   bun run db:migrate
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const migrationsDir = resolve(here, '..', 'migrations');

type PgClient = {
  query(sql: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
  end(): Promise<void>;
};
type PoolCtor = new (cfg: { connectionString: string }) => PgClient;

async function loadClient(databaseUrl: string): Promise<PgClient | null> {
  // Optional peer dep; @ts-ignore suppresses TS2307 in CI.
  // @ts-ignore optional peer dep
  const pgMod = (await import('pg').catch(() => null)) as { Client: PoolCtor } | null;
  if (!pgMod) return null;
  const client = new pgMod.Client({ connectionString: databaseUrl });
  // node-pg Client has connect(); call it lazily without typing the surface
  // (Bun forwards it).
  await (client as unknown as { connect(): Promise<void> }).connect();
  return client;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required for db:migrate');
  const client = await loadClient(url);
  if (!client) {
    throw new Error('pg not installed -- run `bun add pg @types/pg` in packages/db');
  }

  await client.query(`
    CREATE TABLE IF NOT EXISTS "_drizzle_migrations" (
      "file"        text         PRIMARY KEY,
      "applied_at"  timestamptz  NOT NULL DEFAULT now()
    )
  `);

  const applied = new Set(
    (await client.query('SELECT "file" FROM "_drizzle_migrations"')).rows.map(
      (r) => r.file as string,
    ),
  );

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  let appliedCount = 0;
  for (const f of files) {
    if (applied.has(f)) {
      console.log(`[db:migrate] skip   ${f} (already applied)`);
      continue;
    }
    const sql = readFileSync(join(migrationsDir, f), 'utf8');
    console.log(`[db:migrate] apply  ${f}`);
    await client.query(sql);
    await client.query('INSERT INTO "_drizzle_migrations" ("file") VALUES ($1)', [f]);
    appliedCount++;
  }

  console.log(
    `[db:migrate] done -- ${appliedCount} new migration${appliedCount === 1 ? '' : 's'} applied`,
  );
  await client.end();
}

main().catch((err) => {
  console.error('[db:migrate] failed:', err);
  process.exit(1);
});
