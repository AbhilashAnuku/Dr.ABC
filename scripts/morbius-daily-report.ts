#!/usr/bin/env bun
/**
 * morbius-daily-report — generate one day's progress report.
 *
 * Reads every status file we have for the target day + the cumulative
 * journals (medical-graph.json, boosting-journal.jsonl) and emits:
 *
 *   docs/reports/morbius-progress-YYYY-MM-DD.md   ← human-readable
 *   docs/reports/morbius-progress-YYYY-MM-DD.json ← machine-readable
 *
 * Produces a 7-day run of daily reports, each covering how the system
 * is learning and building memory. The shape:
 *
 *   - KG growth (nodes / edges / sources, deltas vs prior day)
 *   - Per-kind breakdown (conditions / drugs / specialties / …)
 *   - Benchmark scores (MedQA · MedMCQA · seed-30 · USMLE-200)
 *   - Persona scores (doctor / patient / student)
 *   - Boosting journal (events, by source, by direction, top patterns)
 *   - Cascade backend usage (which model fired most)
 *   - PubMed cache size (real records ingested)
 *
 * Run:
 *   bun run scripts/morbius-daily-report.ts                  # today
 *   bun run scripts/morbius-daily-report.ts --date 2026-05-03
 *   bun run scripts/morbius-daily-report.ts --backfill       # all past days
 *
 * Schedule:
 *   - Called automatically at the end of scripts/research-cycle.ts
 *   - install-windows-tasks.ps1 fires research-cycle nightly at 04:23
 */

import { existsSync, readdirSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const STATUS_DIR = join(process.cwd(), 'docs', 'status');
const REPORTS_DIR = join(process.cwd(), 'docs', 'reports');
const HF_BASE = process.env.HF_HOME
  ? join(process.env.HF_HOME, 'datasets', 'dr-abc')
  : 'F:\\huggingface-cache\\datasets\\dr-abc';

interface Args {
  date: string;
  backfill: boolean;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    date: get('--date') ?? todayIso(),
    backfill: argv.includes('--backfill'),
  };
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

async function readJsonl<T>(path: string): Promise<T[]> {
  try {
    const text = await readFile(path, 'utf8');
    const out: T[] = [];
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line) as T);
      } catch {}
    }
    return out;
  } catch {
    return [];
  }
}

// ────────────────────────────────────────────────────────────
//  Data shapes (subset of what the harnesses + generators emit)
// ────────────────────────────────────────────────────────────

