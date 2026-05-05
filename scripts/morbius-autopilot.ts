#!/usr/bin/env bun
/**
 * morbius-autopilot — the always-on growth daemon.
 *
 * Mörbius is meant to behave like a real on-call doctor: it sees real
 * cases, reflects on what worked, sharpens its prompts, and the next
 * patient gets a slightly better answer. This is designed to
 * happen continuously without anyone running CLIs by hand.
 *
 * This script is the loop that closes that learning gap. Every
 * `INTERVAL_MS` (default 30 min) it:
 *
 *   1. Probes the live API + cloud backends. Records reachability.
 *   2. Runs the accuracy harness against the 15-case seed (cheap,
 *      < 90 s with cloud LLM, < 5 min on Ollama).
 *   3. Writes a compact `live-accuracy.json` snapshot the dev console's
 *      Models tab pulls from — so the published-benchmarks comparison
 *      shows a real-time number, not a static one from a paper.
 *   4. Maintains a rolling 96-point ring buffer (~2 days at 30 min
 *      cadence) at `live-accuracy-history.json` so the UI can render a
 *      trend line.
 *   5. (Optional, behind --tune flag) runs the prompt tuner and queues
 *      proposals. An operator approves before they ship.
 *
 * Run modes:
 *
 *   bun run morbius:autopilot                # 30-min loop, harness only
 *   bun run morbius:autopilot --interval 5m  # custom cadence
 *   bun run morbius:autopilot --once         # single cycle, then exit
 *   bun run morbius:autopilot --tune         # also run the tuner each cycle
 *
 * Run forever in dev with:
 *   bun run morbius:autopilot
 *
 * Run as a sidecar machine on Fly.io:
 *   fly machine run --schedule="*\/30 * * * *" \
 *     "bun run morbius:autopilot --once" \
 *     -e API_BASE=https://morbius-api.fly.dev
 *
 * Run as a Windows scheduled task: see docs/always-on-autopilot.md.
 */

import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

// ────────────────────────────────────────────────────────────────────
//  CLI
// ────────────────────────────────────────────────────────────────────

interface Opts {
  intervalMs: number;
  once: boolean;
  tune: boolean;
  apiBase: string;
}

function parseArgs(argv: string[]): Opts {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const intervalRaw = get('--interval') ?? '30m';
  const m = intervalRaw.match(/^(\d+)(s|m|h)?$/);
  if (!m) throw new Error(`invalid --interval: ${intervalRaw}`);
  const n = Number(m[1]);
  const unit = m[2] ?? 'm';
  const intervalMs = n * (unit === 's' ? 1000 : unit === 'm' ? 60_000 : 3_600_000);
  return {
    intervalMs,
    once: argv.includes('--once'),
    tune: argv.includes('--tune'),
    apiBase: process.env.API_BASE ?? 'http://localhost:8787',
  };
}

const opts = parseArgs(process.argv.slice(2));

// ────────────────────────────────────────────────────────────────────
//  Live accuracy snapshot — what the dev console reads
// ────────────────────────────────────────────────────────────────────

interface LiveAccuracySnapshot {
  ts: string;
  cycleSeq: number;
  apiBase: string;
  diagnosticBackend: string | null;
  caseCount: number;
  metrics: {
    topConditionRate: number;
    icdPrefixRate: number;
    icdKnownRate: number;
    specialtyRate: number;
    gauntletPassRate: number;
    p50LatencyMs: number;
    p95LatencyMs: number;
    meanLatencyMs: number;
    errorCount: number;
  };
  /** MedQA / USMLE-style multiple-choice score — apples-to-apples with
   *  the published benchmarks. null when the harness hasn't run yet. */
  medqa: {
    accuracy: number;
    correct: number;
    total: number;
    ranAt: string;
  } | null;
  /** Best published benchmarks Mörbius is racing. Updated when papers
   *  drop; the comparison table lives here so the autopilot's next
   *  cycle re-renders it with the live row recomputed. */
  competitors: Array<{ model: string; vendor: string; medQa: number; year: number }>;
  durationMs: number;
}

