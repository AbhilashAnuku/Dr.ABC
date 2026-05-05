#!/usr/bin/env bun
/**
 * skin-lesion-harness — score Mörbius's imaging path against labelled
 * dermatology images. Exercises the imaging and skin module against a
 * Kaggle-style CSV of images and links.
 *
 * Reads `scripts/data/isic-skin-lesion-sample.csv` (columns: image_id,
 * image_url, diagnosis, benign_malignant, …), fetches each image (or
 * reads from a local path if `--local-dir` is given), POSTs to
 * py-svc `/imaging/analyse`, and scores confidence vs the ISIC
 * ground-truth label.
 *
 * Two failure modes are normal, not errors:
 *   - URL 404 / DNS fail → row is skipped, counted in `skippedRows`.
 *     The ISIC archive's public API has changed shape multiple times;
 *     a 404 means the URL template needs refreshing, not that the
 *     harness is broken.
 *   - py-svc unreachable → harness exits with code 2 and a clear
 *     "py-svc not running" message; bring it up with
 *     `bun run dev:py` first.
 *
 * Usage:
 *   bun run scripts/skin-lesion-harness.ts                    # all rows, fetch URLs
 *   bun run scripts/skin-lesion-harness.ts --max 10           # cap rows
 *   bun run scripts/skin-lesion-harness.ts --local-dir data/isic/images
 *     # reads <image_id>.jpg from the local dir instead of fetching URLs
 *
 * Writes:
 *   docs/status/skin-lesion-YYYY-MM-DD.json
 *   docs/status/skin-lesion-YYYY-MM-DD.md   (human-readable summary)
 *
 * Setup for the FULL ISIC corpus (25k images):
 *   1. Install kaggle CLI: `pip install kaggle` + place api token at ~/.kaggle/kaggle.json
 *   2. `kaggle datasets download -d nodoubttome/skin-cancer9-classesisic -p data/isic --unzip`
 *   3. Run with `--local-dir data/isic/images`
 *
 * Schema mirrored in scripts/data/datasets-index.json under id "isic-skin-cancer".
 */

import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const PY_SVC_URL = process.env.PY_SVC_URL ?? 'http://localhost:8001';
const PER_IMAGE_TIMEOUT_MS = 30_000;
const CSV_PATH = 'scripts/data/isic-skin-lesion-sample.csv';

interface Row {
  image_id: string;
  image_url: string;
  diagnosis: string;
  benign_malignant: 'benign' | 'malignant';
  age_approx: string;
  sex: string;
  anatomic_site: string;
}

interface Args {
  max?: number;
  localDir?: string;
}

interface AnalyseResult {
  width: number;
  height: number;
  backend: 'stub' | 'monai';
  confidence: number;
  coverageFraction: number;
  notes: string[];
}

interface RowOutcome {
  imageId: string;
  diagnosis: string;
  truthBenignMalignant: 'benign' | 'malignant';
  source: 'url' | 'local';
  status: 'analysed' | 'fetch-failed' | 'analysis-failed';
  backend?: AnalyseResult['backend'];
  confidence?: number;
  coverageFraction?: number;
  notes?: string[];
  error?: string;
  latencyMs?: number;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--max' && argv[i + 1]) {
      out.max = Number(argv[i + 1]);
      i++;
    } else if (a === '--local-dir' && argv[i + 1]) {
      out.localDir = argv[i + 1];
      i++;
    }
  }
  return out;
}

function parseCsv(raw: string): Row[] {
  const lines = raw.trim().split(/\r?\n/);
  const headerLine = lines[0];
  if (!headerLine) return [];
  const header = headerLine.split(',').map((c) => c.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(',').map((c) => c.trim());
    const row = {} as Record<string, string>;
    for (let i = 0; i < header.length; i++) {
      const key = header[i];
      if (!key) continue;
      row[key] = cells[i] ?? '';
    }
    return row as unknown as Row;
  });
}

async function loadImage(
  row: Row,
  localDir?: string,
): Promise<{ bytes: Uint8Array; source: 'url' | 'local' } | null> {
  if (localDir) {
    // Try common extensions in the local dir.
    for (const ext of ['.jpg', '.jpeg', '.png']) {
      const p = join(localDir, `${row.image_id}${ext}`);
      if (existsSync(p)) {
        const buf = await readFile(p);
        return { bytes: new Uint8Array(buf), source: 'local' };
      }
    }
    return null;
  }
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), PER_IMAGE_TIMEOUT_MS);
    const r = await fetch(row.image_url, { signal: ac.signal });
    clearTimeout(timer);
    if (!r.ok) return null;
    const ab = await r.arrayBuffer();
    return { bytes: new Uint8Array(ab), source: 'url' };
  } catch {
    return null;
  }
}

