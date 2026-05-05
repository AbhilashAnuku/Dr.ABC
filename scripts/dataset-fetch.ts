#!/usr/bin/env bun
/**
 * dataset-fetch — pull large medical-Q datasets from Hugging Face into
 * the local cache, normalised to one JSONL line per question.
 *
 * Why:
 *   The shipped MedQA seed has 30 hand-curated questions — fine for a
 *   project demo, useless for "10k per specialty" claims. Real public
 *   datasets exist and are free:
 *
 *     dataset    rows      coverage
 *     ─────────  ────────  ────────────────────────────────────────
 *     medmcqa    ~194,000  21 specialty subjects (Indian medical exams)
 *     medqa      ~12,723   USMLE Step 1-3 (4-option)
 *     mmlu       ~3,063    clinical_knowledge + professional_medicine
 *
 *   Combined → ~210k real medical Qs · stratified by subject we hit
 *   10k+ for every major specialty (medicine, surgery, pharmacology,
 *   pathology, anatomy, microbiology, biochemistry).
 *
 * Storage:
 *   F:\huggingface-cache\datasets\dr-abc\<dataset>.jsonl
 *   (HF_HOME redirect already set on the local machine)
 *
 *   Each line is one MedQaQuestion shape:
 *     {"id":"medmcqa-0","specialty":"Pharmacology",
 *      "question":"...","options":{"A":"...","B":"...","C":"...","D":"..."},
 *      "answer":"A","rationale":"..."}
 *
 * Usage:
 *   bun run scripts/dataset-fetch.ts                         # all datasets, all rows
 *   bun run scripts/dataset-fetch.ts --dataset medmcqa       # one dataset
 *   bun run scripts/dataset-fetch.ts --dataset medmcqa --limit 5000   # cap for testing
 *   bun run scripts/dataset-fetch.ts --resume                # continue from last offset
 *
 * Source: HF datasets-server REST API (free · unauthenticated · no key needed).
 *   GET https://datasets-server.huggingface.co/rows?dataset=…&config=…&split=train&offset=N&length=100
 */

import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const PAGE_SIZE = 100;
const POLITE_DELAY_MS = 1000; // 1 req/s · stays under HF datasets-server limits
const MAX_RETRIES = 5;
const RETRY_BASE_MS = 30_000; // 30 s base on 429 · doubles each retry

interface DatasetSpec {
  /** Local id used in filenames. */
  id: 'medmcqa' | 'medqa' | 'mmlu';
  /** HF dataset path. */
  hf: string;
  /** HF config name. */
  config: string;
  /** Split — usually train. */
  split: 'train' | 'test' | 'validation';
  /** Approx total rows (for progress printout). */
  approxRows: number;
  /** Field-extractor — turns one HF row into our MedQaQuestion shape. */
  normalize: (row: Record<string, unknown>, index: number) => MedQaQuestion | null;
}

interface MedQaQuestion {
  id: string;
  specialty: string;
  question: string;
  options: { A: string; B: string; C: string; D: string };
  answer: 'A' | 'B' | 'C' | 'D';
  rationale: string;
}

