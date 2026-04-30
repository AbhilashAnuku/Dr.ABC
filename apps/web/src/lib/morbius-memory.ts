/**
 * Mörbius Memory — per-user, IndexedDB-backed long-term store of every
 * meaningful clinical interaction. The fifth pillar of the brain
 * (alongside RAG · Agentic · Medical Knowledge · Self-Learning).
 *
 * Two responsibilities:
 *
 *   1. STORE — every consult that ends in a signed Rx, every imaging
 *      analysis, and every chat turn the doctor explicitly bookmarks
 *      becomes a `MemoryEntry` with a deterministic TF-IDF embedding
 *      computed at write time.
 *
 *   2. RECALL — `recall(query, topK)` returns the entries most similar
 *      to the new chief complaint via cosine over the cached
 *      embeddings. The clinic page injects the top-3 hits into the
 *      Mörbius prompt as "you saw a similar case 3 weeks ago — patient
 *      X / outcome Y", giving the agent real continuity.
 *
 * Every entry is namespaced by `userId` so two demo accounts (or
 * future real accounts) never see each other's history. Storage is
 * IndexedDB only — nothing leaves the browser.
 */

const DB_NAME = 'dr-abc-mörbius-memory';
const STORE = 'entries';
const DB_VERSION = 1;

export interface MemoryEntry {
  id: string;
  userId: string;
  ts: number;
  /** What the doctor / patient said when the case opened. */
  chiefComplaint: string;
  /** Optional final diagnosis once the agent settled. */
  diagnosis?: string;
  /** Optional ICD-10 code. */
  icd10?: string;
  /** Specialty the case was routed to. */
  specialty?: string;
  /** Drugs prescribed (just the names; full Rx lives in consult-history). */
  drugs?: string[];
  /** Free-text outcome / follow-up note. */
  outcome?: string;
  /** Origin of the entry — `consult` | `imaging` | `bookmark`. */
  source: 'consult' | 'imaging' | 'bookmark';
  /** Consult id this memory came from. When present the dashboard
   *  recents widget deep-links to /app/clinic?id=<consultId> so the
   *  user resumes the actual conversation, not a fresh chat. */
  consultId?: string;
  /** TF-IDF embedding cached at write so recall doesn't re-tokenise. */
  embedding: Record<string, number>;
}

export interface RecallHit {
  entry: MemoryEntry;
  /** Cosine similarity in [0, 1]. */
  score: number;
}

// ============================================================
//  IndexedDB plumbing
// ============================================================

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB not available'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('byUser', 'userId', { unique: false });
        store.createIndex('byTs', 'ts', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => Promise<T> | T,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    let result: T;
    Promise.resolve(fn(store))
      .then((r) => {
        result = r;
      })
      .catch(reject);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB tx failed'));
  });
}

// ============================================================
//  TF-IDF — deterministic, no external library, plenty good for
//  ranking 200-word consult notes against each other.
// ============================================================

const STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'is',
  'are',
  'was',
  'were',
  'do',
  'does',
  'did',
  'have',
  'has',
  'had',
  'i',
  'you',
  'we',
  'they',
  'he',
  'she',
  'it',
  'this',
  'that',
  'these',
  'those',
  'my',
  'your',
  'and',
  'or',
  'of',
  'to',
  'for',
  'in',
  'on',
  'with',
  'at',
  'by',
  'from',
  'as',
  'about',
  'into',
  'so',
  'if',
  'but',
  'not',
  'no',
  'yes',
  'be',
  'am',
  'been',
  'being',
  'will',
  'would',
  'should',
  'could',
  'patient',
  'symptoms',
  'symptom',
  'complaint',
  'told',
  'said',
  'says',
  'reports',
  'denies',
]);

export function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

/**
 * Term-frequency embedding (no IDF here — the corpus is tiny enough
 * that pure TF + L2 normalisation gives stable cosine without the
 * full IDF weighting).
 */
export function embed(text: string): Record<string, number> {
  const tokens = tokenise(text);
  if (tokens.length === 0) return {};
  const counts: Record<string, number> = {};
  for (const t of tokens) counts[t] = (counts[t] ?? 0) + 1;
  // L2 normalise so cosine = dot product.
  let norm = 0;
  for (const v of Object.values(counts)) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm === 0) return counts;
  for (const k of Object.keys(counts)) {
    const c = counts[k];
    if (c !== undefined) counts[k] = c / norm;
  }
  return counts;
}