interface MedicalGraph {
  updatedAt: string;
  nodes: Array<{ id: string; kind: string; label: string; mentionCount: number }>;
  edges: Array<{ confidence: 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS' }>;
  cache: Record<string, string>;
}

interface MedQARun {
  // Old harness shape (v0.5-v0.6 single-file output)
  pct?: number;
  correct?: number;
  total?: number;
  source?: string;
  perBackend?: Record<string, { pct?: number; count?: number }>;
  // New harness shape (v0.7+ per-run JSON with metrics block)
  ranAt?: string;
  questionCount?: number;
  metrics?: {
    accuracy?: number; // 0..1 fraction
    nonErrorAccuracy?: number;
    answeredCount?: number;
    errorCount?: number;
    perSpecialty?: Record<string, { count: number; correct: number; rate: number }>;
  };
}

function pickRunScore(run: MedQARun | null): {
  score: number | null;
  correct?: number;
  total?: number;
  source?: string;
} {
  if (!run) return { score: null };
  // Prefer the new metrics block when present.
  if (run.metrics?.accuracy !== undefined) {
    return {
      score: Number((run.metrics.accuracy * 100).toFixed(1)),
      correct: run.metrics.answeredCount,
      total: run.questionCount,
      source: run.source,
    };
  }
  return {
    score: run.pct ?? null,
    correct: run.correct,
    total: run.total,
    source: run.source,
  };
}

interface PersonaSummary {
  perPersona?: Array<{ id: string; weightedScore: number; topConditionRate?: number }>;
}

interface ResearchCycle {
  ranAt?: string;
  verdict?: string;
  medqaPct?: number | null;
  graphNodes?: number;
  graphEdges?: number;
  notes?: string;
}

interface ErrorEvent {
  id: string;
  ts: number;
  source: string;
  direction: string;
  predicted: string;
  actual: string;
}

// ────────────────────────────────────────────────────────────
//  Per-day metrics — single source-of-truth shape
// ────────────────────────────────────────────────────────────

interface DailyMetrics {
  date: string;
  generatedAt: string;
  memory: {
    kgNodes: number;
    kgEdges: number;
    kgSources: number;
    nodesByKind: Record<string, number>;
    edgesByConfidence: Record<string, number>;
    deltaVsPrior: { nodes: number; edges: number; sources: number } | null;
  };
  benchmarks: {
    medqa: { score: number | null; correct?: number; total?: number; source?: string } | null;
    medmcqa: { score: number | null; correct?: number; total?: number } | null;
    usmle200: { score: number | null; correct?: number; total?: number } | null;
    seed30: { score: number | null } | null;
  };
  personas: {
    doctor: number | null;
    patient: number | null;
    student: number | null;
  };
  boosting: {
    totalEvents: number;
    eventsToday: number;
    bySource: Record<string, number>;
    byDirection: Record<string, number>;
    topPatterns: Array<{ predicted: string; actual: string; count: number }>;
  };
  ingest: {
    pubmedCases: number;
    medMcqaCache: number;
    medqaUsmleCache: number;
    mmluCache: number;
  };
  cycle: { verdict: string; notes: string } | null;
}

async function lineCount(path: string): Promise<number> {
  if (!existsSync(path)) return 0;
  const text = await readFile(path, 'utf8');
  return text.split('\n').filter((l) => l.trim().length > 0).length;
}

function isoDayBefore(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

async function pickNewestForDay(prefix: string, day: string): Promise<string | null> {
  if (!existsSync(STATUS_DIR)) return null;
  // Excluded markers: results we DON'T want polluting the daily-report
  // baseline trend. `infra-fail` is a manually-renamed failed run; the
  // experimental CoT/ensemble results are kept on file but not the
  // canonical "today's score." Add new markers here if you tag
  // experimental harness outputs.
  const excludeMarkers = ['infra-fail', 'cot-ensemble', 'experimental'];
  const matches = readdirSync(STATUS_DIR)
    .filter(
      (n) =>
        n.startsWith(prefix) &&
        n.endsWith('.json') &&
        n.includes(day) &&
        !excludeMarkers.some((m) => n.includes(m)),
    )
    .sort()
    .reverse();
  return matches[0] ? join(STATUS_DIR, matches[0]) : null;
}

async function pickNewest(prefix: string): Promise<string | null> {
  if (!existsSync(STATUS_DIR)) return null;
  const matches = readdirSync(STATUS_DIR)
    .filter((n) => n.startsWith(prefix) && n.endsWith('.json'))
    .sort()
    .reverse();
  return matches[0] ? join(STATUS_DIR, matches[0]) : null;
}

async function gatherMetrics(date: string): Promise<DailyMetrics> {
  // ── Memory: knowledge graph snapshot ──
  const graphPath = join(STATUS_DIR, 'medical-graph.json');
  const graph = await readJson<MedicalGraph>(graphPath);
  const nodesByKind: Record<string, number> = {};
  const edgesByConfidence: Record<string, number> = {};
  if (graph) {
    for (const n of graph.nodes) nodesByKind[n.kind] = (nodesByKind[n.kind] ?? 0) + 1;
    for (const e of graph.edges)
      edgesByConfidence[e.confidence] = (edgesByConfidence[e.confidence] ?? 0) + 1;
  }
  // Delta vs prior day's research-cycle JSON.
  const priorCyclePath = join(STATUS_DIR, `research-cycle-${isoDayBefore(date)}.json`);
  const priorCycle = await readJson<ResearchCycle>(priorCyclePath);
  const deltaVsPrior =
    priorCycle && graph
      ? {
          nodes: graph.nodes.length - (priorCycle.graphNodes ?? 0),
          edges: graph.edges.length - (priorCycle.graphEdges ?? 0),
          sources: 0, // we don't track per-day source count in old cycles
        }
      : null;

  // ── Benchmarks for the target day ──
  const medqaToday = await pickNewestForDay('medqa-', date);
  const medqa = medqaToday ? await readJson<MedQARun>(medqaToday) : null;
  const medMcqaToday = await pickNewestForDay('medqa-medmcqa', date);
  const medmcqa = medMcqaToday ? await readJson<MedQARun>(medMcqaToday) : null;
  const usmle200Today = await pickNewestForDay('medqa-usmle200', date);
  const usmle200 = usmle200Today ? await readJson<MedQARun>(usmle200Today) : null;
  const seed30Today = await pickNewestForDay('medqa-seed30', date);
  const seed30 = seed30Today ? await readJson<MedQARun>(seed30Today) : null;

  // ── Persona summary for the target day ──
  const personaSummaryToday = await pickNewestForDay('persona-summary', date);
  const personaSummary = personaSummaryToday
    ? await readJson<PersonaSummary>(personaSummaryToday)
    : null;
  const personaScore = (id: string) =>
    personaSummary?.perPersona?.find((p) => p.id === id)?.weightedScore ?? null;

  // ── Boosting journal ──
  const journalPath = join(STATUS_DIR, 'boosting-journal.jsonl');
  const journal = await readJsonl<ErrorEvent>(journalPath);
  const dayStart = new Date(`${date}T00:00:00Z`).getTime();
  const dayEnd = dayStart + 24 * 60 * 60 * 1000;
  const eventsToday = journal.filter((e) => e.ts >= dayStart && e.ts < dayEnd);
  const bySource: Record<string, number> = {};
  const byDirection: Record<string, number> = {};
  const patternKey = new Map<string, number>();
  for (const e of journal) {
    bySource[e.source] = (bySource[e.source] ?? 0) + 1;
    byDirection[e.direction] = (byDirection[e.direction] ?? 0) + 1;
    const k = `${(e.predicted ?? '').toLowerCase()} → ${(e.actual ?? '').toLowerCase()}`;
    patternKey.set(k, (patternKey.get(k) ?? 0) + 1);
  }
  const topPatterns = Array.from(patternKey.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k, count]) => {
      const [predicted, actual] = k.split(' → ');
      return { predicted: predicted ?? '', actual: actual ?? '', count };
    });

