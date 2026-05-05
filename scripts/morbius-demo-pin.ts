import { existsSync } from 'node:fs';
/**
 * morbius-demo-pin -- one-shot writer that pins the NVIDIA cascade
 * into the repo-root .env file so the demo backend survives an API
 * restart.
 *
 * Closes the P0 from NEXT-STEPS.md:
 *   "NVIDIA pin survives API restart. Cascade falls to Ollama when
 *    the API restarts and the pin is lost. Persist MORBIUS_BACKEND=nvidia
 *    to .env so it boots pinned."
 *
 * Same in-place rewrite shape as /dev/env-persist (apps/api/src/server.ts)
 * but no API process required -- safe to run from a cold start.
 *
 * What it pins:
 *   MORBIUS_BACKEND=nvidia                       (single-pin)
 *   BACKEND_PRIORITY=nvidia,huggingface,anthropic,ollama
 *   MORBIUS_IMAGING=anthropic                    (skips py-svc which is
 *                                                 down on the local box)
 *
 * The standing rule on local-first DEFAULT_BACKEND_PRIORITY is preserved
 * -- this writes per-deploy overrides into .env, not into the code default.
 * (CLAUDE.md s10: "Override per-deploy with MORBIUS_BACKEND= or BACKEND_PRIORITY=".)
 *
 * Run:
 *   bun run morbius:demo-pin
 *
 * Or invoke directly:
 *   bun run scripts/morbius-demo-pin.ts
 *
 * Unpin (revert to local-first default):
 *   bun run morbius:demo-pin --unpin
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const DEMO_PINS: Record<string, string> = {
  MORBIUS_BACKEND: 'nvidia',
  BACKEND_PRIORITY: 'nvidia,huggingface,anthropic,ollama',
  MORBIUS_IMAGING: 'anthropic',
};

const UNPIN_KEYS = ['MORBIUS_BACKEND', 'BACKEND_PRIORITY', 'MORBIUS_IMAGING'];

async function main(): Promise<void> {
  const repoRoot = resolve(import.meta.dir, '..');
  const envPath = resolve(repoRoot, '.env');
  const unpin = process.argv.includes('--unpin');

  if (!existsSync(envPath)) {
    console.error(`[demo-pin] no .env at ${envPath}`);
    console.error('[demo-pin] run bootstrap.ps1 first to seed the file, then re-run this script');
    process.exit(1);
  }

  const original = await readFile(envPath, 'utf8');

  // Validate .env shape BEFORE rewriting. Bun's env-loader aborts the
  // whole CLI when a line isn't blank / comment / KEY=VALUE -- which
  // makes `bun install` and `bun run dev` fail with cryptic `[0.31ms]
  // ".env"` errors. Surface bad lines here with line numbers so the
  // operator can spot the orphan prose / typo immediately.
  const badLines: { lineNo: number; text: string }[] = [];
  for (const [idx, raw] of original.split(/\r?\n/).entries()) {
    const t = raw.trim();
    if (!t || t.startsWith('#')) continue;
    if (!/^[A-Z_][A-Z0-9_]*=/i.test(t)) {
      badLines.push({ lineNo: idx + 1, text: raw });
    }
  }
  if (badLines.length > 0) {
    console.error('[demo-pin] .env has lines that are not blank / comment / KEY=VALUE:');
    for (const b of badLines) {
      console.error(`[demo-pin]   line ${b.lineNo}: ${b.text}`);
    }
    console.error('[demo-pin] fix or delete those lines, then re-run.');
    console.error('[demo-pin] (Bun will refuse to start any command while these are present.)');
    process.exit(1);
  }

  // Back up the existing .env before rewriting.
  const backupPath = `${envPath}.bak.${Date.now()}`;
  await writeFile(backupPath, original, 'utf8');

  const lines = original.split(/\r?\n/);
  const desired = unpin ? {} : DEMO_PINS;
  const targetKeys = unpin ? new Set(UNPIN_KEYS) : new Set(Object.keys(desired));
  const seen = new Set<string>();
  const next: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      next.push(line);
      continue;
    }
    const match = trimmed.match(/^([A-Z][A-Z0-9_]*)=/);
    const key = match?.[1];
    if (key && targetKeys.has(key)) {
      seen.add(key);
      if (unpin) {
        // Drop the line entirely on --unpin (back to defaults).
        continue;
      }
      next.push(`${key}=${desired[key] ?? ''}`);
      continue;
    }
    next.push(line);
  }

  if (!unpin) {
    // Append any pin keys that weren't already in the file.
    let appendedHeader = false;
    for (const [key, value] of Object.entries(desired)) {
      if (seen.has(key)) continue;
      if (!appendedHeader) {
        next.push('');
        next.push('# Demo-day pin written by `bun run morbius:demo-pin`.');
        next.push('# Unpin with `bun run morbius:demo-pin -- --unpin`.');
        appendedHeader = true;
      }
      next.push(`${key}=${value}`);
    }
  }

  await writeFile(envPath, next.join('\n'), 'utf8');

  console.log(`[demo-pin] ${unpin ? 'unpinned' : 'pinned'} .env`);
  console.log(`[demo-pin]   path:   ${envPath}`);
  console.log(`[demo-pin]   backup: ${backupPath}`);
  if (!unpin) {
    for (const [k, v] of Object.entries(desired)) {
      console.log(`[demo-pin]   ${k}=${v}`);
    }
  }
  console.log('[demo-pin] restart bun run dev for the new pin to take effect');
}

main().catch((err) => {
  console.error('[demo-pin] failed:', err);
  process.exit(1);
});
