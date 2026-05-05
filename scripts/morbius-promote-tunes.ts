#!/usr/bin/env bun
/**
 * morbius-promote-tunes — ship the deterministic tuner's queued
 * specialist-prompt proposals into the live SPECIALTY_PROMPTS table,
 * with the safeguards AGENTS.md §10 demands.
 *
 *   bun run scripts/morbius-promote-tunes.ts            # promote latest tune-*.json
 *   bun run scripts/morbius-promote-tunes.ts --dry-run  # show what would ship, don't write
 *   bun run scripts/morbius-promote-tunes.ts --file <path>  # promote a specific tune file
 *
 * Auto-promotion of queued proposals is enabled. AGENTS.md §10
 * standing rule still holds:
 *
 *   - bounded magnitude: skip if expectedAccuracyDelta < 1.0 pp
 *   - bounded prompt size: skip if proposedPrefix > 1200 chars
 *     (small open models choke on long prefixes)
 *   - exemplar-grounded only: skip if exemplarCount < 1
 *   - allowlist specialty: skip if specialty isn't in the 6 known
 *     SpecialtyId values
 *   - red-flag pathway carve-out: never auto-promote on a specialty
 *     whose latest proposal contains an obvious harm signal
 *   - per-cycle cap: at most 6 promotions per run (one per specialty)
 *
 * Audit:
 *   - docs/status/tune-promoted-YYYY-MM-DDTHH-MM.json  — what shipped
 *   - docs/status/tune-promoted-history.jsonl          — append-only
 *     log with the previous prefix preserved, so a follow-up revert
 *     script can roll back without git-blaming.
 */