const COMPETITORS: LiveAccuracySnapshot['competitors'] = [
  { model: 'Med-Gemini', vendor: 'Google', medQa: 0.913, year: 2024 },
  { model: 'Med-PaLM 2', vendor: 'Google', medQa: 0.866, year: 2023 },
  { model: 'GPT-4 medical', vendor: 'OpenAI / Microsoft', medQa: 0.86, year: 2023 },
  { model: 'BioGPT', vendor: 'Microsoft Research', medQa: 0.78, year: 2022 },
  { model: 'OpenBioLLM-70B', vendor: 'Saama', medQa: 0.74, year: 2024 },
  { model: 'Meditron-70B', vendor: 'EPFL', medQa: 0.704, year: 2023 },
];

const REPO = process.cwd();
const STATUS_DIR = join(REPO, 'docs', 'status');
const LIVE_PATH = join(STATUS_DIR, 'live-accuracy.json');
const HISTORY_PATH = join(STATUS_DIR, 'live-accuracy-history.json');
const HISTORY_CAP = 96;

async function loadHistory(): Promise<LiveAccuracySnapshot[]> {
  try {
    const text = await readFile(HISTORY_PATH, 'utf8');
    const arr = JSON.parse(text) as LiveAccuracySnapshot[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function saveSnapshots(latest: LiveAccuracySnapshot, history: LiveAccuracySnapshot[]) {
  await mkdir(dirname(LIVE_PATH), { recursive: true });
  await writeFile(LIVE_PATH, JSON.stringify(latest, null, 2));
  const next = [...history, latest].slice(-HISTORY_CAP);
  await writeFile(HISTORY_PATH, JSON.stringify(next, null, 2));
}

// ────────────────────────────────────────────────────────────────────
//  Subprocess helpers
// ────────────────────────────────────────────────────────────────────

function run(cmd: string, args: string[], env?: Record<string, string>): Promise<number> {
  return new Promise((resolve) => {
    // Bun's child_process.spawn returns a ChildProcess whose typings
    // come from @types/node. The shape is narrow enough that we treat
    // it as an EventEmitter for the close event.
    const proc = spawn(cmd, args, {
      stdio: 'inherit',
      shell: true,
      env: { ...process.env, ...(env ?? {}) },
    }) as unknown as { on: (ev: 'close', cb: (code: number | null) => void) => void };
    proc.on('close', (code: number | null) => resolve(code ?? -1));
  });
}

async function readLatestMedQaReport(): Promise<LiveAccuracySnapshot['medqa']> {
  const fs = await import('node:fs/promises');
  const files = await fs.readdir(STATUS_DIR).catch(() => []);
  const candidates = files
    .filter((f) => f.startsWith('medqa-') && f.endsWith('.json'))
    .sort()
    .reverse();
  if (candidates.length === 0) return null;
  const latestFile = candidates[0];
  if (!latestFile) return null;
  try {
    const text = await fs.readFile(join(STATUS_DIR, latestFile), 'utf8');
    const j = JSON.parse(text) as {
      ranAt: string;
      questionCount: number;
      metrics: { accuracy: number };
      questions: Array<{ correct: boolean }>;
    };
    return {
      accuracy: j.metrics.accuracy,
      correct: j.questions.filter((q) => q.correct).length,
      total: j.questionCount,
      ranAt: j.ranAt,
    };
  } catch {
    return null;
  }
}

async function readLatestHarnessReport(): Promise<{
  ts: string;
  metrics: LiveAccuracySnapshot['metrics'];
  caseCount: number;
  durationMs: number;
} | null> {
  // Find the newest accuracy-YYYY-MM-DD.json in docs/status/.
  const fs = await import('node:fs/promises');
  const files = await fs.readdir(STATUS_DIR).catch(() => []);
  const candidates = files
    .filter((f) => f.startsWith('accuracy-') && f.endsWith('.json'))
    .sort()
    .reverse();
  if (candidates.length === 0) return null;
  const latestFile = candidates[0];
  if (!latestFile) return null;
  const text = await fs.readFile(join(STATUS_DIR, latestFile), 'utf8');
  const j = JSON.parse(text) as {
    ranAt: string;
    durationMs: number;
    caseCount: number;
    metrics: LiveAccuracySnapshot['metrics'];
  };
  return { ts: j.ranAt, metrics: j.metrics, caseCount: j.caseCount, durationMs: j.durationMs };
}

async function probeBackend(): Promise<string | null> {
  try {
    const r = await fetch(`${opts.apiBase}/health`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;
    const j = (await r.json()) as { diagnosticBackend?: string };
    return j.diagnosticBackend ?? null;
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────────────────────────────
//  One cycle
// ────────────────────────────────────────────────────────────────────

let cycleSeq = 0;

async function runOneCycle(): Promise<void> {
  cycleSeq += 1;
  const startedAt = Date.now();
  const stamp = new Date().toISOString();
  console.log(`\n━━━ autopilot cycle #${cycleSeq} · ${stamp} ━━━`);

  const backend = await probeBackend();
  if (backend === null) {
    console.warn(`✗ API unreachable at ${opts.apiBase} — skipping this cycle.`);
    return;
  }
  console.log(`  diagnostic backend: ${backend}`);

  // 1. Run accuracy harness (writes its own JSON to docs/status/)
  console.log('  → running morbius:accuracy');
  const harnessExit = await run('bun', ['run', 'scripts/accuracy-harness.ts'], {
    API_BASE: opts.apiBase,
  });
  if (harnessExit !== 0) {
    console.warn(`  ✗ accuracy harness exited ${harnessExit}`);
  }

  // 2. MedQA harness — multi-choice clinical questions. Apples-to-
  //    apples with the published frontier (Med-PaLM 2 / Med-Gemini /
  //    GPT-4 medical / BioGPT). Cheap (~30 questions × few seconds).
  console.log('  → running morbius:medqa');
  await run('bun', ['run', 'scripts/medqa-harness.ts'], { API_BASE: opts.apiBase });

  // 3. Optional: prompt tuner
  if (opts.tune) {
    console.log('  → running morbius:tune (proposals queue for architect approval)');
    await run('bun', ['run', 'scripts/morbius-tune.ts']);

    // 3b. Meta-agent: Mörbius proposes its own training sub-agents
    // from the freshly-written accuracy snapshot, Veronica scores
    // them, survivors append to the same tune queue so the existing
    // morbius-promote-tunes flow stays the single gatekeeper.
    console.log('  → running morbius:meta (self-spawn proposals · Veronica scored)');
    await run('bun', ['run', 'scripts/morbius-meta-agent.ts']);
  }

  // 4. Roll the latest harness reports into live-accuracy.json
  const latest = await readLatestHarnessReport();
  const medqa = await readLatestMedQaReport();
  if (!latest) {
    console.warn('  ✗ no accuracy-*.json found — live snapshot not updated');
    return;
  }
  const snapshot: LiveAccuracySnapshot = {
    ts: latest.ts,
    cycleSeq,
    apiBase: opts.apiBase,
    diagnosticBackend: backend,
    caseCount: latest.caseCount,
    metrics: latest.metrics,
    medqa,
    competitors: COMPETITORS,
    durationMs: Date.now() - startedAt,
  };
  const history = await loadHistory();
  await saveSnapshots(snapshot, history);

  const live = snapshot.metrics;
  const topPct = (live.topConditionRate * 100).toFixed(1);
  const icdPct = (live.icdPrefixRate * 100).toFixed(1);
  const specPct = (live.specialtyRate * 100).toFixed(1);
  const ranking = [
    { model: 'Mörbius (live)', score: live.topConditionRate },
    ...COMPETITORS.map((c) => ({ model: c.model, score: c.medQa })),
  ].sort((a, b) => b.score - a.score);
  const myRank = ranking.findIndex((r) => r.model === 'Mörbius (live)') + 1;

  console.log('  ✓ live snapshot saved');
  console.log(`    top-condition ${topPct}% · ICD ${icdPct}% · specialty ${specPct}%`);
  console.log(`    rank: ${myRank} / ${ranking.length} (vs published benchmarks)`);
  console.log(`    history points stored: ${history.length + 1} / ${HISTORY_CAP}`);
}

// ────────────────────────────────────────────────────────────────────
//  Main loop
// ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🤖 Mörbius autopilot');
  console.log(`   api base       : ${opts.apiBase}`);
  console.log(`   cycle interval : ${opts.intervalMs / 1000}s`);
  console.log(`   tune each cycle: ${opts.tune ? 'yes' : 'no'}`);
  console.log(`   mode           : ${opts.once ? 'one-shot' : 'forever'}`);

  await runOneCycle().catch((e) => console.error('cycle failed:', e));

  if (opts.once) {
    console.log('\n✓ one-shot mode complete · exiting');
    return;
  }

  console.log(`\n⏳ next cycle in ${opts.intervalMs / 1000}s · Ctrl+C to stop`);
  setInterval(() => {
    void runOneCycle().catch((e) => console.error('cycle failed:', e));
  }, opts.intervalMs);
}

void main();
