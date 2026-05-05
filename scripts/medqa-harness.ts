#!/usr/bin/env bun
/**
 * medqa-harness — score Mörbius against real USMLE / MedQA-style
 * multiple-choice clinical questions.
 *
 * Why this matters
 * ────────────────
 * The seeded 15-case harness measures end-to-end orchestration on
 * Mörbius's own corpus. The published frontier benchmarks (Med-PaLM 2
 * 86.6 %, Med-Gemini 91.3 %, GPT-4 medical 86 %, BioGPT 78 %,
 * OpenBioLLM-70B 74 %, Meditron-70B 70.4 %) are scored on multiple-
 * choice medical Q&A — MedQA / USMLE / MedMCQA. Apples-to-apples
 * comparison requires Mörbius to take the same kind of test.
 *
 * This harness reads `scripts/data/medqa-sample.json` (30 curated
 * USMLE-style questions, real guidelines as the answer key — ACC/AHA,
 * IDSA, GINA, GOLD, KDIGO, ADA, ACR/EULAR, AAP, etc.) and submits
 * each as a /orchestrate prompt with explicit "pick A, B, C, or D"
 * framing. The first letter of the diagnostic agent's response is
 * scored against the answer key.
 *
 * Run modes:
 *   bun run morbius:medqa                # score all 30 questions
 *   API_BASE=http://… bun run morbius:medqa
 *
 * Writes:
 *   docs/status/medqa-YYYY-MM-DD.json   # full report
 *
 * The autopilot daemon picks up the latest medqa-*.json each cycle
 * and rolls it into live-accuracy.json so the dev-console Models
 * tab renders Mörbius's MedQA score next to Med-PaLM 2 / Med-Gemini.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const API_BASE = process.env.API_BASE ?? 'http://localhost:8787';
const PER_QUESTION_TIMEOUT_MS = 90_000;
/** Inter-question pause — gives Anthropic / NVIDIA / HF a breather between
 *  /mcq calls, dramatically lowers HTTP 502 rate. Override with
 *  `INTER_Q_DELAY_MS=0 bun run …` for max throughput when the backend can take it. */
const INTER_Q_DELAY_MS = Number(process.env.INTER_Q_DELAY_MS ?? '600');

interface MedQaQuestion {
  id: string;
  specialty: string;
  question: string;
  options: { A: string; B: string; C: string; D: string };
  answer: 'A' | 'B' | 'C' | 'D';
  rationale: string;
}

interface QuestionOutcome {
  id: string;
  specialty: string;
  expected: 'A' | 'B' | 'C' | 'D';
  picked: 'A' | 'B' | 'C' | 'D' | null;
  correct: boolean;
  modelText: string | null;
  latencyMs: number;
  error: string | null;
}

interface MedQaReport {
  ranAt: string;
  durationMs: number;
  apiBase: string;
  questionCount: number;
  metrics: {
    accuracy: number;
    /** Accuracy on questions the backend successfully responded to —
     *  separates real model skill from infrastructure 502s / rate-limits. */
    nonErrorAccuracy: number;
    answeredCount: number;
    perSpecialty: Record<string, { count: number; correct: number; rate: number }>;
    p50LatencyMs: number;
    p95LatencyMs: number;
    meanLatencyMs: number;
    errorCount: number;
  };
  questions: QuestionOutcome[];
}

interface SseEvent {
  type?: string;
  result?: {
    agent?: string;
    data?: {
      differentials?: Array<{ condition?: string }>;
    };
  };
}

function buildPrompt(q: MedQaQuestion): string {
  return [
    'You are answering a USMLE-style multiple-choice clinical question.',
    'Read the case carefully. Pick exactly one answer (A, B, C, or D).',
    'Reply with ONLY the letter at the start of your response, optionally followed by a brief justification.',
    '',
    `Q: ${q.question}`,
    '',
    `A) ${q.options.A}`,
    `B) ${q.options.B}`,
    `C) ${q.options.C}`,
    `D) ${q.options.D}`,
  ].join('\n');
}

/**
 * Extract the picked letter from the model's reply.
 * Strategy:
 *   1. First letter of the text (most-frequent shape: "B. PCI ...")
 *   2. Bare letter at start (e.g. "B" alone)
 *   3. Substring match against the option text — if the model says
 *      "primary PCI" and option B is "...primary PCI for STEMI",
 *      we credit B.
 * Returns null when no signal can be extracted.
 */
