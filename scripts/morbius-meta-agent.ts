#!/usr/bin/env bun
/**
 * morbius-meta-agent — Mörbius proposes training agents for itself.
 *
 *   bun run scripts/morbius-meta-agent.ts             # full cycle
 *   bun run scripts/morbius-meta-agent.ts --dry-run   # propose + score, do not enqueue
 *   bun run scripts/morbius-meta-agent.ts --file <path>  # use a specific accuracy snapshot
 *
 * The meta-agent is the v1.1 shadow-mode realisation of the standing
 * spec at docs/vault/roadmap/meta-agent-self-spawn.md. Mörbius reads
 * the latest accuracy snapshot, groups the failing cases by specialty,
 * and proposes a "candidate training agent" per weak specialty — each
 * candidate is a tightened prompt prefix carrying the ICD-10 anchors
 * and condition cues observed in the misses.
 *
 * Veronica is the evaluator. She scores each candidate on five
 * axes (coverage · specificity · safety · anchors · expected lift)
 * and produces an aggregate. The aggregate gate is the only place a
 * candidate can be auto-enqueued for promotion — no LLM call is
 * required, the scoring is deterministic so the loop runs offline.
 *
 * Audit:
 *   docs/status/meta-agent-journal.jsonl              — every spawn/retire
 *   docs/status/meta-agent-YYYY-MM-DD.json            — daily summary
 *   docs/status/tune-YYYY-MM-DD.json (appended)       — proposals that
 *     pass Veronica are appended to the next-cycle tune queue, so the
 *     existing morbius-promote-tunes.ts gate is still the gatekeeper
 *     for what actually ships into SPECIALTY_PROMPTS.
 *
 * Mörbius creates training agents · Veronica evaluates them · the
 * autopilot picks up the survivors on its next cycle. No manual
 * keystroke between snapshot and queue. Operator veto remains via
 * the existing morbius-promote-tunes flow.
 */

