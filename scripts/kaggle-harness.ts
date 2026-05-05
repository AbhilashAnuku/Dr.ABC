#!/usr/bin/env bun
/**
 * kaggle-harness — score Mörbius against real Kaggle / UCI medical
 * datasets. Covers real medical CSV / image data for diagnosis;
 * `medqa-harness` already covers multi-choice
 * board questions. This harness goes one level deeper — it submits
 * each row of a labeled CSV to /orchestrate as a clinical narrative,
 * extracts Mörbius's verdict, and scores against the dataset's
 * ground-truth label.
 *
 * Currently bundled (run anytime, no Kaggle credentials needed):
 *
 *   - heart-disease-uci   159 patient rows · binary heart-disease
 *
 * Available with `kaggle datasets download …` (see scripts/data/datasets-index.json):
 *
 *   - diabetes-pima       768 rows · binary T2DM onset
 *   - isic-skin-cancer    25k images (image-pipeline, not this script)
 *   - chest-xray-pneumonia 6k images
 *   - brain-mri-tumor     3k MRI volumes (3D)
 *   - covid-19-radiography 21k X-rays
 *   - diabetic-retinopathy 5.6k retinal images
 *
 * Image datasets are wired into apps/py-svc imaging backends, not
 * this script — this script handles tabular/CSV only.
 *
 * Usage:
 *   bun run morbius:kaggle                       # all bundled CSVs
 *   bun run morbius:kaggle --dataset heart-disease-uci
 *   bun run morbius:kaggle --max 30              # cap rows for speed
 *
 * Writes:
 *   docs/status/kaggle-<dataset>-YYYY-MM-DD.json
 */

import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

interface Dataset {
  id: string;
  name: string;
  kind: 'tabular-csv' | 'image' | 'image-3d';
  specialty: string;
  task: string;
  columns: Array<{ name: string; type: string; desc: string }>;
  target: { name: string; values: unknown[]; meaning: string };
  path: string;
  bundled: boolean;
  note?: string;
}

interface DatasetsIndex {
  version: string;
  sources: Dataset[];
}

const API_BASE = process.env.API_BASE ?? 'http://localhost:8787';
const PER_ROW_TIMEOUT_MS = 60_000;

function parseArgs(argv: string[]): { dataset: string | null; max: number | null } {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const dataset = get('--dataset') ?? null;
  const maxRaw = get('--max');
  const max = maxRaw ? Number(maxRaw) : null;
  return { dataset, max };
}

const opts = parseArgs(process.argv.slice(2));

async function loadIndex(): Promise<DatasetsIndex> {
  const text = await readFile(
    join(process.cwd(), 'scripts', 'data', 'datasets-index.json'),
    'utf8',
  );
  return JSON.parse(text);
}

function parseCsv(text: string): { header: string[]; rows: string[][] } {
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0]?.split(',').map((s) => s.trim()) ?? [];
  const rows = lines.slice(1).map((l) => l.split(','));
  return { header, rows };
}

/**
 * Build a clinical narrative from a tabular row using the dataset's
 * column metadata. Heart-disease example:
 *   "63-year-old male presents with typical angina (cp=1). Resting BP
 *    145, cholesterol 233 mg/dL, fasting blood sugar > 120 mg/dL,
 *    resting ECG normal, max HR 150, exercise-induced angina absent,
 *    ST depression 2.3 mm with downsloping segment, 0 vessels visible
 *    on fluoroscopy, fixed thalassemia defect."
 *
 * The harness asks Mörbius: "Based on these findings, does this
 * patient have heart disease?" — explicit yes/no framing so we can
 * score the verdict.
 */