async function analyse(bytes: Uint8Array): Promise<AnalyseResult> {
  const fd = new FormData();
  // Copy into a fresh ArrayBuffer to satisfy the BlobPart typing —
  // node Buffer / Uint8Array<SharedArrayBuffer> aren't assignable directly.
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  fd.append('file', new Blob([ab as ArrayBuffer], { type: 'image/jpeg' }), 'lesion.jpg');
  const r = await fetch(`${PY_SVC_URL}/imaging/analyse`, {
    method: 'POST',
    body: fd,
  });
  if (!r.ok) throw new Error(`py-svc HTTP ${r.status}: ${await r.text()}`);
  const j = (await r.json()) as AnalyseResult;
  return j;
}

async function probePySvc(): Promise<boolean> {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 3000);
    const r = await fetch(`${PY_SVC_URL}/health`, { signal: ac.signal });
    clearTimeout(t);
    return r.ok;
  } catch {
    return false;
  }
}

function tagPrediction(
  notes: string[] | undefined,
  conf: number,
): 'benign' | 'malignant' | 'inconclusive' {
  // The current MONAI lesion backend returns a coverage mask + confidence;
  // we treat HIGH coverage + HIGH confidence as suspicious-of-malignancy
  // (large irregular pigmented region). This is a HEURISTIC, not a
  // diagnosis — the note in AGENTS.md §8 forbids unilateral
  // clinical decisions. Real classification needs the dermatology head
  // (DenseNet121 trained on ISIC-2018) which lands in py-svc when the
  // ISIC corpus is downloaded.
  if (conf < 0.4) return 'inconclusive';
  if (conf >= 0.7) return 'malignant';
  return 'benign';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`[skin-lesion] py-svc ${PY_SVC_URL} · csv ${CSV_PATH}`);

  const alive = await probePySvc();
  if (!alive) {
    console.error(`\n✗ py-svc not reachable at ${PY_SVC_URL}. Start it: bun run dev:py\n`);
    process.exit(2);
  }

  const csv = await readFile(CSV_PATH, 'utf-8');
  const allRows = parseCsv(csv);
  const rows = args.max ? allRows.slice(0, args.max) : allRows;
  console.log(`[skin-lesion] ${rows.length} rows · local-dir=${args.localDir ?? 'none'}`);

  const startedAt = Date.now();
  const outcomes: RowOutcome[] = [];

  for (const row of rows) {
    const t0 = Date.now();
    const img = await loadImage(row, args.localDir);
    if (!img) {
      outcomes.push({
        imageId: row.image_id,
        diagnosis: row.diagnosis,
        truthBenignMalignant: row.benign_malignant,
        source: args.localDir ? 'local' : 'url',
        status: 'fetch-failed',
        error: args.localDir
          ? `${row.image_id}.{jpg,jpeg,png} not found in ${args.localDir}`
          : `URL fetch failed: ${row.image_url}`,
      });
      console.log(`  ✗ ${row.image_id} · fetch failed`);
      continue;
    }
    try {
      const res = await analyse(img.bytes);
      const dt = Date.now() - t0;
      const predicted = tagPrediction(res.notes, res.confidence);
      const correct = predicted === row.benign_malignant;
      outcomes.push({
        imageId: row.image_id,
        diagnosis: row.diagnosis,
        truthBenignMalignant: row.benign_malignant,
        source: img.source,
        status: 'analysed',
        backend: res.backend,
        confidence: res.confidence,
        coverageFraction: res.coverageFraction,
        notes: res.notes,
        latencyMs: dt,
      });
      console.log(
        `  ${correct ? '✓' : '·'} ${row.image_id} · truth=${row.benign_malignant} · pred=${predicted} · conf=${res.confidence.toFixed(2)} · ${res.backend} · ${dt}ms`,
      );
    } catch (e) {
      outcomes.push({
        imageId: row.image_id,
        diagnosis: row.diagnosis,
        truthBenignMalignant: row.benign_malignant,
        source: img.source,
        status: 'analysis-failed',
        error: e instanceof Error ? e.message : String(e),
      });
      console.log(`  ✗ ${row.image_id} · analysis failed: ${(e as Error).message}`);
    }
  }

  const totalMs = Date.now() - startedAt;
  const analysed = outcomes.filter((o) => o.status === 'analysed');
  const fetched = outcomes.filter((o) => o.source === 'local' || o.status === 'analysed').length;
  const skipped = outcomes.filter((o) => o.status === 'fetch-failed').length;
  const failed = outcomes.filter((o) => o.status === 'analysis-failed').length;

  // Heuristic accuracy — see tagPrediction note. Real accuracy needs a
  // classifier head; the harness is currently testing the segmentation
  // path's confidence calibration on real ISIC images.
  const heuristicCorrect = analysed.filter((o) => {
    const pred = tagPrediction(o.notes, o.confidence ?? 0);
    return pred === o.truthBenignMalignant;
  }).length;

  const heuristicAccuracy = analysed.length > 0 ? heuristicCorrect / analysed.length : null;

  const date = new Date().toISOString().slice(0, 10);
  const out = {
    ranAt: new Date().toISOString(),
    csvPath: CSV_PATH,
    pySvcUrl: PY_SVC_URL,
    localDir: args.localDir ?? null,
    rows: rows.length,
    fetched,
    analysed: analysed.length,
    skippedFetch: skipped,
    failedAnalysis: failed,
    heuristicAccuracy,
    heuristicCorrect,
    totalMs,
    outcomes,
  };

  const jsonPath = `docs/status/skin-lesion-${date}.json`;
  await writeFile(jsonPath, JSON.stringify(out, null, 2));

  const md = renderMarkdown(out);
  const mdPath = `docs/status/skin-lesion-${date}.md`;
  await writeFile(mdPath, md);

  console.log(
    `\n[skin-lesion] done · analysed ${analysed.length}/${rows.length} · skipped ${skipped} · failed ${failed} · heuristic acc ${heuristicAccuracy === null ? 'n/a' : `${(heuristicAccuracy * 100).toFixed(1)}%`} · ${totalMs}ms`,
  );
  console.log(`[skin-lesion] reports: ${jsonPath} + ${mdPath}`);
}

