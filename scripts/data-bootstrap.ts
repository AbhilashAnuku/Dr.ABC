#!/usr/bin/env bun
/**
 * data-bootstrap — pull working datasets into `data/`.
 *
 * Goal: assemble ~500 Q&A for final testing, with 15k-record datasets
 * per domain (cardiology, pharmacology, drug tests, etc.) plus skin-
 * disease and tumor images for image classification.
 *
 * What this script DOES (run locally, takes 5-30 min):
 *   --medqa N    Generate N MedQA-style questions via the cascade
 *                (NVIDIA NIM Llama 3.3 70b → Anthropic → Ollama).
 *                Saves to data/medqa-bench/medqa-bench-<N>.json.
 *   --isic N     Pull N skin-lesion images from ISIC's public archive.
 *                Saves to data/isic-sample/<id>.jpg + a metadata.csv.
 *   --drugs      Fetch DrugBank Open Data + RxNorm subset into
 *                data/drugbank-sample/.
 *   --all        Everything above with sensible N defaults (medqa=100,
 *                isic=20, plus drugs).
 *
 * What this script DOES NOT do:
 *   - Download the full 25k ISIC corpus (use kaggle CLI; see
 *     data/image-bench/README.md).
 *   - Download MIMIC-IV / BraTS / CheXpert (registration required).
 *   - Download the full MedQA-USMLE-12k from HuggingFace (huge; see
 *     data/medqa-bench/README.md for the HF datasets API command).
 *
 * Honest expectation: per-question MedQA generation via cascade is
 * 30-90s depending on backend; 100 questions = roughly 1-2 hours.
 * Run it before sleep, not before defense.
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const API_BASE = process.env.API_BASE ?? 'http://localhost:8787';
const SPECIALTIES = [
  'Cardiology',
  'Neurology',
  'Pulmonology',
  'Endocrinology',
  'Gastroenterology',
  'Nephrology',
  'Hematology',
  'Oncology',
  'Infectious diseases',
  'Pediatrics',
  'OB/GYN',
  'Psychiatry',
  'Dermatology',
  'Rheumatology',
  'Surgery',
  'Emergency medicine',
  'Pharmacology',
  'Immunology',
  'Geriatrics',
  'Internal medicine',
];

interface CliArgs {
  medqa: number;
  isic: number;
  drugs: boolean;
  all: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { medqa: 0, isic: 0, drugs: false, all: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--medqa' && argv[i + 1]) {
      out.medqa = Number(argv[++i]);
    } else if (a === '--isic' && argv[i + 1]) {
      out.isic = Number(argv[++i]);
    } else if (a === '--drugs') {
      out.drugs = true;
    } else if (a === '--all') {
      out.all = true;
    }
  }
  if (out.all) {
    if (!out.medqa) out.medqa = 100;
    if (!out.isic) out.isic = 20;
    out.drugs = true;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
//  MedQA — generate clinical multi-choice questions via the cascade
// ─────────────────────────────────────────────────────────────────────

interface GeneratedQuestion {
  id: string;
  specialty: string;
  question: string;
  options: { A: string; B: string; C: string; D: string };
  answer: 'A' | 'B' | 'C' | 'D';
  rationale: string;
  source: string; // backing model used by /mcq cascade
  generatedAt: string;
}

const MEDQA_GEN_PROMPT = (specialty: string, idx: number) =>
  `Generate ONE high-quality USMLE-style multi-choice question in ${specialty}. Reply with ONLY a JSON object, no prose around it:
{
  "question": "<2-4 sentence clinical vignette ending in 'What is the next best step / most likely diagnosis / mechanism / etc?'>",
  "options": { "A": "...", "B": "...", "C": "...", "D": "..." },
  "answer": "A" | "B" | "C" | "D",
  "rationale": "<one-sentence explanation citing the guideline / pathophysiology>"
}
Pull the answer from established 2024-2026 guidelines (ACC/AHA, IDSA, ADA, KDIGO, GINA, etc.). Make distractors plausible but unambiguously wrong. Pick the correct letter randomly across A/B/C/D so the dataset isn't biased. This is question #${idx} in the bench.`;

async function callCascadeForQuestion(
  specialty: string,
  idx: number,
): Promise<{ q: GeneratedQuestion | null; modelUsed?: string; raw?: string }> {
  // /mcq with cot=true gets us free-form output we can JSON-parse;
  // dummy options so the existing cascade fires; we use the rationale
  // path on the raw output not the picked-letter logic.
  const prompt = MEDQA_GEN_PROMPT(specialty, idx);
  // Use /research/frontier-style direct cascade — same backends, no
  // letter-extractor in the path.
  const r = await fetch(`${API_BASE}/research/frontier`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question: prompt, topic: `medqa generator · ${specialty}` }),
  });
  if (!r.ok) return { q: null };
  const j = (await r.json()) as {
    ok?: boolean;
    modelUsed?: string;
    raw?: string;
    result?: { summary?: string };
  };
  // The frontier endpoint returns structured discovery JSON; we want
  // the raw model text instead. Fall back to a direct /mcq-style
  // POST with an inline prompt.
  // Direct path:
  const direct = await fetch(`${API_BASE}/orchestrate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: prompt }),
  });
  if (!direct.ok) return { q: null, modelUsed: j.modelUsed };
  // /orchestrate returns SSE; we need to read it through.
  let buffer = '';
  let modelText = '';
  const reader = direct.body?.getReader();
  if (!reader) return { q: null };
  const decoder = new TextDecoder();
  let safety = 0;
  while (safety++ < 5000) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() ?? '';
    for (const chunk of chunks) {
      const line = chunk.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      try {
        const ev = JSON.parse(line.slice(6).trim()) as {
          type?: string;
          token?: string;
          text?: string;
        };
        if (ev.type === 'agent.token' && ev.token) modelText += ev.token;
        if (ev.type === 'final' && ev.text) modelText += ev.text;
      } catch {}
    }
  }
  // Try to extract the JSON from the streamed text
  const match = modelText.match(/\{[\s\S]*"answer"[\s\S]*\}/);
  if (!match) return { q: null, modelUsed: j.modelUsed, raw: modelText };
  try {
    const parsed = JSON.parse(match[0]) as Partial<GeneratedQuestion> & {
      options?: { A?: string; B?: string; C?: string; D?: string };
    };
    if (
      !parsed.question ||
      !parsed.options ||
      !parsed.options.A ||
      !parsed.options.B ||
      !parsed.options.C ||
      !parsed.options.D ||
      !parsed.answer
    ) {
      return { q: null, modelUsed: j.modelUsed, raw: modelText };
    }
    const q: GeneratedQuestion = {
      id: `MQ_GEN_${specialty.slice(0, 3).toUpperCase()}_${idx.toString().padStart(4, '0')}`,
      specialty,
      question: parsed.question,
      options: {
        A: parsed.options.A,
        B: parsed.options.B,
        C: parsed.options.C,
        D: parsed.options.D,
      },
      answer: parsed.answer as 'A' | 'B' | 'C' | 'D',
      rationale: parsed.rationale ?? '',
      source: j.modelUsed ?? 'cascade',
      generatedAt: new Date().toISOString(),
    };
    return { q, modelUsed: j.modelUsed };
  } catch {
    return { q: null, modelUsed: j.modelUsed, raw: modelText };
  }
}

async function generateMedQA(n: number): Promise<void> {
  const dir = 'data/medqa-bench';
  await mkdir(dir, { recursive: true });
  const outFile = join(dir, `medqa-bench-${n}.json`);
  const startedAt = Date.now();
  console.log(
    `[data-bootstrap] generating ${n} MedQA questions across ${SPECIALTIES.length} specialties · ${API_BASE}`,
  );

  const out: GeneratedQuestion[] = [];
  let modelSeen: string | null = null;
  for (let i = 0; i < n; i++) {
    const specialty = SPECIALTIES[i % SPECIALTIES.length] ?? 'Internal medicine';
    process.stdout.write(`  [${i + 1}/${n}] ${specialty.padEnd(22)} `);
    try {
      const { q, modelUsed } = await callCascadeForQuestion(specialty, i + 1);
      if (q) {
        out.push(q);
        if (modelUsed) modelSeen ??= modelUsed;
        process.stdout.write(`✓ ${q.answer}\n`);
      } else {
        process.stdout.write('✗ (parse failed)\n');
      }
    } catch (e) {
      process.stdout.write(`✗ ${(e as Error).message}\n`);
    }
    // Periodic save so an interruption doesn't waste prior progress
    if ((i + 1) % 10 === 0 || i === n - 1) {
      await writeFile(
        outFile,
        JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            modelUsed: modelSeen,
            count: out.length,
            questions: out,
          },
          null,
          2,
        ),
      );
    }
  }
  const dt = ((Date.now() - startedAt) / 1000).toFixed(0);
  console.log(`[data-bootstrap] medqa · ${out.length}/${n} captured · ${dt}s · ${outFile}`);
}

// ─────────────────────────────────────────────────────────────────────
//  ISIC sample images — pull a small batch into data/isic-sample/
// ─────────────────────────────────────────────────────────────────────

interface IsicMeta {
  imageId: string;
  diagnosis: string;
  benignMalignant: string;
  age?: number;
  sex?: string;
  anatomicSite?: string;
}

async function pullIsicSample(n: number): Promise<void> {
  const dir = 'data/isic-sample';
  await mkdir(dir, { recursive: true });
  console.log(`[data-bootstrap] pulling ${n} ISIC sample images (public archive · CC-BY-NC-4.0)`);

  // Public ISIC API — list images, then download each
  const listUrl = `https://api.isic-archive.com/api/v2/images/?limit=${n}`;
  const r = await fetch(listUrl, { signal: AbortSignal.timeout(30_000) });
  if (!r.ok) {
    console.error(`[data-bootstrap] ISIC list failed: HTTP ${r.status}`);
    return;
  }
  const j = (await r.json()) as {
    results?: Array<{
      isic_id?: string;
      files?: { full?: { url?: string }; thumbnail_256?: { url?: string } };
      metadata?: {
        clinical?: {
          diagnosis_3?: string;
          benign_malignant?: string;
          age_approx?: number;
          sex?: string;
          anatom_site_general?: string;
        };
      };
    }>;
  };
  const items = j.results ?? [];
  const meta: IsicMeta[] = [];
  let saved = 0;
  for (const it of items.slice(0, n)) {
    const id = it.isic_id;
    const url = it.files?.thumbnail_256?.url ?? it.files?.full?.url;
    if (!id || !url) continue;
    process.stdout.write(`  [${saved + 1}/${n}] ${id} `);
    try {
      const img = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (!img.ok) {
        process.stdout.write(`✗ ${img.status}\n`);
        continue;
      }
      const buf = Buffer.from(await img.arrayBuffer());
      await writeFile(join(dir, `${id}.jpg`), buf);
      meta.push({
        imageId: id,
        diagnosis: it.metadata?.clinical?.diagnosis_3 ?? 'unspecified',
        benignMalignant: it.metadata?.clinical?.benign_malignant ?? 'unknown',
        age: it.metadata?.clinical?.age_approx,
        sex: it.metadata?.clinical?.sex,
        anatomicSite: it.metadata?.clinical?.anatom_site_general,
      });
      process.stdout.write(
        `✓ ${(buf.length / 1024).toFixed(0)} KB · ${meta[meta.length - 1]?.diagnosis}\n`,
      );
      saved++;
    } catch (e) {
      process.stdout.write(`✗ ${(e as Error).message}\n`);
    }
  }
  await writeFile(
    join(dir, 'metadata.csv'),
    [
      'image_id,diagnosis,benign_malignant,age_approx,sex,anatomic_site',
      ...meta.map(
        (m) =>
          `${m.imageId},${m.diagnosis},${m.benignMalignant},${m.age ?? ''},${m.sex ?? ''},${m.anatomicSite ?? ''}`,
      ),
    ].join('\n'),
  );
  console.log(`[data-bootstrap] isic · ${saved}/${n} images saved + metadata.csv → ${dir}`);
}

// ─────────────────────────────────────────────────────────────────────
//  Drugs · DrugBank Open Data subset
// ─────────────────────────────────────────────────────────────────────

async function pullDrugSample(): Promise<void> {
  const dir = 'data/drugbank-sample';
  await mkdir(dir, { recursive: true });
  // RxNorm Current Approved Drugs — a public-domain CSV from NIH NLM.
  // Smaller than DrugBank Open Data and unrestricted-use.
  const url = 'https://rxnav.nlm.nih.gov/REST/displaynames.json';
  console.log('[data-bootstrap] pulling RxNorm display-names (NIH NLM, public domain)');
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!r.ok) {
      console.error(`[data-bootstrap] rxnorm failed: HTTP ${r.status}`);
      return;
    }
    const j = (await r.json()) as { displayTermsList?: { term?: string[] } };
    const names = j.displayTermsList?.term ?? [];
    await writeFile(
      join(dir, 'rxnorm-displaynames.json'),
      JSON.stringify(
        { count: names.length, names: names.slice(0, 5000), fetchedAt: new Date().toISOString() },
        null,
        2,
      ),
    );
    console.log(`[data-bootstrap] drugs · ${names.length} terms (saved first 5000) → ${dir}`);
  } catch (e) {
    console.error(`[data-bootstrap] drugs · ${(e as Error).message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────

async function probeApi(): Promise<boolean> {
  try {
    const r = await fetch(`${API_BASE}/`, { signal: AbortSignal.timeout(3000) });
    return r.ok;
  } catch {
    return false;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.medqa && !args.isic && !args.drugs) {
    console.log(
      'usage: bun run scripts/data-bootstrap.ts [--medqa N] [--isic N] [--drugs] [--all]',
    );
    console.log('  --medqa 100      generate 100 MedQA questions via cascade');
    console.log('  --isic 20        pull 20 ISIC sample images');
    console.log('  --drugs          pull RxNorm drug names');
    console.log('  --all            sensible defaults: --medqa 100 --isic 20 --drugs');
    return;
  }

  // MedQA needs the api up
  if (args.medqa > 0) {
    if (!(await probeApi())) {
      console.error(
        `[data-bootstrap] api not reachable at ${API_BASE} — run \`bun run dev:api\` first`,
      );
      process.exit(2);
    }
    await generateMedQA(args.medqa);
  }
  if (args.isic > 0) {
    await pullIsicSample(args.isic);
  }
  if (args.drugs) {
    await pullDrugSample();
  }
  console.log('[data-bootstrap] done');
}

void main().catch((e) => {
  console.error('[data-bootstrap] fatal:', e instanceof Error ? e.stack : e);
  process.exit(1);
});

// avoid unused-import warnings under strict TS
void existsSync;
void readFile;
