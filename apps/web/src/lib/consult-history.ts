/**
 * Consult-history store — per-user, persisted to localStorage so the
 * Dashboard can surface the last few consultations Mörbius has run.
 *
 * Storage key: `dr-abc:consult-history:<userId>` → ConsultHistoryEntry[].
 * Capped at MAX_ENTRIES; oldest dropped first.
 *
 * Same per-user-prefix pattern as medical-record.ts, with the same
 * isolation guarantee (different user → different storage slot →
 * never visible cross-user).
 */

const STORAGE_PREFIX = 'dr-abc:consult-history:';
const MAX_ENTRIES = 25;

export interface ConsultHistoryEntry {
  id: string;
  startedAt: number;
  /** Patient's chief complaint (first user turn). */
  complaint: string;
  /** Top differential when the diagnostic agent returned one. */
  topCondition?: string;
  /** Confidence 0..1 for the top differential. */
  topProb?: number;
  /** Recommended specialty for follow-up. */
  specialty?: string;
  /** Backend used (Anthropic / NVIDIA / HF / Ollama / offline). */
  modelUsed?: string;
  /** True if a prescription was generated + downloaded. */
  prescriptionIssued: boolean;
  /** Wall-clock seconds the consult took. */
  elapsedSec?: number;
}

export function loadConsultHistory(userId: string): ConsultHistoryEntry[] {
  if (typeof window === 'undefined' || !userId) return [];
  const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${userId}`);
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as ConsultHistoryEntry[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveConsultHistory(userId: string, list: ConsultHistoryEntry[]): void {
  if (typeof window === 'undefined' || !userId) return;
  // Newest first, capped at MAX_ENTRIES.
  const sorted = [...list].sort((a, b) => b.startedAt - a.startedAt).slice(0, MAX_ENTRIES);
  window.localStorage.setItem(`${STORAGE_PREFIX}${userId}`, JSON.stringify(sorted));
}

/**
 * Upsert a consult by id. If an entry with the same id exists, it's
 * replaced (so a follow-up turn or prescription updates the same
 * record instead of creating duplicates). Otherwise, prepended as
 * the newest entry.
 */
export function appendConsult(userId: string, entry: ConsultHistoryEntry): void {
  const existing = loadConsultHistory(userId);
  const idx = existing.findIndex((e) => e.id === entry.id);
  if (idx >= 0) {
    const next = [...existing];
    next[idx] = entry;
    saveConsultHistory(userId, next);
  } else {
    saveConsultHistory(userId, [entry, ...existing]);
  }
}

export function clearConsultHistory(userId: string): void {
  if (typeof window === 'undefined' || !userId) return;
  window.localStorage.removeItem(`${STORAGE_PREFIX}${userId}`);
}

export function newConsultId(): string {
  return `cn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