function extractAnswer(
  text: string,
  options: MedQaQuestion['options'],
): 'A' | 'B' | 'C' | 'D' | null {
  if (!text) return null;
  const trimmed = text.trim();
  const firstLetter = trimmed.match(/^[A-D]\b/i);
  if (firstLetter?.[0]) return firstLetter[0].toUpperCase() as 'A' | 'B' | 'C' | 'D';

  // Look for the FIRST inline cue like "answer is B" / "the answer: B"
  const inline = trimmed.match(/answer[\s\w]*?[:\s]+([A-D])\b/i);
  if (inline?.[1]) return inline[1].toUpperCase() as 'A' | 'B' | 'C' | 'D';

  // Token-overlap scoring against each option. The model's reply
  // may be a free-form clinical phrase ("Acute MI") rather than a
  // letter; whichever option has the most token overlap with the
  // model text wins. Threshold: ≥ 1 shared content token.
  const stop = new Set([
    'the',
    'a',
    'an',
    'of',
    'with',
    'for',
    'and',
    'or',
    'in',
    'on',
    'to',
    'by',
    'at',
    'as',
    'is',
    'this',
    'that',
    'from',
    'first',
    'then',
    'no',
    'yes',
    'plus',
    'via',
    'via',
    'any',
    'use',
    'reply',
    'letter',
    'start',
    'your',
    'response',
    'only',
    'all',
    'should',
    'if',
    'when',
  ]);
  const tokenize = (s: string): Set<string> =>
    new Set(
      s
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length >= 4 && !stop.has(w)),
    );
  const modelTokens = tokenize(trimmed);
  let bestKey: 'A' | 'B' | 'C' | 'D' | null = null;
  let bestOverlap = 0;
  for (const k of ['A', 'B', 'C', 'D'] as const) {
    const optTokens = tokenize(options[k]);
    let overlap = 0;
    for (const t of optTokens) if (modelTokens.has(t)) overlap += 1;
    if (overlap > bestOverlap) {
      bestKey = k;
      bestOverlap = overlap;
    }
  }
  return bestOverlap >= 1 ? bestKey : null;
}