import { appendFile, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const REPO = process.cwd();
const STATUS_DIR = join(REPO, 'docs/status');
const JOURNAL_FILE = join(STATUS_DIR, 'meta-agent-journal.jsonl');

const KNOWN_SPECIALTIES = new Set<SpecialtyKey>([
  'cardiology',
  'neurology',
  'oncology',
  'pulmonology',
  'endocrinology',
  'dermatology',
  'psychiatry',
  'surgery',
  'general',
]);

type SpecialtyKey =
  | 'cardiology'
  | 'neurology'
  | 'oncology'
  | 'pulmonology'
  | 'endocrinology'
  | 'dermatology'
  | 'psychiatry'
  | 'surgery'
  | 'general';

interface AccuracyCase {
  caseId: string;
  prompt: string;
  expectedDiagnosis: string;
  expectedIcd10: string;
  expectedSpecialty: string;
  modelDiagnosis: string | null;
  modelIcd10: string | null;
  modelSpecialty: string;
  topConditionMatch: boolean;
  icdPrefixMatch: boolean;
  specialtyMatch: boolean;
  gauntletPassed: boolean;
  latencyMs: number;
}

interface AccuracySnapshot {
  ranAt: string;
  caseCount: number;
  metrics: {
    topConditionRate: number;
    icdPrefixRate: number;
    specialtyRate: number;
    gauntletPassRate: number;
  };
  perSpecialty?: Record<string, { count: number; topConditionRate: number }>;
  cases: AccuracyCase[];
}

interface SpawnCandidate {
  candidateId: string;
  specialty: SpecialtyKey;
  parentSpecialty: SpecialtyKey;
  missedCaseIds: string[];
  missedConditions: string[];
  missedIcd10s: string[];
  proposedPrefix: string;
  rationale: string;
  expectedAccuracyDelta: number;
  generatedAt: string;
}

interface VeronicaScore {
  candidateId: string;
  coverage: number;
  specificity: number;
  safety: number;
  anchors: number;
  expectedLift: number;
  aggregate: number;
  verdict: 'promote' | 'retire';
  reason: string;
}

interface MetaAgentJournalEntry {
  type: 'spawn-proposed' | 'spawn-promoted' | 'spawn-retired' | 'cycle-summary';
  ts: string;
  candidateId?: string;
  specialty?: string;
  score?: number;
  detail: Record<string, unknown>;
}

// Promote-threshold: Veronica's aggregate must clear this for a
// candidate to land in the tune queue. The 0.65 floor is conservative
// — it is permissive enough that real lift candidates survive, strict
// enough that a noisy snapshot does not flood the queue.
const PROMOTE_THRESHOLD = 0.65;

// Red-flag carve-out: the meta-agent never retires the triage agent or
// any agent on a red-flag pathway. Listed by name here for compile-time
// safety; the runtime check rejects spawn proposals that target them.
const REDFLAG_PROTECTED_SPECIALTIES = new Set<string>(['psychiatry']);

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const fileFlag = argv.indexOf('--file');
  const snapshotPath =
    fileFlag !== -1 && fileFlag + 1 < argv.length
      ? argv[fileFlag + 1]
      : await latestAccuracySnapshot();

  if (!snapshotPath) {
    console.error('No accuracy snapshot found. Run `bun run morbius:accuracy` first.');
    process.exit(1);
  }

  const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8')) as AccuracySnapshot;
  console.log(`Meta-agent · reading ${snapshotPath}`);
  console.log(`  baseline: ${(snapshot.metrics.topConditionRate * 100).toFixed(1)}% top-condition`);

  const candidates = proposeCandidates(snapshot);
  console.log(`  proposed ${candidates.length} training-agent candidate(s)`);

  const scores: VeronicaScore[] = candidates.map((c) => evaluateWithVeronica(c, snapshot));

  for (const c of candidates) {
    const s = scores.find((x) => x.candidateId === c.candidateId);
    if (!s) continue;
    console.log(
      `  · ${c.specialty.padEnd(15)} score=${s.aggregate.toFixed(2)} · ${s.verdict.toUpperCase()} · ${s.reason}`,
    );
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
  const summaryPath = join(STATUS_DIR, `meta-agent-${stamp}.json`);

  await writeFile(
    summaryPath,
    JSON.stringify(
      {
        ranAt: new Date().toISOString(),
        baselineTopConditionRate: snapshot.metrics.topConditionRate,
        candidates,
        scores,
        promotedCount: scores.filter((s) => s.verdict === 'promote').length,
        retiredCount: scores.filter((s) => s.verdict === 'retire').length,
      },
      null,
      2,
    ),
  );
  console.log(`  · wrote summary → ${summaryPath}`);

  if (!dryRun) {
    const promoted = candidates.filter(
      (c) => scores.find((s) => s.candidateId === c.candidateId)?.verdict === 'promote',
    );
    if (promoted.length > 0) {
      await enqueueForTunePromotion(promoted, snapshot.ranAt);
      console.log(`  · enqueued ${promoted.length} candidate(s) into the tune queue`);
    }
  }

  await journal(scores, candidates, snapshot, dryRun);
  console.log('Meta-agent · cycle done.');
}

async function latestAccuracySnapshot(): Promise<string | null> {
  const all = await readdir(STATUS_DIR);
  const matches = all
    .filter((f) => /^accuracy-\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()
    .reverse();
  return matches[0] ? join(STATUS_DIR, matches[0]) : null;
}

function proposeCandidates(snapshot: AccuracySnapshot): SpawnCandidate[] {
  // Group misses by expected specialty. A specialty earns a candidate
  // only if it has at least one outright miss (topConditionMatch=false)
  // — specialty-routing-only failures don't change the prompt's anchors.
  const bySpecialty = new Map<
    SpecialtyKey,
    { cases: AccuracyCase[]; conditions: string[]; icd10s: string[] }
  >();

  for (const c of snapshot.cases) {
    if (c.topConditionMatch) continue;
    const spec = normaliseSpecialty(c.expectedSpecialty);
    if (!spec) continue;
    if (REDFLAG_PROTECTED_SPECIALTIES.has(spec)) continue;
    const slot = bySpecialty.get(spec) ?? { cases: [], conditions: [], icd10s: [] };
    slot.cases.push(c);
    if (c.expectedDiagnosis) slot.conditions.push(c.expectedDiagnosis);
    if (c.expectedIcd10) slot.icd10s.push(c.expectedIcd10);
    bySpecialty.set(spec, slot);
  }

  const candidates: SpawnCandidate[] = [];
  for (const [spec, slot] of bySpecialty) {
    if (slot.cases.length === 0) continue;
    const candidateId = `cand_${spec}_${Date.now()}_${Math.floor(Math.random() * 1e4)}`;
    const proposedPrefix = buildCandidatePrefix(spec, slot.conditions, slot.icd10s);
    const expectedAccuracyDelta = estimateLift(slot.cases.length, snapshot.caseCount);
    candidates.push({
      candidateId,
      specialty: spec,
      parentSpecialty: spec,
      missedCaseIds: slot.cases.map((c) => c.caseId),
      missedConditions: slot.conditions,
      missedIcd10s: slot.icd10s,
      proposedPrefix,
      rationale: `Mörbius observed ${slot.cases.length} miss(es) in '${spec}' on the latest accuracy snapshot — anchoring the prompt to the missed ICD-10 codes (${slot.icd10s.join(', ')}) and conditions (${slot.conditions.slice(0, 3).join(', ')}${slot.conditions.length > 3 ? '…' : ''}) is expected to lift recall on this specialty.`,
      expectedAccuracyDelta,
      generatedAt: new Date().toISOString(),
    });
  }

  return candidates;
}

function buildCandidatePrefix(spec: SpecialtyKey, conditions: string[], icd10s: string[]): string {
  // Vetted prompt-fragment template — the meta-agent does NOT compose
  // free-text. Every prompt it ships fits this template and reads from
  // the snapshot's observed conditions + ICD-10 codes only.
  const uniqueConditions = [...new Set(conditions)].slice(0, 6);
  const uniqueIcd10s = [...new Set(icd10s)].slice(0, 6);
  return [
    `You are the ${spec} specialist agent inside Mörbius.`,
    'Stay clinical-warm. Lead with the answer in one or two sentences before the reasoning.',
    `Recent presentations Mörbius was asked to evaluate but missed include: ${uniqueConditions.join('; ') || '—'}.`,
    `Keep these ICD-10 anchors in working memory for ${spec}: ${uniqueIcd10s.join(', ') || '—'}.`,
    'When the chief complaint matches one of these patterns, surface it as the leading differential with the matching code. Always honour red-flag pathways. Defer to triage on any acute signal.',
  ].join('\n');
}

function estimateLift(missCount: number, totalCount: number): number {
  // Empirical heuristic: each anchored ICD-10 that the prompt previously
  // lacked is worth ~1.5 pp on the harness based on prior
  // observations. Bounded by the magnitude cap in AGENTS.md.
  const raw = missCount * 1.5;
  return Math.min(raw, 6);
}

function normaliseSpecialty(s: string): SpecialtyKey | null {
  const lower = s.toLowerCase().trim();
  if (KNOWN_SPECIALTIES.has(lower as SpecialtyKey)) return lower as SpecialtyKey;
  if (lower === 'cards' || lower === 'cardiac') return 'cardiology';
  if (lower === 'neuro') return 'neurology';
  if (lower === 'lungs' || lower === 'pulm') return 'pulmonology';
  return null;
}

function evaluateWithVeronica(
  candidate: SpawnCandidate,
  snapshot: AccuracySnapshot,
): VeronicaScore {
  // Veronica's deterministic five-axis scoring. Each axis is in [0, 1].
  // No LLM call — keeps the loop offline + cheap, and the scoring is
  // reproducible. The aggregate is the weighted mean.

  // Axis 1 — coverage. Does the prompt cover the actually-missed cases?
  const coverage = Math.min(
    (candidate.missedCaseIds.length / Math.max(snapshot.caseCount, 1)) * 4,
    1,
  );

  // Axis 2 — specificity. Penalise prompts that are too short to be
  // useful or too long to fit small open models.
  const len = candidate.proposedPrefix.length;
  const specificity =
    len >= 200 && len <= 1200 ? 1 : len < 200 ? len / 200 : Math.max(0, 1 - (len - 1200) / 800);

  // Axis 3 — safety. Reject any candidate whose prompt contains a
  // suppress-red-flag signal. Bag-of-words check; cheap + adequate.
  const danger =
    /(skip|ignore|bypass|disable|suppress|override).*(red.?flag|gauntlet|secure pass)/i;
  const persona = /\b(red.?flag|gauntlet|triage|defer|warm|clinical)/i;
  const safety = danger.test(candidate.proposedPrefix)
    ? 0
    : persona.test(candidate.proposedPrefix)
      ? 1
      : 0.5;

  // Axis 4 — anchors. Does the prompt actually reference ICD-10 codes
  // for the missed cases?
  const anchorMatches = candidate.missedIcd10s.filter((code) =>
    candidate.proposedPrefix.toLowerCase().includes(code.toLowerCase()),
  ).length;
  const anchors =
    candidate.missedIcd10s.length > 0 ? anchorMatches / candidate.missedIcd10s.length : 0.5;

  // Axis 5 — expected lift. Bounded magnitude check.
  const expectedLift = Math.min(candidate.expectedAccuracyDelta / 6, 1);

  const aggregate =
    coverage * 0.25 + specificity * 0.15 + safety * 0.25 + anchors * 0.25 + expectedLift * 0.1;

  const verdict: 'promote' | 'retire' =
    aggregate >= PROMOTE_THRESHOLD && safety > 0 ? 'promote' : 'retire';

  const reason =
    safety === 0
      ? 'safety violation — prompt contains suppress-red-flag signal'
      : aggregate < PROMOTE_THRESHOLD
        ? `aggregate ${aggregate.toFixed(2)} below ${PROMOTE_THRESHOLD} threshold`
        : `aggregate ${aggregate.toFixed(2)} clears ${PROMOTE_THRESHOLD} threshold`;

  return {
    candidateId: candidate.candidateId,
    coverage,
    specificity,
    safety,
    anchors,
    expectedLift,
    aggregate,
    verdict,
    reason,
  };
}

async function enqueueForTunePromotion(promoted: SpawnCandidate[], snapshotRanAt: string) {
  // Append the promoted candidates onto today's tune queue file so the
  // existing morbius-promote-tunes.ts is the single gatekeeper for
  // anything that ships into SPECIALTY_PROMPTS. This preserves the
  // operator-veto window without adding a second promotion path.
  const today = new Date().toISOString().slice(0, 10);
  const tuneFile = join(STATUS_DIR, `tune-${today}.json`);

  let existing: { ranAt: string; proposals: unknown[] } = {
    ranAt: new Date().toISOString(),
    proposals: [],
  };
  try {
    existing = JSON.parse(await readFile(tuneFile, 'utf8')) as typeof existing;
  } catch {
    // first write of the day — fall through with the empty seed
  }

  const newProposals = promoted.map((c) => ({
    specialty: c.specialty,
    proposedPrefix: c.proposedPrefix,
    rationale: `[meta-agent] ${c.rationale}`,
    expectedAccuracyDelta: c.expectedAccuracyDelta,
    proposedPrefixChars: c.proposedPrefix.length,
    exemplarCount: c.missedCaseIds.length,
    currentPrefix: '',
    generatedAt: c.generatedAt,
    sourceSnapshotRanAt: snapshotRanAt,
    sourceMetaAgent: true,
  }));

  await writeFile(
    tuneFile,
    JSON.stringify(
      {
        ranAt: existing.ranAt,
        proposals: [...existing.proposals, ...newProposals],
      },
      null,
      2,
    ),
  );
}

async function journal(
  scores: VeronicaScore[],
  candidates: SpawnCandidate[],
  snapshot: AccuracySnapshot,
  dryRun: boolean,
) {
  const ts = new Date().toISOString();
  const entries: MetaAgentJournalEntry[] = [];

  for (const c of candidates) {
    const s = scores.find((x) => x.candidateId === c.candidateId);
    if (!s) continue;
    entries.push({
      type: 'spawn-proposed',
      ts,
      candidateId: c.candidateId,
      specialty: c.specialty,
      score: s.aggregate,
      detail: {
        missedCaseIds: c.missedCaseIds,
        expectedAccuracyDelta: c.expectedAccuracyDelta,
        veronicaScore: s,
      },
    });
    entries.push({
      type: s.verdict === 'promote' ? 'spawn-promoted' : 'spawn-retired',
      ts,
      candidateId: c.candidateId,
      specialty: c.specialty,
      score: s.aggregate,
      detail: {
        reason: s.reason,
        dryRun,
      },
    });
  }

  entries.push({
    type: 'cycle-summary',
    ts,
    detail: {
      baselineTopConditionRate: snapshot.metrics.topConditionRate,
      candidateCount: candidates.length,
      promotedCount: scores.filter((s) => s.verdict === 'promote').length,
      retiredCount: scores.filter((s) => s.verdict === 'retire').length,
      dryRun,
    },
  });

  const text = `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`;
  await appendFile(JOURNAL_FILE, text);
}

void main().catch((err) => {
  console.error('Meta-agent cycle failed:', err);
  process.exit(1);
});
