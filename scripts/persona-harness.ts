#!/usr/bin/env bun
/**
 * persona-harness — score Mörbius against three real-world personas
 * with weighted persona-specific accuracy.
 *
 * Why personas instead of one global score
 * ────────────────────────────────────────
 * "Mörbius scored 73 % overall" hides a critical asymmetry: a junior
 * doctor cares MOSTLY about top-condition + safety; a non-clinical
 * patient cares MOSTLY about drug-safety + tone + sane next step;
 * a med student cares about textbook-correctness + explanation.
 * Each persona has a different weighted blend of the underlying
 * metrics, and accuracy on persona-specific cases is what matters
 * for that persona's product-market fit.
 *
 * The 3 personas:
 *   - doctor    Dr. Anuj — junior attending, late-shift ER (8 cases)
 *   - patient   Riya — 32 y/o non-clinical consumer (7 cases)
 *   - student   Simran — final-year MedStu, USMLE Step 2 (10 cases)
 *
 * Source of truth: scripts/data/personas.json.
 *
 * Run modes:
 *   bun run morbius:persona                  # run all 3
 *   bun run morbius:persona --persona doctor # one persona only
 *   bun run morbius:persona --max 3          # cap cases per persona
 *
 * Writes:
 *   docs/status/persona-<id>-YYYY-MM-DD.json   # per-persona report
 *   docs/status/persona-summary-YYYY-MM-DD.json # cross-persona summary
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isKnownIcd10, specialtyForCondition } from '../packages/agents/src/index.ts';

interface PersonaCase {
  id: string;
  complaint: string;
  expectedDiagnosis: string;
  expectedIcd10: string | null;
  expectedSpecialty: string;
  rationale: string;
}

interface Persona {
  id: 'doctor' | 'patient' | 'student';
  name: string;
  role: string;
  context: string;
  weight_topCondition: number;
  weight_specialty: number;
  weight_gauntlet: number;
  weight_drugSafety: number;
  weight_explanation?: number;
  cases: PersonaCase[];
}

interface PersonaIndex {
  version: string;
  personas: Persona[];
}

const API_BASE = process.env.API_BASE ?? 'http://localhost:8787';
const PER_CASE_TIMEOUT_MS = 90_000;

function parseArgs(argv: string[]): { persona: string | null; max: number | null } {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const persona = get('--persona') ?? null;
  const maxRaw = get('--max');
  const max = maxRaw ? Number(maxRaw) : null;
  return { persona, max };
}

const opts = parseArgs(process.argv.slice(2));

interface SseEvent {
  type?: string;
  result?: {
    agent?: string;
    data?: {
      differentials?: Array<{ condition?: string; icd10?: string | null; probability?: number }>;
      recommendedSpecialty?: string;
      modelUsed?: string;
    };
  };
}

interface CaseOutcome {
  caseId: string;
  expectedDiagnosis: string;
  expectedIcd10: string | null;
  expectedSpecialty: string;
  modelDiagnosis: string | null;
  modelIcd10: string | null;
  modelSpecialty: string | null;
  topConditionMatch: boolean;
  icdPrefixMatch: boolean;
  icdKnown: boolean;
  specialtyMatch: boolean;
  gauntletPassed: boolean;
  responseLength: number;
  latencyMs: number;
  error: string | null;
}

interface PersonaReport {
  ranAt: string;
  durationMs: number;
  apiBase: string;
  personaId: Persona['id'];
  personaName: string;
  personaRole: string;
  caseCount: number;
  /** Weighted accuracy — the headline number for THIS persona. */
  weightedScore: number;
  metrics: {
    topConditionRate: number;
    icdPrefixRate: number;
    icdKnownRate: number;
    specialtyRate: number;
    gauntletPassRate: number;
    meanResponseLength: number;
    p50LatencyMs: number;
    p95LatencyMs: number;
    errorCount: number;
  };
  cases: CaseOutcome[];
  weights: {
    topCondition: number;
    specialty: number;
    gauntlet: number;
    drugSafety: number;
    explanation: number;
  };
}

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length >= 4),
  );
}

function topConditionMatches(
  expected: string,
  got: string | null,
  expectedIcd: string | null,
  gotIcd: string | null,
): boolean {
  if (!got) return false;
  const eL = expected.toLowerCase();
  const gL = got.toLowerCase();
  if (gL.includes(eL) || eL.includes(gL)) return true;
  if (
    expectedIcd &&
    gotIcd &&
    expectedIcd.slice(0, 3).toUpperCase() === gotIcd.slice(0, 3).toUpperCase()
  )
    return true;
  // Token overlap
  const eT = tokenize(expected);
  const gT = tokenize(got);
  let shared = 0;
  for (const w of eT) if (gT.has(w)) shared++;
  return shared >= 1;
}