function buildPromptForHeartDisease(header: string[], row: string[]): string {
  const rec = Object.fromEntries(header.map((h, i) => [h, row[i] ?? '']));
  const sex = rec.sex === '1' ? 'male' : 'female';
  const cp =
    { '1': 'typical angina', '2': 'atypical angina', '3': 'non-anginal pain', '4': 'asymptomatic' }[
      rec.cp ?? ''
    ] ?? 'unknown chest-pain pattern';
  const fbs = rec.fbs === '1' ? '> 120 mg/dL' : '≤ 120 mg/dL';
  const restecg =
    { '0': 'normal', '1': 'ST-T abnormality', '2': 'LV hypertrophy' }[rec.restecg ?? ''] ?? '?';
  const exang = rec.exang === '1' ? 'present' : 'absent';
  const slope = { '1': 'upsloping', '2': 'flat', '3': 'downsloping' }[rec.slope ?? ''] ?? '?';
  const thal =
    { '3': 'normal', '6': 'fixed defect', '7': 'reversible defect' }[rec.thal ?? ''] ?? '?';
  return [
    `${rec.age}-year-old ${sex} presents with ${cp}.`,
    `Resting BP ${rec.trestbps} mm Hg, total cholesterol ${rec.chol} mg/dL.`,
    `Fasting blood sugar ${fbs}.`,
    `Resting ECG ${restecg}. Max heart rate achieved on stress test: ${rec.thalach}.`,
    `Exercise-induced angina ${exang}.`,
    `ST depression ${rec.oldpeak} mm relative to rest, with ${slope} ST segment.`,
    `${rec.ca} major vessels visible on fluoroscopy.`,
    `Thalassemia / nuclear stress: ${thal}.`,
    '',
    'Based on these findings, does this patient have coronary artery disease? Reply "yes" or "no" at the start of your response.',
  ].join(' ');
}

interface SseEvent {
  type?: string;
  result?: {
    agent?: string;
    data?: {
      differentials?: Array<{ condition?: string; probability?: number }>;
      recommendedSpecialty?: string;
    };
  };
}

interface RowOutcome {
  rowIndex: number;
  expected: 0 | 1;
  predicted: 0 | 1 | null;
  modelText: string | null;
  correct: boolean;
  latencyMs: number;
  error: string | null;
}