export function cosine(a: Record<string, number>, b: Record<string, number>): number {
  let dot = 0;
  // Iterate the smaller vector for speed.
  const [small, big] = Object.keys(a).length < Object.keys(b).length ? [a, b] : [b, a];
  for (const [k, v] of Object.entries(small)) {
    const w = big[k];
    if (w !== undefined) dot += v * w;
  }
  // Both vectors are L2-normalised so dot is already cosine.
  return dot;
}

// ============================================================
//  Public API
// ============================================================

export interface StoreInput {
  userId: string;
  chiefComplaint: string;
  diagnosis?: string;
  icd10?: string;
  specialty?: string;
  drugs?: string[];
  outcome?: string;
  source?: MemoryEntry['source'];
  /** Consult id — surfaced by the dashboard recents widget so clicking
   *  a memory card resumes the actual conversation. */
  consultId?: string;
}

export async function storeMemory(input: StoreInput): Promise<MemoryEntry> {
  const text = [input.chiefComplaint, input.diagnosis ?? '', input.outcome ?? '']
    .filter(Boolean)
    .join(' ');
  const entry: MemoryEntry = {
    id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    userId: input.userId,
    ts: Date.now(),
    chiefComplaint: input.chiefComplaint,
    diagnosis: input.diagnosis,
    icd10: input.icd10,
    specialty: input.specialty,
    drugs: input.drugs,
    outcome: input.outcome,
    source: input.source ?? 'consult',
    consultId: input.consultId,
    embedding: embed(text),
  };
  await withStore('readwrite', (store) => {
    store.put(entry);
  });
  return entry;
}

export async function listMemory(userId: string, limit = 200): Promise<MemoryEntry[]> {
  return withStore<MemoryEntry[]>('readonly', (store) => {
    return new Promise<MemoryEntry[]>((resolve, reject) => {
      const out: MemoryEntry[] = [];
      const idx = store.index('byUser');
      const req = idx.openCursor(IDBKeyRange.only(userId), 'prev');
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur || out.length >= limit) {
          // Cursor done: sort by ts desc as a safety net + return.
          out.sort((a, b) => b.ts - a.ts);
          resolve(out);
          return;
        }
        out.push(cur.value as MemoryEntry);
        cur.continue();
      };
      req.onerror = () => reject(req.error ?? new Error('cursor failed'));
    });
  });
}

export async function recall(userId: string, query: string, topK = 3): Promise<RecallHit[]> {
  const qEmb = embed(query);
  if (Object.keys(qEmb).length === 0) return [];
  const all = await listMemory(userId, 500);
  return all
    .map((entry) => ({ entry, score: cosine(qEmb, entry.embedding) }))
    .filter((h) => h.score > 0.05)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

export async function clearMemory(userId: string): Promise<void> {
  await withStore('readwrite', (store) => {
    return new Promise<void>((resolve, reject) => {
      const idx = store.index('byUser');
      const req = idx.openCursor(IDBKeyRange.only(userId));
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) {
          resolve();
          return;
        }
        cur.delete();
        cur.continue();
      };
      req.onerror = () => reject(req.error ?? new Error('clear cursor failed'));
    });
  });
}

/**
 * Render a recall result set as a compact prompt-ready paragraph for
 * the agent to consume. Empty input → empty string (no "you saw 0
 * cases" filler).
 */
export function recallToPromptContext(hits: RecallHit[]): string {
  if (hits.length === 0) return '';
  const lines = hits.map((h) => {
    const when = relativeTime(h.entry.ts);
    const dx = h.entry.diagnosis ? ` → ${h.entry.diagnosis}` : '';
    const drugs =
      h.entry.drugs && h.entry.drugs.length > 0 ? ` (Rx: ${h.entry.drugs.join(', ')})` : '';
    return `· ${when} · "${h.entry.chiefComplaint}"${dx}${drugs}`;
  });
  return `Memory recall — similar prior cases:\n${lines.join('\n')}`;
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const day = 86_400_000;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < day) return `${Math.floor(diff / 3_600_000)} h ago`;
  if (diff < 30 * day) return `${Math.floor(diff / day)} d ago`;
  if (diff < 365 * day) return `${Math.floor(diff / (30 * day))} mo ago`;
  return `${Math.floor(diff / (365 * day))} y ago`;
}