async function runOneCase(c: PersonaCase): Promise<CaseOutcome> {
  const startedAt = performance.now();
  let modelDiagnosis: string | null = null;
  let modelIcd10: string | null = null;
  let modelSpecialty: string | null = null;
  let gauntletPassed = true;
  let totalResponseLength = 0;
  let error: string | null = null;

  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), PER_CASE_TIMEOUT_MS);
    const res = await fetch(`${API_BASE}/orchestrate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Dr-Abc-Source': 'persona-harness' },
      body: JSON.stringify({ text: c.complaint }),
      signal: ac.signal,
    });
    if (!res.body) throw new Error(`HTTP ${res.status} no body`);
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
          if (ev.type === 'pipeline.aborted') gauntletPassed = false;
          if (ev.type === 'agent.completed' && ev.result?.agent === 'diagnostic') {
            const top = ev.result.data?.differentials?.[0];
            if (top?.condition) modelDiagnosis = top.condition;
            if (top?.icd10) modelIcd10 = top.icd10;
            if (ev.result.data?.recommendedSpecialty)
              modelSpecialty = ev.result.data.recommendedSpecialty;
            totalResponseLength = (top?.condition ?? '').length;
          }
        } catch {
          /* skip malformed */
        }
      }
    }
    clearTimeout(timer);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  const latencyMs = Math.round(performance.now() - startedAt);
  const topConditionMatch = topConditionMatches(
    c.expectedDiagnosis,
    modelDiagnosis,
    c.expectedIcd10,
    modelIcd10,
  );
  const expectedIcdPrefix = (c.expectedIcd10 ?? '').slice(0, 3).toUpperCase();
  const modelIcdPrefix = (modelIcd10 ?? '').slice(0, 3).toUpperCase();
  const icdPrefixMatch = expectedIcdPrefix.length > 0 && expectedIcdPrefix === modelIcdPrefix;
  const icdKnown = modelIcd10 ? isKnownIcd10(modelIcd10) : false;
  const expectedSpec = specialtyForCondition(c.expectedDiagnosis);
  const modelSpec = modelSpecialty ? specialtyForCondition(modelSpecialty) : null;
  const specialtyMatch = expectedSpec === modelSpec;

  return {
    caseId: c.id,
    expectedDiagnosis: c.expectedDiagnosis,
    expectedIcd10: c.expectedIcd10,
    expectedSpecialty: expectedSpec,
    modelDiagnosis,
    modelIcd10,
    modelSpecialty,
    topConditionMatch,
    icdPrefixMatch,
    icdKnown,
    specialtyMatch,
    gauntletPassed,
    responseLength: totalResponseLength,
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

async function runPersona(p: Persona): Promise<PersonaReport> {
  console.log(`\n👤 ${p.name}`);
  console.log(
    `   role: ${p.role} · ${p.cases.length} cases · weights → topCond ${p.weight_topCondition} · spec ${p.weight_specialty} · gauntlet ${p.weight_gauntlet} · drugSafety ${p.weight_drugSafety}${p.weight_explanation ? ` · explain ${p.weight_explanation}` : ''}`,
  );
  console.log('─'.repeat(72));

  const startedAt = Date.now();
  const cases = opts.max ? p.cases.slice(0, opts.max) : p.cases;
  const outcomes: CaseOutcome[] = [];
  let i = 0;
  for (const c of cases) {
    i += 1;
    process.stdout.write(`  ${i}/${cases.length} ${c.id}  …  `);
    const out = await runOneCase(c);
    outcomes.push(out);
    const verdict = out.topConditionMatch ? '✓' : out.error ? `✗ (${out.error.slice(0, 24)})` : '✗';
    console.log(
      `${verdict.padEnd(8)} got=${(out.modelDiagnosis ?? '—').slice(0, 32)}  ${out.latencyMs}ms`,
    );
  }

  const topConditionRate =
    outcomes.filter((o) => o.topConditionMatch).length / Math.max(1, outcomes.length);
  const specialtyRate =
    outcomes.filter((o) => o.specialtyMatch).length / Math.max(1, outcomes.length);
  const gauntletRate =
    outcomes.filter((o) => o.gauntletPassed).length / Math.max(1, outcomes.length);
  const icdPrefixRate =
    outcomes.filter((o) => o.icdPrefixMatch).length / Math.max(1, outcomes.length);
  const icdKnownRate = outcomes.filter((o) => o.icdKnown).length / Math.max(1, outcomes.length);
  const avgResponseLength =
    outcomes.reduce((s, o) => s + o.responseLength, 0) / Math.max(1, outcomes.length);

  // Persona-weighted score. drugSafety + explanation are surrogate
  // signals — drugSafety ≈ gauntlet pass (the safety stage catches
  // bad Rx); explanation ≈ response length normalised.
  const explanation = Math.min(1, avgResponseLength / 80);
  const drugSafety = gauntletRate;
  const expWeight = p.weight_explanation ?? 0;
  const totalW =
    p.weight_topCondition +
    p.weight_specialty +
    p.weight_gauntlet +
    p.weight_drugSafety +
    expWeight;
  const weightedScore =
    (p.weight_topCondition * topConditionRate +
      p.weight_specialty * specialtyRate +
      p.weight_gauntlet * gauntletRate +
      p.weight_drugSafety * drugSafety +
      expWeight * explanation) /
    Math.max(1e-6, totalW);

  const latencies = outcomes.filter((o) => !o.error).map((o) => o.latencyMs);
  const report: PersonaReport = {
    ranAt: new Date(startedAt).toISOString(),
    durationMs: Date.now() - startedAt,
    apiBase: API_BASE,
    personaId: p.id,
    personaName: p.name,
    personaRole: p.role,
    caseCount: outcomes.length,
    weightedScore,
    metrics: {
      topConditionRate,
      icdPrefixRate,
      icdKnownRate,
      specialtyRate,
      gauntletPassRate: gauntletRate,
      meanResponseLength: avgResponseLength,
      p50LatencyMs: percentile(latencies, 50),
      p95LatencyMs: percentile(latencies, 95),
      errorCount: outcomes.filter((o) => o.error).length,
    },
    cases: outcomes,
    weights: {
      topCondition: p.weight_topCondition,
      specialty: p.weight_specialty,
      gauntlet: p.weight_gauntlet,
      drugSafety: p.weight_drugSafety,
      explanation: p.weight_explanation ?? 0,
    },
  };

  const date = new Date().toISOString().slice(0, 10);
  const reportPath = join(process.cwd(), 'docs', 'status', `persona-${p.id}-${date}.json`);
  await writeFile(reportPath, JSON.stringify(report, null, 2));

  console.log('\n┌─────────────────────────┬─────────┐');
  const row = (l: string, v: string) => `│ ${l.padEnd(23)} │ ${v.padStart(7)} │`;
  console.log(row('weighted score', `${(weightedScore * 100).toFixed(1)}%`));
  console.log(row('top-condition', `${(topConditionRate * 100).toFixed(1)}%`));
  console.log(row('specialty routing', `${(specialtyRate * 100).toFixed(1)}%`));
  console.log(row('gauntlet pass', `${(gauntletRate * 100).toFixed(1)}%`));
  console.log(row('p50 latency', `${report.metrics.p50LatencyMs}ms`));
  console.log(row('errors', String(report.metrics.errorCount)));
  console.log('└─────────────────────────┴─────────┘');
  console.log(`▸ wrote ${reportPath}`);

  return report;
}

async function main() {
  // Data was consolidated to sample-data/ — try that first, fall back
  // to the legacy scripts/data/ location for any older clone.
  const candidates = [
    join(process.cwd(), 'sample-data', 'personas.json'),
    join(process.cwd(), 'scripts', 'data', 'personas.json'),
  ];
  let text: string | null = null;
  for (const p of candidates) {
    try {
      text = await readFile(p, 'utf8');
      break;
    } catch {
      /* try next candidate */
    }
  }
  if (text === null) {
    throw new Error(
      `personas.json not found. Tried: ${candidates.join(' · ')}. Run bun run scripts/data-bootstrap.ts to seed.`,
    );
  }
  const idx: PersonaIndex = JSON.parse(text);
  const personas = opts.persona ? idx.personas.filter((p) => p.id === opts.persona) : idx.personas;
  if (personas.length === 0) {
    console.log(`No personas matched. Available: ${idx.personas.map((p) => p.id).join(', ')}`);
    return;
  }

  const reports: PersonaReport[] = [];
  for (const p of personas) {
    reports.push(await runPersona(p));
  }

  if (reports.length > 1) {
    const date = new Date().toISOString().slice(0, 10);
    const summaryPath = join(process.cwd(), 'docs', 'status', `persona-summary-${date}.json`);
    const summary = {
      ranAt: new Date().toISOString(),
      personaCount: reports.length,
      perPersona: reports.map((r) => ({
        id: r.personaId,
        name: r.personaName,
        role: r.personaRole,
        caseCount: r.caseCount,
        weightedScore: r.weightedScore,
        topConditionRate: r.metrics.topConditionRate,
        gauntletPassRate: r.metrics.gauntletPassRate,
        p50LatencyMs: r.metrics.p50LatencyMs,
      })),
    };
    await writeFile(summaryPath, JSON.stringify(summary, null, 2));

    console.log('\n═══ Cross-persona summary ═══');
    for (const r of reports) {
      console.log(
        `  ${r.personaId.padEnd(8)} ${(r.weightedScore * 100).toFixed(1).padStart(5)}%  ${r.caseCount} cases  ${r.personaName}`,
      );
    }
    console.log(`▸ wrote ${summaryPath}`);
  }
}

main().catch((err) => {
  console.error('persona-harness failed:', err);
  process.exit(1);
});
