/**
 * consult-transcript — full-conversation persistence per consult.
 *
 * `consult-history.ts` only stored summary metadata (top diagnosis,
 * specialty, etc.) so clicking a "recent consult" had nothing to
 * replay. This module stores the actual turn-by-turn transcript so a
 * user can land on `/app/clinic?id=cn_…` and resume the conversation.
 *
 * Storage layout (localStorage):
 *   `dr-abc:consult-turns:<userId>:<consultId>` → ConsultTurn[]
 *
 * Same per-user-prefix isolation as consult-history + medical-record.
 * Capped at MAX_TURNS_PER_CONSULT to bound storage growth — older
 * turns are dropped, but the summary in consult-history is preserved.
 */

const STORAGE_PREFIX = 'dr-abc:consult-turns:';
const MAX_TURNS_PER_CONSULT = 200;

export type ConsultTurnRole = 'mörbius' | 'patient';

export interface ConsultTurn {
  id: string;
  role: ConsultTurnRole;
  text: string;
  ts: number;
  /** Optional metadata: tone, mode, model used, evidence count, etc. */
  meta?: Record<string, string | number | boolean>;
}

function key(userId: string, consultId: string): string {
  return `${STORAGE_PREFIX}${userId}:${consultId}`;
}

export function loadTranscript(userId: string, consultId: string): ConsultTurn[] {
  if (typeof window === 'undefined' || !userId || !consultId) return [];
  const raw = window.localStorage.getItem(key(userId, consultId));
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as ConsultTurn[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveTranscript(userId: string, consultId: string, turns: ConsultTurn[]): void {
  if (typeof window === 'undefined' || !userId || !consultId) return;
  // Oldest-first ordering preserved; cap from the front so the most
  // recent turns survive a trim.
  const capped =
    turns.length > MAX_TURNS_PER_CONSULT
      ? turns.slice(turns.length - MAX_TURNS_PER_CONSULT)
      : turns;
  window.localStorage.setItem(key(userId, consultId), JSON.stringify(capped));
}

export function appendTurn(userId: string, consultId: string, turn: ConsultTurn): void {
  const existing = loadTranscript(userId, consultId);
  saveTranscript(userId, consultId, [...existing, turn]);
}

/**
 * Mirror a turn to the api server's transcript sink. Fire-and-forget;
 * a network failure or 4xx is fine — localStorage already has the
 * authoritative copy. When the api is wired to Postgres
 * (DATABASE_URL set) this is what makes resume reachable from a
 * different device or after a localStorage clear.
 */
export function syncTurnToServer(
  userId: string,
  consultId: string,
  turn: ConsultTurn,
): Promise<void> {
  if (typeof window === 'undefined' || !userId) return Promise.resolve();
  const base = (import.meta.env.VITE_API_BASE_URL ?? '/api').toString();
  return fetch(`${base}/consults/${encodeURIComponent(consultId)}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: turn.id,
      userId,
      ts: turn.ts,
      role: turn.role,
      text: turn.text,
      meta: turn.meta,
    }),
    keepalive: true,
  })
    .then(() => undefined)
    .catch(() => undefined);
}

export function clearTranscript(userId: string, consultId: string): void {
  if (typeof window === 'undefined' || !userId || !consultId) return;
  window.localStorage.removeItem(key(userId, consultId));
}

/**
 * Patient + vitals snapshot per consult. Lives at a sibling key:
 *   `dr-abc:consult-snapshot:<userId>:<consultId>` → snapshot JSON
 *
 * Stored alongside the transcript so reopening a consult restores the
 * left-panel state (vitals + allergies + meds + history + complaint)
 * exactly as the operator left it. Without this, resume drops back to
 * EMPTY_CASE → re-prefill from the saved profile, losing any
 * consult-specific edits like updated vitals or chief complaint.
 *
 * Schema is intentionally generic (Record<string, unknown>) so this
 * library doesn't take a hard dependency on PatientCase from clinic.tsx.
 * Caller asserts the shape on read.
 */
const SNAPSHOT_PREFIX = 'dr-abc:consult-snapshot:';

function snapshotKey(userId: string, consultId: string): string {
  return `${SNAPSHOT_PREFIX}${userId}:${consultId}`;
}

export function saveConsultSnapshot(
  userId: string,
  consultId: string,
  snapshot: Record<string, unknown>,
): void {
  if (typeof window === 'undefined' || !userId || !consultId) return;
  try {
    window.localStorage.setItem(snapshotKey(userId, consultId), JSON.stringify(snapshot));
  } catch {
    // Quota or serialisation error — non-fatal; transcript is still
    // the source of truth, snapshot is purely a UX nicety.
  }
}

export function loadConsultSnapshot<T extends Record<string, unknown>>(
  userId: string,
  consultId: string,
): T | null {
  if (typeof window === 'undefined' || !userId || !consultId) return null;
  const raw = window.localStorage.getItem(snapshotKey(userId, consultId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function clearConsultSnapshot(userId: string, consultId: string): void {
  if (typeof window === 'undefined' || !userId || !consultId) return;
  window.localStorage.removeItem(snapshotKey(userId, consultId));
}

/**
 * Pull every transcript for this user. Used by the dashboard recents
 * widget to compute "n turns" badges without loading full content.
 */
export function listConsultIds(userId: string): string[] {
  if (typeof window === 'undefined' || !userId) return [];
  const prefix = `${STORAGE_PREFIX}${userId}:`;
  const out: string[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    if (k?.startsWith(prefix)) out.push(k.slice(prefix.length));
  }
  return out;
}