const DATASETS: DatasetSpec[] = [
  {
    id: 'medmcqa',
    hf: 'openlifescienceai/medmcqa',
    config: 'default',
    split: 'train',
    approxRows: 194000,
    normalize: (row, index) => {
      const r = row as {
        id?: string;
        question?: string;
        opa?: string;
        opb?: string;
        opc?: string;
        opd?: string;
        cop?: number;
        exp?: string;
        subject_name?: string;
        topic_name?: string;
      };
      const cop = typeof r.cop === 'number' ? r.cop : -1;
      if (cop < 0 || cop > 3) return null;
      if (!r.question || !r.opa || !r.opb || !r.opc || !r.opd) return null;
      const letters: Array<'A' | 'B' | 'C' | 'D'> = ['A', 'B', 'C', 'D'];
      return {
        id: `medmcqa-${r.id ?? index}`,
        specialty: r.subject_name ?? r.topic_name ?? 'unknown',
        question: r.question,
        options: { A: r.opa, B: r.opb, C: r.opc, D: r.opd },
        answer: letters[cop] ?? 'A',
        rationale: r.exp ?? '',
      };
    },
  },
  {
    id: 'medqa',
    // Note: bigbio/med_qa needs arbitrary Python and the HF datasets-server
    // refuses it. GBaker/MedQA-USMLE-4-options is a clean parquet
    // re-host of the same questions (10,178 train · 1,273 test).
    hf: 'GBaker/MedQA-USMLE-4-options',
    config: 'default',
    split: 'train',
    approxRows: 10178,
    normalize: (row, index) => {
      const r = row as {
        question?: string;
        answer?: string;
        answer_idx?: string;
        options?: { A?: string; B?: string; C?: string; D?: string };
        meta_info?: string;
      };
      if (!r.question || !r.options) return null;
      const opts = r.options;
      if (!opts.A || !opts.B || !opts.C || !opts.D) return null;
      const ans = r.answer_idx?.toUpperCase();
      if (ans !== 'A' && ans !== 'B' && ans !== 'C' && ans !== 'D') return null;
      // meta_info often contains the USMLE step + a specialty hint
      // (e.g. "step1" / "step2" / disease name). We use it as the
      // specialty bucket so the harness can stratify-sample.
      const specialty = r.meta_info?.trim() || 'USMLE';
      return {
        id: `medqa-${index}`,
        specialty,
        question: r.question,
        options: { A: opts.A, B: opts.B, C: opts.C, D: opts.D },
        answer: ans,
        rationale: r.answer ?? '',
      };
    },
  },
  {
    id: 'mmlu',
    hf: 'cais/mmlu',
    config: 'clinical_knowledge',
    split: 'test',
    approxRows: 265,
    normalize: (row, index) => {
      const r = row as { question?: string; choices?: string[]; answer?: number };
      if (!r.question || !r.choices || r.choices.length < 4 || typeof r.answer !== 'number') {
        return null;
      }
      const letters: Array<'A' | 'B' | 'C' | 'D'> = ['A', 'B', 'C', 'D'];
      return {
        id: `mmlu-clinical-${index}`,
        specialty: 'Clinical knowledge',
        question: r.question,
        options: {
          A: r.choices[0] ?? '',
          B: r.choices[1] ?? '',
          C: r.choices[2] ?? '',
          D: r.choices[3] ?? '',
        },
        answer: letters[r.answer] ?? 'A',
        rationale: '',
      };
    },
  },
];

// ─── arg parsing ────────────────────────────────────────────────
interface Args {
  datasets: DatasetSpec[];
  limit: number | null;
  resume: boolean;
  cacheDir: string;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const dataset = get('--dataset');
  const limitRaw = get('--limit');
  const resume = argv.includes('--resume');
  const datasets =
    !dataset || dataset === 'all' ? DATASETS : DATASETS.filter((d) => d.id === dataset);
  if (datasets.length === 0) {
    throw new Error(
      `unknown --dataset ${dataset} · valid: ${DATASETS.map((d) => d.id).join(', ')}, all`,
    );
  }
  const home = process.env.HF_HOME ?? join(process.env.USERPROFILE ?? '~', '.cache', 'huggingface');
  return {
    datasets,
    limit: limitRaw ? Number(limitRaw) : null,
    resume,
    cacheDir: join(home, 'datasets', 'dr-abc'),
  };
}

const args = parseArgs(process.argv.slice(2));