async function runOneQuestion(q: MedQaQuestion): Promise<QuestionOutcome> {
  const startedAt = performance.now();
  let modelText: string | null = null;
  let directPick: 'A' | 'B' | 'C' | 'D' | null = null;
  let error: string | null = null;

  // Path A — /mcq route. Added in v0.5.0 to fix
  // the 3.3 % MedQA score: the diagnostic agent emits clinical
  // conditions, but MedQA wants a management LETTER. /mcq calls the
  // cloud LLM directly with a tight "reply A/B/C/D" prompt.
  // Retry on 502 / 429 / 5xx — Anthropic occasionally rate-limits
  // when the harness is bursting; brief backoff fixes it.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), PER_QUESTION_TIMEOUT_MS);
      const res = await fetch(`${API_BASE}/mcq`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'X-Dr-Abc-Source': 'medqa-harness' },
        body: JSON.stringify({
          question: q.question,
          options: q.options,
          // v0.7-final accuracy push — pass-through flags from harness.
          // Defaults preserve legacy single-shot behaviour; opt-in via
          // env so re-runs against historical baselines stay clean.
          samples: Number(process.env.MCQ_SAMPLES ?? '1'),
          cot: process.env.MCQ_COT === '1',
          ensemble: process.env.MCQ_ENSEMBLE === '1',
          retrieve: process.env.MCQ_RETRIEVE === '1',
        }),
        signal: ac.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        const j = (await res.json()) as { picked?: string | null; raw?: string };
        modelText = j.raw ?? null;
        if (j.picked && /^[A-D]$/.test(j.picked)) {
          directPick = j.picked as 'A' | 'B' | 'C' | 'D';
        }
        error = null;
        break;
      }
      error = `MCQ HTTP ${res.status}`;
      if (res.status >= 500 || res.status === 429) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1) ** 2));
        continue; // retry
      }
      break; // non-retryable 4xx
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1) ** 2));
    }
  }

  // Path B — /orchestrate fallback. Useful when /mcq is unavailable
  // (no cloud LLM configured) so the harness still produces a row
  // rather than skipping the question entirely.
  if (!directPick && !error) {
    try {
      const ac2 = new AbortController();
      const timer2 = setTimeout(() => ac2.abort(), PER_QUESTION_TIMEOUT_MS);
      const res = await fetch(`${API_BASE}/orchestrate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'X-Dr-Abc-Source': 'medqa-harness' },
        body: JSON.stringify({ text: buildPrompt(q) }),
        signal: ac2.signal,
      });
      if (res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
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
      }
      clearTimeout(timer2);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  const latencyMs = Math.round(performance.now() - startedAt);
  // /mcq direct-letter wins; fall back to extractor on free-form text.
  const picked = directPick ?? (modelText ? extractAnswer(modelText, q.options) : null);
  const correct = picked === q.answer;

  return {
    id: q.id,
    specialty: q.specialty,
    expected: q.answer,
    picked,
    correct,
    modelText,
    latencyMs,
    error,
  };
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx] ?? 0;
}

// ─── arg parsing for source / specialty / limit ──────────────
interface HarnessArgs {
  source: 'seed' | 'medqa' | 'medmcqa' | 'mmlu' | 'mix';
  specialty: string | null;
  limit: number;
}

function parseHarnessArgs(argv: string[]): HarnessArgs {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const source = (get('--source') ?? 'seed') as HarnessArgs['source'];
  if (!['seed', 'medqa', 'medmcqa', 'mmlu', 'mix'].includes(source)) {
    throw new Error(`unknown --source ${source}`);
  }
  return {
    source,
    specialty: get('--specialty') ?? null,
    limit: Number(get('--limit') ?? '0') || (source === 'seed' ? 30 : 200),
  };
}

async function loadJsonl(path: string): Promise<MedQaQuestion[]> {
  const raw = await readFile(path, 'utf8');
  const out: MedQaQuestion[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed) as MedQaQuestion);
    } catch {
      // skip malformed
    }
  }
  return out;
}

/** Deterministic seeded shuffle — Mulberry32. Same seed → same sample. */
function shuffle<T>(arr: T[], seed = 42): T[] {
  let s = seed >>> 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}

async function main() {
  const harnessArgs = parseHarnessArgs(process.argv.slice(2));
  const startedAt = Date.now();
  const cacheDir = join(
    process.env.HF_HOME ?? join(process.env.USERPROFILE ?? '~', '.cache', 'huggingface'),
    'datasets',
    'dr-abc',
  );
  const seedPath = join(process.cwd(), 'scripts', 'data', 'medqa-sample.json');

  // Load source(s)
  let pool: MedQaQuestion[] = [];
  if (harnessArgs.source === 'seed') {
    pool = JSON.parse(await readFile(seedPath, 'utf8'));
  } else if (harnessArgs.source === 'mix') {
    for (const id of ['medqa', 'medmcqa', 'mmlu']) {
      try {
        pool = pool.concat(await loadJsonl(join(cacheDir, `${id}.jsonl`)));
      } catch {
        // dataset not fetched yet — skip
      }
    }
    if (pool.length === 0) {
      console.warn('⚠ no fetched datasets in cache — falling back to seed.');
      pool = JSON.parse(await readFile(seedPath, 'utf8'));
    }
  } else {
    pool = await loadJsonl(join(cacheDir, `${harnessArgs.source}.jsonl`));
  }

  // Filter by specialty (substring, case-insensitive)
  if (harnessArgs.specialty) {
    const needle = harnessArgs.specialty.toLowerCase();
    pool = pool.filter((q) => q.specialty.toLowerCase().includes(needle));
  }

  // Stratified-or-random sample. For mix or large datasets we shuffle
  // deterministically + take limit; the seed corpus stays in author order
  // so historical comparisons stay apples-to-apples.
  const questions =
    harnessArgs.source === 'seed'
      ? pool.slice(0, harnessArgs.limit)
      : shuffle(pool).slice(0, harnessArgs.limit);

  console.log(
    `\n🩺 MedQA harness · source=${harnessArgs.source}${harnessArgs.specialty ? ` specialty="${harnessArgs.specialty}"` : ''} · ${questions.length}/${pool.length} Qs vs ${API_BASE}`,
  );
  console.log('─'.repeat(72));

  const outcomes: QuestionOutcome[] = [];
  let i = 0;
  for (const q of questions) {
    i += 1;
    process.stdout.write(`▸ ${q.id} ${q.specialty.padEnd(18)} ${i}/${questions.length} … `);
    const out = await runOneQuestion(q);
    outcomes.push(out);
    const verdict = out.correct ? '✓' : out.error ? `✗ (${out.error.slice(0, 30)})` : '✗';
    const pickedStr = out.picked ?? '?';
    console.log(
      `${verdict.padEnd(8)} expected=${out.expected} picked=${pickedStr} · ${out.latencyMs}ms`,
    );
    // Inter-question pause — drops Anthropic 502 burst-rate dramatically.
    if (i < questions.length && INTER_Q_DELAY_MS > 0) {
      await new Promise((r) => setTimeout(r, INTER_Q_DELAY_MS));
    }
  }

  const correct = outcomes.filter((o) => o.correct).length;
  const accuracy = outcomes.length > 0 ? correct / outcomes.length : 0;
  const latencies = outcomes.map((o) => o.latencyMs);

  // Per-specialty breakdown
  const perSpecialty: Record<string, { count: number; correct: number; rate: number }> = {};
  for (const o of outcomes) {
    const slot = perSpecialty[o.specialty] ?? { count: 0, correct: 0, rate: 0 };
    slot.count += 1;
    if (o.correct) slot.correct += 1;
    slot.rate = slot.correct / slot.count;
    perSpecialty[o.specialty] = slot;
  }

  // Pre-compute non-error stats so report + console use the same numbers.
  const answeredCount = outcomes.filter((o) => !o.error).length;
  const answeredCorrect = outcomes.filter((o) => !o.error && o.correct).length;
  const nonErrorAccuracy = answeredCount > 0 ? answeredCorrect / answeredCount : 0;

  const report: MedQaReport = {
    ranAt: new Date(startedAt).toISOString(),
    durationMs: Date.now() - startedAt,
    apiBase: API_BASE,
    questionCount: outcomes.length,
    metrics: {
      accuracy,
      nonErrorAccuracy,
      answeredCount,
      perSpecialty,
      p50LatencyMs: percentile(latencies, 50),
      p95LatencyMs: percentile(latencies, 95),
      meanLatencyMs: Math.round(
        latencies.reduce((s, n) => s + n, 0) / Math.max(1, latencies.length),
      ),
      errorCount: outcomes.filter((o) => o.error).length,
    },
    questions: outcomes,
  };

  const date = new Date().toISOString().slice(0, 10);
  const reportPath = join(process.cwd(), 'docs', 'status', `medqa-${date}.json`);
  await writeFile(reportPath, JSON.stringify(report, null, 2));

  console.log('\n┌─────────────────────────┬─────────┐');
  const row = (l: string, v: string) => `│ ${l.padEnd(23)} │ ${v.padStart(7)} │`;
  console.log(row('overall accuracy', `${(accuracy * 100).toFixed(1)}%`));
  console.log(row('non-error accuracy', `${(nonErrorAccuracy * 100).toFixed(1)}%`));
  console.log(row('correct', `${correct}/${outcomes.length}`));
  console.log(row('answered', `${answeredCount}/${outcomes.length}`));
  console.log(row('p50 latency', `${report.metrics.p50LatencyMs}ms`));
  console.log(row('p95 latency', `${report.metrics.p95LatencyMs}ms`));
  console.log(row('errors (502/etc)', String(report.metrics.errorCount)));
  console.log('└─────────────────────────┴─────────┘');
  console.log('\n  per-specialty');
  for (const [spec, s] of Object.entries(perSpecialty).sort((a, b) => b[1].rate - a[1].rate)) {
    console.log(
      `    ${spec.padEnd(20)} ${(s.rate * 100).toFixed(0).padStart(3)}% (${s.correct}/${s.count})`,
    );
  }

  // Compare to published benchmarks.
  const competitors = [
    ['Med-Gemini', 0.913],
    ['Med-PaLM 2', 0.866],
    ['GPT-4 medical', 0.86],
    ['BioGPT', 0.78],
    ['OpenBioLLM-70B', 0.74],
    ['Meditron-70B', 0.704],
  ] as const;
  const ranking = [
    { model: 'Mörbius (live)', score: accuracy },
    ...competitors.map(([m, s]) => ({ model: m, score: s })),
  ].sort((a, b) => b.score - a.score);
  const myRank = ranking.findIndex((r) => r.model === 'Mörbius (live)') + 1;
  console.log(`\n  rank: ${myRank} / ${ranking.length} (vs published frontier)`);
  for (const r of ranking) {
    const marker = r.model === 'Mörbius (live)' ? '◉' : ' ';
    console.log(`    ${marker} ${r.model.padEnd(20)} ${(r.score * 100).toFixed(1)}%`);
  }
  console.log(`\n▸ wrote ${reportPath}`);
}

main().catch((err) => {
  console.error('medqa-harness failed:', err);
  process.exit(1);
});