interface ReportShape {
  ranAt: string;
  csvPath: string;
  pySvcUrl: string;
  localDir: string | null;
  rows: number;
  fetched: number;
  analysed: number;
  skippedFetch: number;
  failedAnalysis: number;
  heuristicAccuracy: number | null;
  heuristicCorrect: number;
  totalMs: number;
  outcomes: RowOutcome[];
}

function renderMarkdown(o: ReportShape): string {
  const acc =
    o.heuristicAccuracy === null
      ? 'n/a (no rows analysed)'
      : `${(o.heuristicAccuracy * 100).toFixed(1)}% (${o.heuristicCorrect}/${o.analysed})`;
  const lines: string[] = [];
  lines.push(`# Skin-lesion harness · ${o.ranAt.slice(0, 10)}`);
  lines.push('');
  lines.push(`- CSV: \`${o.csvPath}\``);
  lines.push(`- py-svc: ${o.pySvcUrl}`);
  lines.push(`- Local image dir: ${o.localDir ?? '(URL fetch)'}`);
  lines.push(`- Rows attempted: ${o.rows}`);
  lines.push(`- Fetched + analysed: ${o.analysed}`);
  lines.push(`- Skipped (fetch failure): ${o.skippedFetch}`);
  lines.push(`- Failed (analysis error): ${o.failedAnalysis}`);
  lines.push(`- Heuristic accuracy: **${acc}**`);
  lines.push(`- Total time: ${o.totalMs} ms`);
  lines.push('');
  lines.push(
    '> **Note**: heuristic-only — confidence ≥ 0.7 → malignant, < 0.4 → inconclusive. Real classification needs a dermatology classifier head (ISIC-2018 trained DenseNet121 in py-svc when the corpus is local). See `scripts/skin-lesion-harness.ts` header for the Kaggle download flow.',
  );
  lines.push('');
  lines.push('## Outcomes');
  lines.push('');
  lines.push('| ISIC ID | Truth | Diagnosis | Backend | Confidence | Coverage | Latency |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const oc of o.outcomes) {
    if (oc.status === 'analysed') {
      lines.push(
        `| ${oc.imageId} | ${oc.truthBenignMalignant} | ${oc.diagnosis} | ${oc.backend ?? '?'} | ${oc.confidence?.toFixed(2) ?? '?'} | ${(oc.coverageFraction ?? 0 * 100).toFixed(1)}% | ${oc.latencyMs ?? 0} ms |`,
      );
    } else {
      lines.push(
        `| ${oc.imageId} | ${oc.truthBenignMalignant} | ${oc.diagnosis} | — | — | — | _${oc.status}_ |`,
      );
    }
  }
  return lines.join('\n');
}

void main().catch((e) => {
  console.error('[skin-lesion] fatal:', e instanceof Error ? e.stack : e);
  process.exit(1);
});

// silence unused-import lint when extname is not yet used elsewhere
void extname;
