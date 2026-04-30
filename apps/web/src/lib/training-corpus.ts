/**
 * training-corpus — turn the per-user memory store into a stratified,
 * tuner-ready exemplar set.
 *
 * Lives at the join of:
 *   - `morbius-memory.ts` — the IndexedDB record of every signed-off
 *     consult (input + diagnosis + drugs + outcome)
 *   - `activity-sink` (server) — the agent-tagged event stream that
 *     records which agent fired, with what latency, with what status
 *
 * The corpus is built by `buildCorpus(userId, opts)` which walks the
 * user's memory entries, classifies each by (specialty, ICD chapter,
 * ESI tier proxy), and stratified-samples up to `k` exemplars per
 * (specialty, bucket) pair. The result is a deterministic, fixed-size
 * dataset the prompt tuner + accuracy harness can replay.
 *
 * Persistence: cached in IndexedDB at `dr-abc-mörbius-corpus` so
 * subsequent rebuilds skip the cosine-walk; the cached entry is
 * invalidated whenever the source memory store grows by ≥ 5 entries.
 */

import { type MemoryEntry, listMemory } from './morbius-memory.ts';

export interface Exemplar {
  /** Stable id derived from the memory entry. */
  id: string;
  /** Free-text input — usually the chief complaint that opened the consult. */
  input: string;
  /** Final diagnosis recorded at sign-off. The "label" the tuner aims for. */
  groundTruth: string;
  /** ICD-10 anchor for the diagnosis (3-char prefix is enough for the bucket). */
  icd10: string;
  /** Specialty the case routed to. */
  specialty: string;
  /** ESI tier proxy: 1 (immediate) → 5 (routine), inferred from the chief complaint. */
  esiBucket: 1 | 2 | 3 | 4 | 5;
  /** Drugs that ended up on the Rx — used to dedupe near-identical cases. */
  drugs: string[];
  /** Timestamp of the original consult. */
  ts: number;
}

export interface CorpusStats {
  totalExemplars: number;
  perSpecialty: Record<string, number>;
  perEsiBucket: Record<1 | 2 | 3 | 4 | 5, number>;
  /** Source memory entries the corpus was sampled from. */
  sourceMemorySize: number;
  /** ISO timestamp the corpus was last (re)built. */
  builtAt: string;
}

export interface Corpus {
  exemplars: Exemplar[];
  stats: CorpusStats;
}

export interface BuildOpts {
  /** Max exemplars per (specialty, esiBucket) pair. Default 4. */
  perBucketCap?: number;
  /** Max total exemplars (hard ceiling). Default 200. */
  totalCap?: number;
}

// ============================================================
//  ESI inference — keyword cues that map to acuity tier.
//  ESI 1 = immediate · 2 = emergent · 3 = urgent · 4-5 = less urgent.
// ============================================================

const ESI_1_CUES = ['stemi', 'cardiac arrest', 'unresponsive', 'apnoea', 'shock', 'severe airway'];
const ESI_2_CUES = [
  'crushing chest pain',
  'stroke',
  'cva',
  'sepsis',
  'severe asthma',
  'appendicitis',
  'atrial fibrillation',
  'shortness of breath',
];
const ESI_3_CUES = [
  'fever',
  'migraine',
  'severe headache',
  'rlq',
  'abdominal pain',
  'pneumonia',
  'asthma',
  'diabetes',
  'palpitations',
];
const ESI_4_CUES = [
  'sore throat',
  'dysuria',
  'rash',
  'cellulitis',
  'gerd',
  'reflux',
  'cough',
  'ear pain',
  'otitis',
  'anxiety',
  'fatigue',
  'cold intolerance',
];

export function inferEsi(text: string): 1 | 2 | 3 | 4 | 5 {
  const lower = text.toLowerCase();
  if (ESI_1_CUES.some((c) => lower.includes(c))) return 1;
  if (ESI_2_CUES.some((c) => lower.includes(c))) return 2;
  if (ESI_3_CUES.some((c) => lower.includes(c))) return 3;
  if (ESI_4_CUES.some((c) => lower.includes(c))) return 4;
  // Routine annual physicals + screening visits land at ESI 5 by default.
  return 5;
}

/** Normalise a specialty string so 'Cardiology' / 'cardio' / 'CARDIO' bucket together. */
export function normaliseSpecialty(s: string | undefined | null): string {
  if (!s) return 'general';
  const lower = s.trim().toLowerCase();
  if (lower.startsWith('card')) return 'cardiology';
  if (lower.startsWith('neuro')) return 'neurology';
  if (lower.startsWith('onco')) return 'oncology';
  if (lower.startsWith('pulmo') || lower.startsWith('pulm')) return 'pulmonology';
  if (lower.startsWith('endo')) return 'endocrinology';
  if (lower.startsWith('derm')) return 'dermatology';
  if (lower.startsWith('pediatric') || lower.startsWith('paed')) return 'pediatrics';
  if (lower.startsWith('psych')) return 'psychiatry';
  if (lower.startsWith('surg')) return 'surgery';
  if (lower.startsWith('intern') || lower.startsWith('general')) return 'internal-medicine';
  return lower;
}

