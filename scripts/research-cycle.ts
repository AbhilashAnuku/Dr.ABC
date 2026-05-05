#!/usr/bin/env bun
/**
 * research-cycle — the autonomous nightly training/testing pipeline.
 *
 * Replaces the Claude-cron version of the same job (which was
 * session-only — dies when Claude exits). This script is self-contained
 * and can be scheduled by ANY OS-level scheduler (Windows Task
 * Scheduler, cron, systemd timers, GitHub Actions, Modal cron, etc.).
 *
 * What it does:
 *   1. Starts the API in the background (or assumes one is running on
 *      MORBIUS_API_BASE / http://localhost:8787)
 *   2. Runs the persona harness, MedQA harness, autopilot --once
 *   3. Reads the newest persona / medqa / autopilot snapshots
 *   4. Computes deltas vs the prior research-cycle-*.json (if any)
 *   5. Writes docs/status/research-cycle-YYYY-MM-DD.json with the
 *      verdict (improving / regressing / stable)
 *   6. Kills the API it spawned (only the one IT spawned)
 *   7. Exits 0 on success, 1 on harness failure, 2 on I/O failure
 *
 * Run by hand:
 *   bun run scripts/research-cycle.ts
 *   bun run scripts/research-cycle.ts --skip-api    # if API already up
 *   bun run scripts/research-cycle.ts --medqa-limit 30
 *
 * Schedule on Windows (one-time setup):
 *   bun run scripts/install-windows-tasks.ps1       # see sibling script
 *
 * Schedule on Linux/macOS:
 *   crontab -e
 *   23 4 * * * cd /path/to/Dr.Abc_V5 && bun run scripts/research-cycle.ts >> /tmp/morbius-cycle.log 2>&1
 */

import { spawn } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

interface Args {
  skipApi: boolean;
  medqaLimit: number;
  apiBase: string;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    skipApi: argv.includes('--skip-api'),
    medqaLimit: Number(get('--medqa-limit') ?? '60'),
    apiBase: get('--api-base') ?? process.env.MORBIUS_API_BASE ?? 'http://localhost:8787',
  };
}

const args = parseArgs(process.argv.slice(2));
const STATUS_DIR = join(process.cwd(), 'docs', 'status');

interface SpawnedChild {
  pid?: number;
  on: (ev: 'exit' | 'close', cb: (code: number | null) => void) => void;
  kill: (signal?: NodeJS.Signals) => boolean;
}

function spawnApi(): SpawnedChild {
  return spawn('bun', ['run', '--filter', '@dr-abc/api', 'dev'], {
    stdio: 'ignore',
    shell: true,
    detached: false,
  }) as unknown as SpawnedChild;
}