  // ── Ingest sizes (cumulative caches on F:) ──
  const pubmedCount = await lineCount(join(HF_BASE, 'pubmed-cases.jsonl'));
  const medMcqaCount = await lineCount(join(HF_BASE, 'medmcqa.jsonl'));
  const medqaUsmleCount = await lineCount(join(HF_BASE, 'medqa.jsonl'));
  const mmluCount = await lineCount(join(HF_BASE, 'mmlu.jsonl'));

  // ── Today's research cycle ──
  const cycleTodayPath = join(STATUS_DIR, `research-cycle-${date}.json`);
  const cycleToday = await readJson<ResearchCycle>(cycleTodayPath);

  const medqaScore = pickRunScore(medqa);
  const medmcqaScore = pickRunScore(medmcqa);
  const usmleScore = pickRunScore(usmle200);
  const seedScore = pickRunScore(seed30);

  return {
    date,
    generatedAt: new Date().toISOString(),
    memory: {
      kgNodes: graph?.nodes.length ?? 0,
      kgEdges: graph?.edges.length ?? 0,
      kgSources: graph ? Object.keys(graph.cache).length : 0,
      nodesByKind,
      edgesByConfidence,
      deltaVsPrior,
    },
    benchmarks: {
      medqa: medqa ? medqaScore : null,
      medmcqa: medmcqa ? medmcqaScore : null,
      usmle200: usmle200 ? usmleScore : null,
      seed30: seed30 ? { score: seedScore.score } : null,
    },
    personas: {
      doctor: personaScore('doctor'),
      patient: personaScore('patient'),
      student: personaScore('student'),
    },
    boosting: {
      totalEvents: journal.length,
      eventsToday: eventsToday.length,
      bySource,
      byDirection,
      topPatterns,
    },
    ingest: {
      pubmedCases: pubmedCount,
      medMcqaCache: medMcqaCount,
      medqaUsmleCache: medqaUsmleCount,
      mmluCache: mmluCount,
    },
    cycle: cycleToday
      ? { verdict: cycleToday.verdict ?? 'unknown', notes: cycleToday.notes ?? '' }
      : null,
  };
}

// ────────────────────────────────────────────────────────────
//  Markdown rendering
// ────────────────────────────────────────────────────────────

function bar(value: number, max: number, width = 30): string {
  if (max <= 0) return '';
  const fill = Math.min(width, Math.round((value / max) * width));
  return '█'.repeat(fill) + '░'.repeat(Math.max(0, width - fill));
}