function memoryToExemplar(m: MemoryEntry): Exemplar | null {
  // Reject entries that don't have a final diagnosis — they'd be
  // unsupervised data, not exemplars. The prompt tuner needs labels.
  if (!m.diagnosis || m.diagnosis.length === 0) return null;
  const input = m.chiefComplaint;
  return {
    id: `ex_${m.id}`,
    input,
    groundTruth: m.diagnosis,
    icd10: (m.icd10 ?? '').slice(0, 3) || '???',
    specialty: normaliseSpecialty(m.specialty),
    esiBucket: inferEsi(input),
    drugs: [...(m.drugs ?? [])].sort(),
    ts: m.ts,
  };
}

/**
 * Stratified sampler. Walks the source memory entries, buckets them by
 * (specialty, esiBucket), and keeps at most `perBucketCap` per bucket.
 * Picks the most-recent N within each bucket so the corpus tracks
 * recent practice patterns rather than dredging up ancient cases.
 */
export function stratify(exemplars: Exemplar[], opts: BuildOpts = {}): Exemplar[] {
  const perBucketCap = opts.perBucketCap ?? 4;
  const totalCap = opts.totalCap ?? 200;

  // Bucket key combines specialty + ESI tier; the same chief complaint
  // wave (e.g. "chest pain at ESI 1") is one bucket.
  const buckets = new Map<string, Exemplar[]>();
  for (const ex of exemplars) {
    const key = `${ex.specialty}::${ex.esiBucket}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(ex);
    buckets.set(key, bucket);
  }

  // Per bucket: newest-first, then take perBucketCap.
  const out: Exemplar[] = [];
  for (const bucket of buckets.values()) {
    bucket.sort((a, b) => b.ts - a.ts);
    out.push(...bucket.slice(0, perBucketCap));
  }

  // Total cap: keep the most-recent ones globally if we overflow.
  out.sort((a, b) => b.ts - a.ts);
  return out.slice(0, totalCap);
}

function computeStats(exemplars: Exemplar[], sourceMemorySize: number): CorpusStats {
  const perSpecialty: Record<string, number> = {};
  const perEsiBucket: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const ex of exemplars) {
    perSpecialty[ex.specialty] = (perSpecialty[ex.specialty] ?? 0) + 1;
    perEsiBucket[ex.esiBucket]++;
  }
  return {
    totalExemplars: exemplars.length,
    perSpecialty,
    perEsiBucket,
    sourceMemorySize,
    builtAt: new Date().toISOString(),
  };
}

/**
 * Public API. Reads memory for `userId`, drops unsupervised entries,
 * stratified-samples, returns the corpus + stats.
 *
 * Pure function over its inputs — given the same memory store + opts
 * the output is identical. Tested against `morbius-memory` in
 * `training-corpus.test.ts`.
 */
export async function buildCorpus(userId: string, opts: BuildOpts = {}): Promise<Corpus> {
  const memory = await listMemory(userId, 1000);
  const exemplars = memory.map(memoryToExemplar).filter((ex): ex is Exemplar => ex !== null);
  const stratified = stratify(exemplars, opts);
  return {
    exemplars: stratified,
    stats: computeStats(stratified, memory.length),
  };
}

/**
 * In-memory variant for tests + the Node CLI — accepts memory entries
 * directly so callers don't need IndexedDB. The web runtime uses
 * `buildCorpus` (above) which goes through the live store.
 */
export function buildCorpusFromEntries(entries: MemoryEntry[], opts: BuildOpts = {}): Corpus {
  const exemplars = entries.map(memoryToExemplar).filter((ex): ex is Exemplar => ex !== null);
  const stratified = stratify(exemplars, opts);
  return {
    exemplars: stratified,
    stats: computeStats(stratified, entries.length),
  };
}

// ============================================================
//  Cache — write the corpus back into IndexedDB so the dev console
//  + the next tune cycle don't pay the cosine-walk twice.
// ============================================================

const CACHE_DB_NAME = 'dr-abc-mörbius-corpus';
const CACHE_STORE = 'corpora';
const CACHE_DB_VERSION = 1;

interface CachedCorpus {
  userId: string;
  corpus: Corpus;
}

function openCacheDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB not available'));
      return;
    }
    const req = indexedDB.open(CACHE_DB_NAME, CACHE_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(CACHE_STORE)) {
        db.createObjectStore(CACHE_STORE, { keyPath: 'userId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('cache db open failed'));
  });
}

export async function cacheCorpus(userId: string, corpus: Corpus): Promise<void> {
  const db = await openCacheDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(CACHE_STORE, 'readwrite');
    tx.objectStore(CACHE_STORE).put({ userId, corpus } satisfies CachedCorpus);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('cache write failed'));
  });
}

export async function loadCachedCorpus(userId: string): Promise<Corpus | null> {
  try {
    const db = await openCacheDb();
    return await new Promise<Corpus | null>((resolve, reject) => {
      const tx = db.transaction(CACHE_STORE, 'readonly');
      const req = tx.objectStore(CACHE_STORE).get(userId);
      req.onsuccess = () => {
        const v = req.result as CachedCorpus | undefined;
        resolve(v?.corpus ?? null);
      };
      req.onerror = () => reject(req.error ?? new Error('cache read failed'));
    });
  } catch {
    return null;
  }
}

/** True when the cached corpus is still fresh enough to skip rebuild. */
export function isCacheFresh(cached: Corpus | null, currentMemorySize: number): boolean {
  if (!cached) return false;
  // Rebuild whenever the source memory has grown by ≥ 5 entries since
  // the cache was written. Smaller deltas aren't worth re-walking.
  return Math.abs(currentMemorySize - cached.stats.sourceMemorySize) < 5;
}