async function waitForApi(base: string, timeoutMs = 60_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${base}/`);
      if (r.ok) return true;
    } catch {
      // not yet
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

function runScript(
  script: string,
  scriptArgs: string[] = [],
): Promise<{
  exitCode: number | null;
  stdout: string;
}> {
  return new Promise((resolveRun) => {
    const out: string[] = [];
    const proc = spawn('bun', ['run', script, ...scriptArgs], {
      shell: true,
    }) as unknown as SpawnedChild & {
      stdout: { on: (ev: 'data', cb: (d: Buffer) => void) => void };
      stderr: { on: (ev: 'data', cb: (d: Buffer) => void) => void };
    };
    proc.stdout.on('data', (d) => out.push(d.toString()));
    proc.stderr.on('data', (d) => out.push(d.toString()));
    proc.on('close', (code: number | null) => resolveRun({ exitCode: code, stdout: out.join('') }));
  });
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(join(STATUS_DIR, file), 'utf8')) as T;
  } catch {
    return null;
  }
}

async function newest(prefix: string): Promise<string | null> {
  try {
    const entries = await readdir(STATUS_DIR);
    const matches = entries
      .filter((n) => n.startsWith(prefix) && n.endsWith('.json'))
      .sort()
      .reverse();
    return matches[0] ?? null;
  } catch {
    return null;
  }
}

interface PersonaSummary {
  perPersona: Array<{ id: string; weightedScore: number }>;
}

interface MedQARun {
  pct?: number;
}

interface LiveAccuracy {
  pct?: number;
}

interface ResearchCycle {
  ranAt: string;
  medqaPct: number | null;
  liveAccuracyPct: number | null;
  persona: Array<{ id: string; weightedScore: number }>;
  deltas: Record<string, number>;
  verdict: 'improving' | 'regressing' | 'stable';
  notes: string;
  /** Knowledge-graph snapshot stats (graphify-style growth signal). */
  graphNodes?: number;
  graphEdges?: number;
}

async function main() {
  const startedAt = new Date();
  console.log(`▸ research-cycle · ${startedAt.toISOString()}`);

  let api: SpawnedChild | null = null;
  if (!args.skipApi) {
    console.log('  ▸ spawning API…');
    api = spawnApi();
    const up = await waitForApi(args.apiBase);
    if (!up) {
      console.error('  ✗ API never came online. Aborting.');
      api?.kill('SIGTERM');
      process.exit(2);
    }
    console.log('  ✓ API up');
  }

  try {
    console.log('  ▸ persona harness…');
    const persona = await runScript('morbius:persona');
    if (persona.exitCode !== 0) console.warn(`  ⚠ persona exit ${persona.exitCode}`);

    console.log(`  ▸ MedQA harness (limit ${args.medqaLimit})…`);
    const medqa = await runScript('scripts/medqa-harness.ts', ['--limit', String(args.medqaLimit)]);
    if (medqa.exitCode !== 0) console.warn(`  ⚠ medqa exit ${medqa.exitCode}`);

    console.log('  ▸ autopilot --once…');
    const auto = await runScript('morbius:autopilot', ['--', '--once']);
    if (auto.exitCode !== 0) console.warn(`  ⚠ autopilot exit ${auto.exitCode}`);

    // Knowledge-graph build/update (graphify-style continuous learning).
    // Pull the most recent persona-harness cases, extract them into the
    // medical knowledge graph, persist back to docs/status/medical-graph.json.
    console.log('  ▸ building knowledge graph…');
    let graphNodes = 0;
    let graphEdges = 0;
    try {
      const { extractFromConsult, mergeGraph, analyzeGraph, renderReport } = await import(
        '@dr-abc/agents'
      );
      const { loadGraph, saveGraph } = await import('@dr-abc/agents/knowledge-graph/io');
      const { writeFile: wf } = await import('node:fs/promises');
      const graphPath = join(STATUS_DIR, 'medical-graph.json');
      const graph = await loadGraph(graphPath);

      const sources = ['persona-doctor-', 'persona-patient-', 'persona-student-'];
      let merged = 0;
      for (const prefix of sources) {
        const f = await newest(prefix);
        if (!f) continue;
        const data = (await readJson<{
          cases?: Array<{
            id?: string;
            complaint?: string;
            input?: string;
            topCondition?: string;
            specialty?: string;
            differentials?: Array<{ condition: string; probability: number; icd10?: string }>;
          }>;
        }>(f)) ?? { cases: [] };
        for (const c of data.cases ?? []) {
          const ext = await extractFromConsult({
            consultId: c.id ?? `${prefix}${(c.complaint ?? c.input ?? '').slice(0, 30)}`,
            complaint: c.complaint ?? c.input ?? '',
            topCondition: c.topCondition,
            specialty: c.specialty,
            differentials: c.differentials,
          });
          if (mergeGraph(graph, ext)) merged += 1;
        }
      }
      await saveGraph(graphPath, graph);
      const reportPath = join(STATUS_DIR, 'MEDICAL_GRAPH_REPORT.md');
      await wf(reportPath, renderReport(graph, analyzeGraph(graph)));
      graphNodes = graph.nodes.length;
      graphEdges = graph.edges.length;
      console.log(
        `  ✓ knowledge graph · ${graph.nodes.length} nodes · ${graph.edges.length} edges · merged ${merged} new sources`,
      );
    } catch (e) {
      console.warn(`  ⚠ knowledge graph step failed: ${e instanceof Error ? e.message : e}`);
    }

    console.log('  ▸ aggregating…');
    const personaFile = await newest('persona-summary-');
    const medqaFile = await newest('medqa-');
    const personaSnap = personaFile ? await readJson<PersonaSummary>(personaFile) : null;
    const medqaSnap = medqaFile ? await readJson<MedQARun>(medqaFile) : null;
    const liveSnap = await readJson<LiveAccuracy>('live-accuracy.json');

    const today: ResearchCycle = {
      ranAt: startedAt.toISOString(),
      medqaPct: medqaSnap?.pct ?? null,
      liveAccuracyPct: liveSnap?.pct ?? null,
      persona:
        personaSnap?.perPersona.map((p) => ({ id: p.id, weightedScore: p.weightedScore })) ?? [],
      deltas: {},
      verdict: 'stable',
      notes: '',
      graphNodes,
      graphEdges,
    };

    // Find prior cycle for delta
    const cycleFiles = (await readdir(STATUS_DIR))
      .filter((n) => n.startsWith('research-cycle-') && n.endsWith('.json'))
      .sort()
      .reverse();
    const priorFile = cycleFiles[0];
    const prior = priorFile ? await readJson<ResearchCycle>(priorFile) : null;

    if (prior) {
      const dMed = (today.medqaPct ?? 0) - (prior.medqaPct ?? 0);
      const dLive = (today.liveAccuracyPct ?? 0) - (prior.liveAccuracyPct ?? 0);
      today.deltas.medqa = dMed;
      today.deltas.liveAccuracy = dLive;
      for (const p of today.persona) {
        const wasIt = prior.persona.find((q) => q.id === p.id);
        if (wasIt) today.deltas[`persona.${p.id}`] = p.weightedScore - wasIt.weightedScore;
      }
      const positives = Object.values(today.deltas).filter((v) => v > 0.005).length;
      const negatives = Object.values(today.deltas).filter((v) => v < -0.005).length;
      today.verdict =
        positives > negatives ? 'improving' : negatives > positives ? 'regressing' : 'stable';
      today.notes = `${positives} metrics up · ${negatives} down · vs ${priorFile}`;
    } else {
      today.notes = 'first cycle on file — no deltas to compute';
    }

    const stamp = startedAt.toISOString().slice(0, 10);
    const outFile = join(STATUS_DIR, `research-cycle-${stamp}.json`);
    await writeFile(outFile, JSON.stringify(today, null, 2));
    console.log(`▸ wrote ${outFile}`);
    console.log(`▸ verdict · ${today.verdict}${today.notes ? ` · ${today.notes}` : ''}`);

    // v0.7-final — fire the daily progress report so the
    // 7-day learning trail (May 4 → May 13) lands automatically with
    // every nightly cycle. Best-effort — failure here doesn't sink
    // the cycle.
    console.log('  ▸ generating daily progress report…');
    try {
      const reportProc = await runScript('scripts/morbius-daily-report.ts', ['--date', stamp]);
      if (reportProc.exitCode === 0) {
        console.log(`  ✓ docs/reports/morbius-progress-${stamp}.md`);
      } else {
        console.warn(`  ⚠ daily-report exit ${reportProc.exitCode}`);
      }
    } catch (e) {
      console.warn(`  ⚠ daily-report failed: ${e instanceof Error ? e.message : e}`);
    }
  } finally {
    if (api) {
      console.log('  ▸ stopping API…');
      api.kill('SIGTERM');
    }
  }
}

main().catch((err) => {
  console.error('research-cycle failed:', err);
  process.exit(1);
});