function pct(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return `${n.toFixed(1)}%`;
}

function renderMarkdown(m: DailyMetrics): string {
  const lines: string[] = [];
  lines.push(`# Mörbius progress · ${m.date}`);
  lines.push('');
  lines.push(`*Generated ${m.generatedAt}*`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Memory · how the brain is building');
  lines.push('');
  lines.push(`- **Knowledge-graph nodes:** ${m.memory.kgNodes.toLocaleString()}`);
  lines.push(`- **Knowledge-graph edges:** ${m.memory.kgEdges.toLocaleString()}`);
  lines.push(`- **Distinct memory sources:** ${m.memory.kgSources.toLocaleString()}`);
  if (m.memory.deltaVsPrior) {
    lines.push('');
    lines.push(
      `**Δ vs ${isoDayBefore(m.date)}:** +${m.memory.deltaVsPrior.nodes} nodes · +${m.memory.deltaVsPrior.edges} edges`,
    );
  }
  lines.push('');
  lines.push('### Nodes by kind');
  lines.push('');
  const kindMax = Math.max(...Object.values(m.memory.nodesByKind), 1);
  lines.push('```');
  for (const [kind, count] of Object.entries(m.memory.nodesByKind).sort((a, b) => b[1] - a[1])) {
    lines.push(`${kind.padEnd(12)} ${String(count).padStart(5)}  ${bar(count, kindMax, 24)}`);
  }
  lines.push('```');
  lines.push('');
  lines.push('### Edges by confidence');
  lines.push('');
  const confMax = Math.max(...Object.values(m.memory.edgesByConfidence), 1);
  lines.push('```');
  for (const tag of ['EXTRACTED', 'INFERRED', 'AMBIGUOUS']) {
    const c = m.memory.edgesByConfidence[tag] ?? 0;
    lines.push(`${tag.padEnd(12)} ${String(c).padStart(5)}  ${bar(c, confMax, 24)}`);
  }
  lines.push('```');
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Benchmarks · how Mörbius is reasoning');
  lines.push('');
  lines.push('| Benchmark | Score | Detail |');
  lines.push('| --- | --- | --- |');
  lines.push(
    `| MedQA-USMLE-200 | ${pct(m.benchmarks.usmle200?.score ?? null)} | ${
      m.benchmarks.usmle200
        ? `${m.benchmarks.usmle200.correct}/${m.benchmarks.usmle200.total}`
        : 'no run today'
    } |`,
  );
  lines.push(
    `| MedMCQA-100 | ${pct(m.benchmarks.medmcqa?.score ?? null)} | ${
      m.benchmarks.medmcqa
        ? `${m.benchmarks.medmcqa.correct}/${m.benchmarks.medmcqa.total}`
        : 'no run today'
    } |`,
  );
  lines.push(`| Seed-30 | ${pct(m.benchmarks.seed30?.score ?? null)} | post-cascade |`);
  lines.push(
    `| MedQA mix | ${pct(m.benchmarks.medqa?.score ?? null)} | ${m.benchmarks.medqa?.source ?? '—'} |`,
  );
  lines.push('');
  lines.push('### Persona harness · weighted scores');
  lines.push('');
  lines.push('| Persona | Score |');
  lines.push('| --- | --- |');
  lines.push(`| Doctor | ${pct(m.personas.doctor !== null ? m.personas.doctor * 100 : null)} |`);
  lines.push(`| Patient | ${pct(m.personas.patient !== null ? m.personas.patient * 100 : null)} |`);
  lines.push(`| Student | ${pct(m.personas.student !== null ? m.personas.student * 100 : null)} |`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Self-correction · gradient-boosting arc');
  lines.push('');
  lines.push(`- **Total error events recorded:** ${m.boosting.totalEvents}`);
  lines.push(`- **New events today:** ${m.boosting.eventsToday}`);
  lines.push('');
  if (Object.keys(m.boosting.bySource).length > 0) {
    lines.push('### By source');
    lines.push('');
    lines.push('```');
    for (const [src, n] of Object.entries(m.boosting.bySource).sort((a, b) => b[1] - a[1])) {
      lines.push(`${src.padEnd(14)} ${String(n).padStart(4)}`);
    }
    lines.push('```');
    lines.push('');
  }
  if (Object.keys(m.boosting.byDirection).length > 0) {
    lines.push('### By direction');
    lines.push('');
    lines.push('```');
    for (const [dir, n] of Object.entries(m.boosting.byDirection)) {
      lines.push(`${dir.padEnd(10)} ${String(n).padStart(4)}`);
    }
    lines.push('```');
    lines.push('');
  }
  if (m.boosting.topPatterns.length > 0) {
    lines.push('### Top correction patterns (predicted → actual)');
    lines.push('');
    lines.push('| Predicted | Actual | Count |');
    lines.push('| --- | --- | --- |');
    for (const p of m.boosting.topPatterns) {
      lines.push(`| ${p.predicted} | ${p.actual} | ${p.count} |`);
    }
    lines.push('');
  }
  lines.push('---');
  lines.push('');
  lines.push('## Ingest · what landed in the cache');
  lines.push('');
  lines.push('| Source | Records cached |');
  lines.push('| --- | --- |');
  lines.push(`| PubMed case reports | ${m.ingest.pubmedCases.toLocaleString()} |`);
  lines.push(`| MedMCQA | ${m.ingest.medMcqaCache.toLocaleString()} |`);
  lines.push(`| MedQA-USMLE | ${m.ingest.medqaUsmleCache.toLocaleString()} |`);
  lines.push(`| MMLU clinical | ${m.ingest.mmluCache.toLocaleString()} |`);
  lines.push('');
  if (m.cycle) {
    lines.push('---');
    lines.push('');
    lines.push(`## Cycle verdict · ${m.cycle.verdict}`);
    lines.push('');
    lines.push(m.cycle.notes || '_no cycle notes recorded_');
    lines.push('');
  }
  lines.push('---');
  lines.push('');
  lines.push(
    '_Generated by `scripts/morbius-daily-report.ts`. Mörbius runs this at the end of every nightly research-cycle so the daily snapshot is automatic. Manual re-run: `bun run scripts/morbius-daily-report.ts --date YYYY-MM-DD`._',
  );
  lines.push('');
  return lines.join('\n');
}

// ────────────────────────────────────────────────────────────
//  Main
// ────────────────────────────────────────────────────────────

async function emitOne(date: string): Promise<DailyMetrics> {
  await mkdir(REPORTS_DIR, { recursive: true });
  const metrics = await gatherMetrics(date);
  const md = renderMarkdown(metrics);
  // Trailing newlines on both files so biome's formatter is happy and
  // the JSON file is POSIX-compliant.
  await writeFile(join(REPORTS_DIR, `morbius-progress-${date}.md`), `${md}\n`);
  await writeFile(
    join(REPORTS_DIR, `morbius-progress-${date}.json`),
    `${JSON.stringify(metrics, null, 2)}\n`,
  );
  return metrics;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.backfill) {
    // Walk backwards 14 days from today and emit a report for each
    // date that has at least a research-cycle JSON OR a medqa run.
    const today = new Date(`${todayIso()}T00:00:00Z`);
    let emitted = 0;
    for (let i = 0; i < 14; i++) {
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() - i);
      const date = d.toISOString().slice(0, 10);
      const cyclePath = join(STATUS_DIR, `research-cycle-${date}.json`);
      const medqaPath = await pickNewestForDay('medqa-', date);
      if (existsSync(cyclePath) || medqaPath) {
        const m = await emitOne(date);
        emitted++;
        console.log(
          `✓ ${date} · ${m.memory.kgNodes} nodes · ${m.memory.kgEdges} edges · medqa ${pct(m.benchmarks.medqa?.score ?? null)} · pubmed ${m.ingest.pubmedCases}`,
        );
      }
    }
    console.log(`▸ ${emitted} reports written to ${REPORTS_DIR}`);
  } else {
    const m = await emitOne(args.date);
    console.log(
      `✓ ${args.date} · ${m.memory.kgNodes} nodes · ${m.memory.kgEdges} edges · medqa ${pct(m.benchmarks.medqa?.score ?? null)} · pubmed ${m.ingest.pubmedCases}`,
    );
    console.log(`  → docs/reports/morbius-progress-${args.date}.md`);
  }
}

main().catch((err) => {
  console.error('✗ daily-report failed:', err);
  process.exit(1);
});
