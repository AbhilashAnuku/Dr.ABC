#!/usr/bin/env bun
/**
 * morbius-kg-finetune — run one KG-finetune cycle.
 *
 *   bun run morbius:kg-finetune
 *   bun run morbius:kg-finetune --snapshot docs/status/accuracy-2026-05-13.json
 *   bun run morbius:kg-finetune --dry-run            # propose deltas, do not write graph
 *   bun run morbius:kg-finetune --skip-decay         # skip the mean-reversion step
 *
 * The cycle pulls every case in the latest accuracy snapshot, turns each
 * case into a FineTuneSignal (patient text + predicted + truth + validator
 * verdict), then mutates the medical-graph.json edge weights through the
 * gradient-boosted update in `packages/agents/src/knowledge-graph/finetune.ts`.
 *
 *   docs/status/medical-graph.json         <- mutated in place (or skipped in --dry-run)
 *   docs/status/kg-finetune-history.jsonl  <- appended with the cycle summary
 *
 * Bounded magnitude + red-flag guard + time decay are all in the
 * algorithm module. This script is the I/O wrapper.
 */

import { appendFile, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type FineTuneCycleResult,
  type FineTuneSignal,
  applyFineTuneCycle,
} from '../packages/agents/src/knowledge-graph/finetune.ts';
import { loadGraph, saveGraph } from '../packages/agents/src/knowledge-graph/io.ts';

const REPO = process.cwd();
const STATUS_DIR = join(REPO, 'docs/status');
const GRAPH_PATH = join(STATUS_DIR, 'medical-graph.json');
const HISTORY_PATH = join(STATUS_DIR, 'kg-finetune-history.jsonl');

interface AccuracyCase {
  caseId: string;
  prompt: string;
  expectedDiagnosis: string;
  expectedIcd10?: string;
  expectedSpecialty?: string;
  modelDiagnosis?: string;
  modelIcd10?: string;
  modelSpecialty?: string;
  topConditionMatch?: boolean;
  gauntletPassed?: boolean;
  latencyMs?: number;
  error?: string | null;
}

interface AccuracySnapshot {
  ranAt: string;
  cases: AccuracyCase[];
  metrics?: { topConditionRate?: number };
}

/** Pick the freshest accuracy snapshot from disk (or honour --snapshot). */
async function resolveSnapshotPath(override: string | null): Promise<string> {
  if (override) return override;
  const entries = await readdir(STATUS_DIR);
  const candidates = entries.filter((n) => /^accuracy-\d{4}-\d{2}-\d{2}\.json$/.test(n));
  if (candidates.length === 0) {
    throw new Error('no accuracy-YYYY-MM-DD.json snapshot found in docs/status/');
  }
  candidates.sort(); // ISO-date names sort lexicographically
  const latest = candidates[candidates.length - 1];
  if (!latest) throw new Error('snapshot list resolved empty');
  return join(STATUS_DIR, latest);
}

async function loadSnapshot(path: string): Promise<AccuracySnapshot> {
  const text = await readFile(path, 'utf8');
  return JSON.parse(text) as AccuracySnapshot;
}

function signalsFromSnapshot(snap: AccuracySnapshot): FineTuneSignal[] {
  const out: FineTuneSignal[] = [];
  for (const c of snap.cases) {
    if (!c.prompt || !c.expectedDiagnosis) continue;
    if (c.error) continue;
    if (!c.modelDiagnosis) continue;
    out.push({
      patientText: c.prompt,
      predictedCondition: c.modelDiagnosis,
      truthCondition: c.expectedDiagnosis,
      validatorPassed: c.gauntletPassed === true,
    });
  }
  return out;
}

/** Get the next cycle sequence number by counting journal lines. */
async function nextCycleSeq(): Promise<number> {
  try {
    const text = await readFile(HISTORY_PATH, 'utf8');
    const lines = text.split('\n').filter((l) => l.trim().length > 0);
    return lines.length + 1;
  } catch {
    return 1;
  }
}

function fmt(n: number, digits = 4): string {
  return n.toFixed(digits);
}

function reportToConsole(result: FineTuneCycleResult, snapshotPath: string, dryRun: boolean): void {
  const tag = dryRun ? 'DRY-RUN' : 'APPLIED';
  console.log(`KG-finetune cycle #${result.cycleSeq} [${tag}]`);
  console.log(`  signals     : ${result.signalsConsumed}`);
  console.log(`  source      : ${snapshotPath.split(/[\\/]/).pop()}`);
  console.log(`  edgesUpdated: ${result.edgesUpdated}`);
  console.log(`  redFlagsGuarded: ${result.redFlagsGuarded}`);
  console.log(`  decayedEdges: ${result.decayedEdges}`);
  console.log(`  totalShift  : ${fmt(result.totalAbsoluteShift)}`);
  if (result.topStrengthened.length > 0) {
    console.log('  top strengthened:');
    for (const c of result.topStrengthened) {
      console.log(
        `    +${fmt(c.delta)}  ${c.sourceLabel} --${c.relation}--> ${c.targetLabel}  (w=${fmt(c.newWeight, 3)})`,
      );
    }
  }
  if (result.topWeakened.length > 0) {
    console.log('  top weakened:');
    for (const c of result.topWeakened) {
      console.log(
        `    ${fmt(c.delta)}  ${c.sourceLabel} --${c.relation}--> ${c.targetLabel}  (w=${fmt(c.newWeight, 3)})`,
      );
    }
  }
}

async function appendJournal(result: FineTuneCycleResult, snapshotPath: string): Promise<void> {
  const entry = {
    ...result,
    sourceSnapshot: snapshotPath.replace(`${REPO}\\`, '').replace(`${REPO}/`, ''),
  };
  await appendFile(HISTORY_PATH, `${JSON.stringify(entry)}\n`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const get = (flag: string): string | null => {
    const i = argv.indexOf(flag);
    if (i < 0) return null;
    const v = argv[i + 1];
    return v && !v.startsWith('--') ? v : '';
  };
  const has = (flag: string): boolean => argv.includes(flag);

  const snapshotOverride = get('--snapshot');
  const dryRun = has('--dry-run');
  const skipDecay = has('--skip-decay');

  const snapshotPath = await resolveSnapshotPath(snapshotOverride);
  console.log(`KG-finetune · reading ${snapshotPath}`);
  const snap = await loadSnapshot(snapshotPath);
  console.log(`  cases in snapshot: ${snap.cases.length}`);

  const graph = await loadGraph(GRAPH_PATH);
  console.log(`  graph: ${graph.nodes.length} nodes / ${graph.edges.length} edges`);

  const signals = signalsFromSnapshot(snap);
  if (signals.length === 0) {
    console.log('No usable signals in this snapshot — nothing to do.');
    process.exit(0);
  }

  const cycleSeq = await nextCycleSeq();
  const result = applyFineTuneCycle(graph, signals, cycleSeq, {
    applyDecay: !skipDecay,
  });
  reportToConsole(result, snapshotPath, dryRun);

  if (!dryRun) {
    await saveGraph(GRAPH_PATH, graph);
    await appendJournal(result, snapshotPath);
    console.log(`  graph saved -> ${GRAPH_PATH}`);
    console.log(`  journal appended -> ${HISTORY_PATH}`);
  } else {
    console.log('  (--dry-run · graph untouched, journal not written)');
  }
  console.log('KG-finetune · cycle done.');
}

main().catch((err) => {
  console.error('KG-finetune failed:', err);
  process.exit(1);
});