import { appendFile, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const REPO = process.cwd();
const STATUS_DIR = join(REPO, 'docs/status');
const PROMPTS_FILE = join(REPO, 'packages/agents/src/specialists/prompts.ts');
const HISTORY_FILE = join(STATUS_DIR, 'tune-promoted-history.jsonl');

const KNOWN_SPECIALTIES = new Set([
  'cardiology',
  'neurology',
  'oncology',
  'pulmonology',
  'endocrinology',
  'dermatology',
]);

const MIN_DELTA = 1.0;
const MAX_PREFIX_CHARS = 1_200;
const MAX_PROMOTIONS = 6;

interface Proposal {
  specialty: string;
  proposedPrefix: string;
  rationale: string;
  expectedAccuracyDelta: number;
  proposedPrefixChars: number;
  exemplarCount: number;
  currentPrefix: string;
  generatedAt: string;
}

interface TuneSnapshot {
  ranAt: string;
  apiBase?: string;
  proposals: Proposal[];
}

interface PromoteVerdict {
  ship: boolean;
  reason: string;
}

function vet(p: Proposal): PromoteVerdict {
  if (!KNOWN_SPECIALTIES.has(p.specialty)) {
    return { ship: false, reason: `specialty '${p.specialty}' not in allowlist` };
  }
  if (typeof p.proposedPrefix !== 'string' || p.proposedPrefix.length === 0) {
    return { ship: false, reason: 'empty proposedPrefix' };
  }
  if (p.proposedPrefix.length > MAX_PREFIX_CHARS) {
    return {
      ship: false,
      reason: `proposedPrefix ${p.proposedPrefix.length} chars > ${MAX_PREFIX_CHARS} cap`,
    };
  }
  if (typeof p.expectedAccuracyDelta !== 'number' || p.expectedAccuracyDelta < MIN_DELTA) {
    return {
      ship: false,
      reason: `expectedAccuracyDelta ${p.expectedAccuracyDelta} < ${MIN_DELTA} pp threshold`,
    };
  }
  if ((p.exemplarCount ?? 0) < 1) {
    return { ship: false, reason: 'exemplarCount < 1 (not grounded in real misses)' };
  }
  // Red-flag carve-out: never auto-promote a proposal whose rationale
  // contains a phrase that suggests it's reversing a safety signal.
  // Keeps the meta-agent honest: we don't dim red-flag pathways
  // through the tuner.
  const dangerSignals = /\bskip\b|\bignore\b|\bbypass\b|\bdisable\b/i;
  if (dangerSignals.test(p.rationale) || dangerSignals.test(p.proposedPrefix)) {
    return { ship: false, reason: 'rationale or prefix contains a danger signal' };
  }
  return { ship: true, reason: 'cleared all gates' };
}

async function latestTuneFile(): Promise<string | null> {
  const files = await readdir(STATUS_DIR).catch(() => [] as string[]);
  const matches = files
    .filter((f) => /^tune-\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()
    .reverse();
  return matches[0] ? join(STATUS_DIR, matches[0]) : null;
}

function patchPrompts(source: string, specialty: string, newPrefix: string): string {
  // Find:   <specialty>: `<old>`,
  // Replace the template-literal body. Use a sentinel match — the
  // backtick is opened on one line and closed before a newline+comma.
  const re = new RegExp(`(\\b${specialty}: \`)([\\s\\S]*?)(\`,)`, 'm');
  if (!re.test(source)) {
    throw new Error(`could not locate ${specialty}: \`...\` block in prompts.ts`);
  }
  // Guard: escape any backticks inside the new prefix so we don't
  // accidentally close the template literal early.
  const safe = newPrefix.replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
  return source.replace(re, `$1${safe}$3`);
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const fileArgIdx = process.argv.indexOf('--file');
  const inputPath = fileArgIdx >= 0 ? process.argv[fileArgIdx + 1] : await latestTuneFile();
  if (!inputPath) {
    console.error('no tune-*.json found in docs/status/');
    process.exit(1);
  }

  console.log(`▸ reading ${inputPath}`);
  const txt = await readFile(inputPath, 'utf8');
  const snap = JSON.parse(txt) as TuneSnapshot;
  if (!snap.proposals || snap.proposals.length === 0) {
    console.log('  no proposals in this snapshot · nothing to promote.');
    process.exit(0);
  }

  // Dedupe by specialty: latest proposal per specialty wins, since the
  // tuner can emit multiple proposals if it ran across cycles.
  const latestBySpec = new Map<string, Proposal>();
  for (const p of snap.proposals) {
    const prior = latestBySpec.get(p.specialty);
    if (!prior || new Date(p.generatedAt) > new Date(prior.generatedAt)) {
      latestBySpec.set(p.specialty, p);
    }
  }

  const ship: Proposal[] = [];
  const skip: Array<{ p: Proposal; reason: string }> = [];
  for (const p of latestBySpec.values()) {
    const v = vet(p);
    if (v.ship && ship.length < MAX_PROMOTIONS) {
      ship.push(p);
    } else {
      skip.push({ p, reason: v.reason });
    }
  }

  console.log(`▸ ${ship.length} ship · ${skip.length} skip\n`);
  for (const s of skip) {
    console.log(`  skip ${s.p.specialty}: ${s.reason}`);
  }
  for (const p of ship) {
    console.log(
      `  ship ${p.specialty}: +${p.expectedAccuracyDelta} pp · ${p.proposedPrefixChars} chars`,
    );
  }
  console.log();

  if (ship.length === 0) {
    console.log('nothing cleared the gates · exiting clean.');
    process.exit(0);
  }

  if (dryRun) {
    console.log('--dry-run · no files written.');
    process.exit(0);
  }

  // Patch prompts.ts one specialty at a time, in order.
  let source = await readFile(PROMPTS_FILE, 'utf8');
  for (const p of ship) {
    source = patchPrompts(source, p.specialty, p.proposedPrefix);
    await appendFile(
      HISTORY_FILE,
      `${JSON.stringify({
        ts: new Date().toISOString(),
        specialty: p.specialty,
        previousPrefix: p.currentPrefix,
        promotedPrefix: p.proposedPrefix,
        expectedAccuracyDelta: p.expectedAccuracyDelta,
        source: inputPath,
      })}\n`,
    );
  }
  await writeFile(PROMPTS_FILE, source, 'utf8');

  // Audit snapshot — one per promote run, dated to the minute.
  const stamp = new Date().toISOString().slice(0, 16).replace(':', '-');
  const auditPath = join(STATUS_DIR, `tune-promoted-${stamp}.json`);
  await writeFile(
    auditPath,
    JSON.stringify(
      {
        promotedAt: new Date().toISOString(),
        sourceSnapshot: inputPath,
        promotions: ship.map((p) => ({
          specialty: p.specialty,
          expectedAccuracyDelta: p.expectedAccuracyDelta,
          rationale: p.rationale,
          previousPrefixChars: p.currentPrefix.length,
          promotedPrefixChars: p.proposedPrefix.length,
        })),
        skipped: skip.map((s) => ({ specialty: s.p.specialty, reason: s.reason })),
        promptsFile: PROMPTS_FILE,
      },
      null,
      2,
    ),
  );

  console.log(`▸ patched ${PROMPTS_FILE}`);
  console.log(`▸ wrote ${auditPath}`);
  console.log(`▸ history appended to ${HISTORY_FILE}`);
  console.log('\nNext: run the harness to measure the lift:');
  console.log('  bun run morbius:accuracy');
  console.log('  bun run morbius:medqa -- --limit 80');
}

void main();
