#!/usr/bin/env bun
/**
 * morbius-tune — one-shot CLI that drives the continuous-learning
 * loop end-to-end against the running API:
 *
 *   1. Fetch /dev/activity to pull the latest agent telemetry.
 *   2. Fetch the seed memory from a synthetic corpus the script
 *      builds from the in-tree SEED_CASES (so this works without a
 *      live browser session writing to IndexedDB).
 *   3. For each specialist, generate a TuneProposal via the
 *      deterministic refiner (no LLM call → hermetic + offline-safe).
 *   4. Hit POST /dev/calibrate to refresh gauntlet thresholds.
 *   5. Print a status table + write proposals to
 *      `docs/status/tune-<date>.json` so progress is git-visible.
 *
 * Usage:
 *   bun run morbius:tune                     # default localhost:8787
 *   API_BASE=https://… bun run morbius:tune  # against deployed API
 *
 * The script is read-only against the API except for /dev/calibrate.
 * Approved tune proposals still require an operator click in the
 * dev console — this CLI only generates + reports them.
 */

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SEED_CASES } from '../apps/web/src/lib/case-seed.ts';
import {
  type GauntletStage,
  SPECIALTY_PROMPTS,
  type SpecialtyId,
  type StageStats,
  proposeNewPrefix,
} from '../packages/agents/src/index.ts';

const API_BASE = process.env.API_BASE ?? 'http://localhost:8787';
const DEV_HEADERS = { 'X-Dr-Abc-Role': 'developer', 'content-type': 'application/json' };

interface ActivityEntry {
  ts?: number;
  action?: string;
  status?: string;
  payload?: { stage?: string; verdict?: string };
}

async function tryFetch<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const r = await fetch(url, init);
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

function fmt(n: number, w = 6): string {
  return String(n).padStart(w, ' ');
}

async function main() {
  const startedAt = Date.now();
  console.log('\n┌─────────────────────────────────────────────────────────┐');
  console.log('│  morbius-tune · continuous-learning cycle              │');
  console.log('└─────────────────────────────────────────────────────────┘');
  console.log(`API_BASE = ${API_BASE}\n`);

  // 1. Pull activity (best-effort).
  const activity = await tryFetch<{ entries: ActivityEntry[] }>(
    `${API_BASE}/dev/activity?limit=1000`,
    {
      headers: DEV_HEADERS,
    },
  );
  const entries = activity?.entries ?? [];
  console.log(`▸ pulled ${entries.length} activity entries`);

  // 2. Build a synthetic corpus from SEED_CASES — every case becomes
  //    one TunerExemplar grouped by specialty. In a live session the
  //    web app uses the real corpus from IndexedDB; this CLI replays
  //    the seed dataset so the loop is exercisable from a clean repo.
  const exemplarsBySpecialty = new Map<SpecialtyId, Parameters<typeof proposeNewPrefix>[2]>();
  for (const c of SEED_CASES) {
    const specialty = normaliseSpec(c.specialty);
    if (!specialty) continue;
    const list = exemplarsBySpecialty.get(specialty) ?? [];
    list.push({
      id: c.id,
      input: c.chiefComplaint,
      groundTruth: c.diagnosis,
      icd10: c.icd10.slice(0, 3),
      drugs: c.drugs,
    });
    exemplarsBySpecialty.set(specialty, list);
  }
  console.log(`▸ built corpus across ${exemplarsBySpecialty.size} specialties`);

  // 3. Generate proposals.
  const proposals: Array<{
    specialty: SpecialtyId;
    proposedPrefix: string;
    rationale: string;
    expectedAccuracyDelta: number;
    proposedPrefixChars: number;
    exemplarCount: number;
    currentPrefix: string;
    generatedAt: string;
  }> = [];
  for (const [spec, exemplars] of exemplarsBySpecialty.entries()) {
    const proposal = await proposeNewPrefix(spec, SPECIALTY_PROMPTS[spec], exemplars);
    proposals.push({
      specialty: proposal.specialty,
      proposedPrefix: proposal.proposedPrefix,
      rationale: proposal.rationale,
      expectedAccuracyDelta: proposal.expectedAccuracyDelta,
      proposedPrefixChars: proposal.proposedPrefixChars,
      exemplarCount: proposal.exemplars.length,
      currentPrefix: proposal.currentPrefix,
      generatedAt: proposal.generatedAt,
    });
  }
  console.log(`▸ generated ${proposals.length} tune proposals\n`);

  // 4. Calibrate thresholds (best-effort — 403 if dev-role missing).
  const cal = await tryFetch<{
    ok?: boolean;
    thresholds?: Record<GauntletStage, number>;
    notes?: Array<{ stage: GauntletStage; delta: number; reason: string }>;
    error?: string;
  }>(`${API_BASE}/dev/calibrate`, { method: 'POST', headers: DEV_HEADERS, body: '{}' });
  if (cal?.ok) {
    console.log('▸ calibration cycle ran');
    for (const note of cal.notes ?? []) {
      const delta =
        note.delta === 0
          ? '─'
          : note.delta > 0
            ? `+${note.delta.toFixed(2)}`
            : note.delta.toFixed(2);
      console.log(`    ${note.stage.padEnd(10)} ${delta.padStart(6)}  ${note.reason}`);
    }
    console.log('');
  } else {
    console.log('▸ calibration skipped (API unreachable or non-developer role)\n');
  }

  // 5. Print + persist.
  console.log('┌─────────────────────────────────────────────────────────┐');
  console.log('│  PROPOSALS                                              │');
  console.log('├──────────────────┬─────────┬────────┬───────────────────┤');
  console.log('│ specialty        │  +Δpp   │  chars │ rationale         │');
  console.log('├──────────────────┼─────────┼────────┼───────────────────┤');
  for (const p of proposals) {
    console.log(
      `│ ${p.specialty.padEnd(16)} │ ${fmt(p.expectedAccuracyDelta, 6)}  │ ${fmt(p.proposedPrefixChars, 5)}  │ ${p.rationale.slice(0, 17).padEnd(17)} │`,
    );
  }
  console.log('└──────────────────┴─────────┴────────┴───────────────────┘\n');

  const reportPath = join(
    process.cwd(),
    'docs',
    'status',
    `tune-${new Date().toISOString().slice(0, 10)}.json`,
  );
  await writeFile(
    reportPath,
    JSON.stringify(
      {
        ranAt: new Date(startedAt).toISOString(),
        durationMs: Date.now() - startedAt,
        apiBase: API_BASE,
        activityEntries: entries.length,
        gauntletThresholds: cal?.thresholds ?? null,
        calibrationNotes: cal?.notes ?? null,
        proposals,
      },
      null,
      2,
    ),
  );
  console.log(`▸ wrote ${reportPath}`);
  console.log(`▸ done in ${Date.now() - startedAt} ms\n`);
}

function normaliseSpec(raw: string): SpecialtyId | null {
  const s = raw.toLowerCase();
  if (s.startsWith('cardio')) return 'cardiology';
  if (s.startsWith('neuro')) return 'neurology';
  if (s.startsWith('onco')) return 'oncology';
  if (s.startsWith('pulmo') || s.startsWith('pulm')) return 'pulmonology';
  if (s.startsWith('endo')) return 'endocrinology';
  if (s.startsWith('derm')) return 'dermatology';
  return null;
}

main().catch((err) => {
  console.error('morbius-tune failed:', err);
  process.exit(1);
});