// ─── helpers ────────────────────────────────────────────────────
async function fetchPage(
  ds: DatasetSpec,
  offset: number,
  length: number,
): Promise<Record<string, unknown>[]> {
  const url = `https://datasets-server.huggingface.co/rows?dataset=${encodeURIComponent(ds.hf)}&config=${encodeURIComponent(ds.config)}&split=${ds.split}&offset=${offset}&length=${length}`;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const r = await fetch(url, { headers: { 'user-agent': 'dr-abc-morbius-research/0.7' } });
    if (r.ok) {
      const j = (await r.json()) as {
        rows?: Array<{ row_idx: number; row: Record<string, unknown> }>;
      };
      return (j.rows ?? []).map((x) => x.row);
    }
    if (r.status === 429 || r.status >= 500) {
      const retryAfter = Number(r.headers.get('retry-after') ?? '0');
      const wait = retryAfter > 0 ? retryAfter * 1000 : RETRY_BASE_MS * 2 ** attempt;
      console.warn(
        `  ⚠ HTTP ${r.status} at offset=${offset} · attempt ${attempt + 1}/${MAX_RETRIES} · wait ${Math.round(wait / 1000)}s`,
      );
      await new Promise((res) => setTimeout(res, wait));
      continue;
    }
    // non-retryable error (4xx other than 429)
    throw new Error(
      `HTTP ${r.status} from datasets-server: ${(await r.text().catch(() => '')).slice(0, 200)}`,
    );
  }
  throw new Error(`exhausted ${MAX_RETRIES} retries at offset=${offset}`);
}

async function fetchOne(ds: DatasetSpec): Promise<{ written: number; skipped: number }> {
  const outFile = join(args.cacheDir, `${ds.id}.jsonl`);
  const offsetFile = join(args.cacheDir, `${ds.id}.offset.txt`);
  let startOffset = 0;
  if (args.resume && existsSync(offsetFile)) {
    startOffset = Number((await readFile(offsetFile, 'utf8')).trim()) || 0;
    console.log(`  ▸ resume from offset=${startOffset}`);
  } else {
    // Fresh start — empty the output file
    await writeFile(outFile, '');
  }

  let written = 0;
  let skipped = 0;
  let offset = startOffset;
  const cap = args.limit ?? ds.approxRows;
  const start = Date.now();

  while (offset < cap) {
    const length = Math.min(PAGE_SIZE, cap - offset);
    let rows: Record<string, unknown>[];
    try {
      rows = await fetchPage(ds, offset, length);
    } catch (e) {
      console.warn(
        `  ⚠ page fetch failed at offset=${offset}: ${e instanceof Error ? e.message : e}`,
      );
      // Save offset for resume + back off briefly
      await writeFile(offsetFile, String(offset));
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }
    if (rows.length === 0) break;

    const lines: string[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      const norm = ds.normalize(row, offset + i);
      if (norm) {
        lines.push(`${JSON.stringify(norm)}\n`);
        written += 1;
      } else {
        skipped += 1;
      }
    }
    if (lines.length > 0) await appendFile(outFile, lines.join(''));
    offset += rows.length;
    await writeFile(offsetFile, String(offset));

    // Periodic progress
    if (offset % 1000 === 0 || offset >= cap) {
      const elapsed = (Date.now() - start) / 1000;
      const rate = offset > startOffset ? (offset - startOffset) / Math.max(1, elapsed) : 0;
      const eta = rate > 0 ? Math.round((cap - offset) / rate) : 0;
      console.log(
        `  ▸ ${offset}/${cap} rows · written=${written} skipped=${skipped} · ${rate.toFixed(0)} r/s · eta ${eta}s`,
      );
    }
    await new Promise((r) => setTimeout(r, POLITE_DELAY_MS));
  }

  return { written, skipped };
}

async function main() {
  await mkdir(args.cacheDir, { recursive: true });
  console.log('📥 dataset-fetch');
  console.log(`   cache : ${args.cacheDir}`);
  console.log(`   limit : ${args.limit ?? 'no cap (full datasets)'}`);
  console.log(`   resume: ${args.resume}`);
  console.log('');

  for (const ds of args.datasets) {
    console.log(`━━━ ${ds.id} (${ds.hf} · ${ds.config} · split=${ds.split}) ━━━`);
    const { written, skipped } = await fetchOne(ds);
    console.log(`  ✓ wrote ${written} rows · skipped ${skipped} malformed`);
    console.log('');
  }
}

main().catch((err) => {
  console.error('dataset-fetch failed:', err);
  process.exit(1);
});