async function runOneRow(
  prompt: string,
): Promise<{ text: string | null; ms: number; error: string | null }> {
  const startedAt = performance.now();
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), PER_ROW_TIMEOUT_MS);
    const res = await fetch(`${API_BASE}/orchestrate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Dr-Abc-Source': 'kaggle-harness' },
      body: JSON.stringify({ text: prompt }),
      signal: ac.signal,
    });
    if (!res.body) throw new Error(`HTTP ${res.status} no body`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let modelText: string | null = null;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split('\n\n');
      buffer = chunks.pop() ?? '';
      for (const chunk of chunks) {
        const line = chunk.split('\n').find((l) => l.startsWith('data: '));
        if (!line) continue;
        try {
          const ev = JSON.parse(line.slice(6).trim()) as SseEvent;
          if (ev.type === 'agent.completed' && ev.result?.agent === 'diagnostic') {
            const top = ev.result.data?.differentials?.[0];
            if (top?.condition) modelText = top.condition;
          }
        } catch {
          /* skip malformed */
        }
      }
    }
    clearTimeout(timer);
    return { text: modelText, ms: Math.round(performance.now() - startedAt), error: null };
  } catch (e) {
    return {
      text: null,
      ms: Math.round(performance.now() - startedAt),
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Map Mörbius's free-form differential string to 0 (no disease) /
 * 1 (disease). For binary heart-disease scoring we look for any of
 * a small set of disease-positive substrings; absence → 0.
 */
function scoreHeartDisease(text: string | null): 0 | 1 | null {
  if (!text) return null;
  const lower = text.toLowerCase();
  const positives = [
    'coronary artery disease',
    'cad',
    'ischemic heart',
    'myocardial ischemia',
    'angina',
    'positive',
    'present',
    'yes',
  ];
  const negatives = ['no coronary', 'absent', 'no cad', 'normal cardiac', 'unlikely', 'no '];
  // Tie-break: a leading "no" wins over a later "angina".
  const trimmed = text.trim().toLowerCase();
  if (trimmed.startsWith('no')) return 0;
  if (trimmed.startsWith('yes')) return 1;
  for (const n of negatives) if (lower.includes(n)) return 0;
  for (const p of positives) if (lower.includes(p)) return 1;
  return null;
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx] ?? 0;
}

async function runDataset(d: Dataset): Promise<void> {
  if (d.kind !== 'tabular-csv') {
    console.log(`▸ ${d.id} · skipped (kind=${d.kind} not handled by this script)`);
    return;
  }
  const path = join(process.cwd(), d.path);
  if (!existsSync(path)) {
    console.log(`▸ ${d.id} · skipped (path missing: ${d.path})`);
    if (d.note) console.log(`    ${d.note}`);
    return;
  }
  if (d.id !== 'heart-disease-uci') {
    console.log(`▸ ${d.id} · skipped (only heart-disease-uci has a scorer wired right now)`);
    return;
  }

  console.log(`\n📊 ${d.name} · ${d.task}`);
  console.log('─'.repeat(72));
  const text = await readFile(path, 'utf8');
  const { header, rows } = parseCsv(text);
  const limit = opts.max ?? rows.length;
  const slice = rows.slice(0, limit);

  const targetCol = d.target.name;
  const targetIdx = header.indexOf(targetCol);
  if (targetIdx < 0) throw new Error(`target column ${targetCol} not in CSV`);

  const startedAt = Date.now();
  const outcomes: RowOutcome[] = [];
  let i = 0;
  for (const row of slice) {
    i += 1;
    const expected = row[targetIdx] === '1' ? (1 as const) : (0 as const);
    const prompt = buildPromptForHeartDisease(header, row);
    process.stdout.write(`  ${i}/${slice.length}  expected=${expected}  …  `);
    const r = await runOneRow(prompt);
    const predicted = r.error ? null : scoreHeartDisease(r.text);
    const correct = predicted !== null && predicted === expected;
    outcomes.push({
      rowIndex: i - 1,
      expected,
      predicted,
      modelText: r.text,
      correct,
      latencyMs: r.ms,
      error: r.error,
    });
    console.log(`pred=${predicted ?? '?'}  ${correct ? '✓' : '✗'}  ${r.ms}ms`);
  }

  const correctCount = outcomes.filter((o) => o.correct).length;
  const accuracy = outcomes.length > 0 ? correctCount / outcomes.length : 0;
  const tp = outcomes.filter((o) => o.expected === 1 && o.predicted === 1).length;
  const fp = outcomes.filter((o) => o.expected === 0 && o.predicted === 1).length;
  const fn = outcomes.filter((o) => o.expected === 1 && o.predicted === 0).length;
  const tn = outcomes.filter((o) => o.expected === 0 && o.predicted === 0).length;
  const sensitivity = tp + fn > 0 ? tp / (tp + fn) : 0;
  const specificity = tn + fp > 0 ? tn / (tn + fp) : 0;
  const latencies = outcomes.filter((o) => !o.error).map((o) => o.latencyMs);

  const report = {
    ranAt: new Date(startedAt).toISOString(),
    durationMs: Date.now() - startedAt,
    apiBase: API_BASE,
    dataset: d.id,
    rowsScored: outcomes.length,
    metrics: {
      accuracy,
      sensitivity,
      specificity,
      tp,
      fp,
      fn,
      tn,
      p50LatencyMs: percentile(latencies, 50),
      p95LatencyMs: percentile(latencies, 95),
      meanLatencyMs: Math.round(
        latencies.reduce((s, n) => s + n, 0) / Math.max(1, latencies.length),
      ),
      errorCount: outcomes.filter((o) => o.error).length,
    },
    outcomes,
  };

  const date = new Date().toISOString().slice(0, 10);
  const reportPath = join(process.cwd(), 'docs', 'status', `kaggle-${d.id}-${date}.json`);
  await writeFile(reportPath, JSON.stringify(report, null, 2));

  console.log('\n┌─────────────────────────┬─────────┐');
  const row = (l: string, v: string) => `│ ${l.padEnd(23)} │ ${v.padStart(7)} │`;
  console.log(row('accuracy', `${(accuracy * 100).toFixed(1)}%`));
  console.log(row('correct', `${correctCount}/${outcomes.length}`));
  console.log(row('sensitivity (recall)', `${(sensitivity * 100).toFixed(1)}%`));
  console.log(row('specificity', `${(specificity * 100).toFixed(1)}%`));
  console.log(row('TP / FP / FN / TN', `${tp}/${fp}/${fn}/${tn}`));
  console.log(row('p50 latency', `${report.metrics.p50LatencyMs}ms`));
  console.log(row('errors', String(report.metrics.errorCount)));
  console.log('└─────────────────────────┴─────────┘');
  console.log(`▸ wrote ${reportPath}`);
}

async function main() {
  const idx = await loadIndex();
  const datasets = opts.dataset
    ? idx.sources.filter((d) => d.id === opts.dataset)
    : idx.sources.filter((d) => d.bundled);
  if (datasets.length === 0) {
    console.log(`No datasets matched. Available: ${idx.sources.map((s) => s.id).join(', ')}`);
    return;
  }
  for (const d of datasets) {
    await runDataset(d);
  }
}

main().catch((err) => {
  console.error('kaggle-harness failed:', err);
  process.exit(1);
});
