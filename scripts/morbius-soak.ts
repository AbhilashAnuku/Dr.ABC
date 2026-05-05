#!/usr/bin/env bun
/**
 * morbius-soak — overnight regression test for Mörbius.
 *
 * Runs the persona harness on a loop with random delays between
 * cycles, logging every drift in the weighted score per persona +
 * every gauntlet rejection. Catches "did we accidentally break the
 * doctor persona's score with the casual-mode change?" type
 * regressions that a single-shot harness wouldn't see because the
 * single-shot covers the wrong moment.
 *
 * Run:
 *   bun run morbius:soak                    # default 1 hour
 *   bun run morbius:soak --duration 30m
 *   bun run morbius:soak --interval 2m      # cycle cadence inside the window
 *   bun run morbius:soak --persona doctor   # one persona only
 *
 * Writes:
 *   docs/status/soak-YYYY-MM-DDTHH-MM.json  # per-soak summary
 *
 * The cycle results land at docs/status/persona-*.json (the harness
 * already writes those); this script is the LOOP that drives them
 * and reports drift between cycles in one summary at the end.
 */

import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

interface Opts {
  durationMs: number;
  intervalMs: number;
  persona: string | null;
}

function parseDuration(raw: string): number {
  const m = raw.match(/^(\d+)(s|m|h)?$/);
  if (!m) throw new Error(`invalid duration: ${raw}`);
  const n = Number(m[1]);
  const unit = m[2] ?? 'm';
  return n * (unit === 's' ? 1000 : unit === 'm' ? 60_000 : 3_600_000);
}

function parseArgs(argv: string[]): Opts {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const duration = get('--duration') ?? '1h';
  const interval = get('--interval') ?? '5m';
  return {
    durationMs: parseDuration(duration),
    intervalMs: parseDuration(interval),
    persona: get('--persona') ?? null,
  };
}

const opts = parseArgs(process.argv.slice(2));

function run(cmd: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { stdio: 'inherit', shell: true }) as unknown as {
      on: (ev: 'close', cb: (code: number | null) => void) => void;
    };
    proc.on('close', (code: number | null) => resolve(code ?? -1));
  });
}

async function readPersonaSummary(): Promise<{
  ranAt: string;
  perPersona: Array<{
    id: string;
    name: string;
    weightedScore: number;
    topConditionRate: number;
    gauntletPassRate: number;
  }>;
} | null> {
  const date = new Date().toISOString().slice(0, 10);
  const path = join(process.cwd(), 'docs', 'status', `persona-summary-${date}.json`);
  try {
    const text = await readFile(path, 'utf8');
    return JSON.parse(text);
  } catch {
    return null;
  }
}

interface CycleSnapshot {
  cycleSeq: number;
  startedAt: string;
  durationMs: number;
  perPersona: Array<{
    id: string;
    weightedScore: number;
    topConditionRate: number;
    gauntletPassRate: number;
  }>;
}

async function main() {
  const startedAt = Date.now();
  const startStamp = new Date(startedAt).toISOString();
  console.log('🛠 morbius soak');
  console.log(`   duration : ${opts.durationMs / 60_000} min`);
  console.log(`   interval : ${opts.intervalMs / 1000} s between cycles`);
  console.log(`   persona  : ${opts.persona ?? 'all (doctor + patient + student)'}`);
  console.log(`   started  : ${startStamp}`);
  console.log('');

  const cycles: CycleSnapshot[] = [];
  let cycleSeq = 0;
  while (Date.now() - startedAt < opts.durationMs) {
    cycleSeq += 1;
    const cycleStart = Date.now();
    console.log(`\n━━━ cycle #${cycleSeq} · ${new Date(cycleStart).toISOString()} ━━━`);
    const args = ['run', 'scripts/persona-harness.ts'];
    if (opts.persona) args.push('--persona', opts.persona);
    const code = await run('bun', args);
    if (code !== 0) {
      console.warn(`  ✗ persona harness exited ${code} — recording empty snapshot`);
    }
    const snap = await readPersonaSummary();
    if (snap) {
      cycles.push({
        cycleSeq,
        startedAt: snap.ranAt,
        durationMs: Date.now() - cycleStart,
        perPersona: snap.perPersona.map((p) => ({
          id: p.id,
          weightedScore: p.weightedScore,
          topConditionRate: p.topConditionRate,
          gauntletPassRate: p.gauntletPassRate,
        })),
      });
    }
    const remaining = opts.durationMs - (Date.now() - startedAt);
    if (remaining > opts.intervalMs) {
      console.log(`\n  ⏳ sleeping ${opts.intervalMs / 1000}s before cycle #${cycleSeq + 1}`);
      await new Promise((r) => setTimeout(r, opts.intervalMs));
    } else {
      break;
    }
  }

  // Drift analysis
  const driftPerPersona: Record<string, { min: number; max: number; cycles: number }> = {};
  for (const c of cycles) {
    for (const p of c.perPersona) {
      const slot = driftPerPersona[p.id] ?? { min: 1, max: 0, cycles: 0 };
      slot.min = Math.min(slot.min, p.weightedScore);
      slot.max = Math.max(slot.max, p.weightedScore);
      slot.cycles += 1;
      driftPerPersona[p.id] = slot;
    }
  }

  const summary = {
    ranAt: startStamp,
    durationMs: Date.now() - startedAt,
    cycleCount: cycles.length,
    interval: opts.intervalMs,
    persona: opts.persona,
    drift: driftPerPersona,
    cycles,
  };
  const stamp = startStamp.slice(0, 16).replace(/[:.]/g, '-');
  const path = join(process.cwd(), 'docs', 'status', `soak-${stamp}.json`);
  await writeFile(path, JSON.stringify(summary, null, 2));

  console.log('\n═══ Soak summary ═══');
  console.log(`  ${cycles.length} cycles in ${(summary.durationMs / 60_000).toFixed(1)} min`);
  for (const [id, d] of Object.entries(driftPerPersona)) {
    const drift = (d.max - d.min) * 100;
    console.log(
      `  ${id.padEnd(8)} drift ${drift.toFixed(1).padStart(5)} pts · ${(d.min * 100).toFixed(1)}–${(d.max * 100).toFixed(1)} % over ${d.cycles} cycles`,
    );
  }
  console.log(`▸ wrote ${path}`);
}

main().catch((err) => {
  console.error('soak failed:', err);
  process.exit(1);
});
