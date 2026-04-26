/**
 * api-keys — process-local registry of issued Mörbius API keys.
 *
 * In production you'd swap the `Map` for Postgres; everything else
 * stays the same. The contract is:
 *
 *   1. issue()    → returns a fresh `morbius_<32-hex>` key + metadata
 *   2. revoke()   → marks a key inactive
 *   3. verify()   → constant-time compare against the registry; returns
 *                   the key meta on hit, null on miss
 *   4. list()     → lists key meta for the developer dashboard
 *
 * Keys are bound to a userId + a label so the developer can
 * differentiate (e.g. "postman-local", "ci", "iphone-test"). They
 * carry no scopes today — every key has full /orchestrate access. A
 * `scopes` field is reserved on the meta for the next iteration.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';

export interface ApiKeyMeta {
  /** Public identifier — safe to display + log. */
  id: string;
  /** Owning user (mock auth: opaque string). */
  userId: string;
  /** Human label so the operator can tell keys apart. */
  label: string;
  /** ISO timestamp of issue. */
  createdAt: number;
  /** ISO timestamp of last successful verify (live counter). */
  lastUsedAt: number | null;
  /** True until revoked. */
  active: boolean;
  /** Future: per-key scopes. Empty = full access. */
  scopes: string[];
}

interface KeyRecord extends ApiKeyMeta {
  /** Raw key value — never returned to /list. */
  secret: string;
  /** Cached buffer for timing-safe compare. */
  secretBuf: Buffer;
}

const STORE = new Map<string, KeyRecord>();

export function issue(userId: string, label: string): { key: string; meta: ApiKeyMeta } {
  const id = `key_${randomBytes(6).toString('hex')}`;
  const secret = `morbius_${randomBytes(24).toString('hex')}`;
  const meta: ApiKeyMeta = {
    id,
    userId,
    label: label.trim() || 'untitled',
    createdAt: Date.now(),
    lastUsedAt: null,
    active: true,
    scopes: [],
  };
  STORE.set(id, { ...meta, secret, secretBuf: Buffer.from(secret) });
  return { key: secret, meta };
}

export function list(userId: string): ApiKeyMeta[] {
  const out: ApiKeyMeta[] = [];
  for (const rec of STORE.values()) {
    if (rec.userId !== userId) continue;
    out.push({
      id: rec.id,
      userId: rec.userId,
      label: rec.label,
      createdAt: rec.createdAt,
      lastUsedAt: rec.lastUsedAt,
      active: rec.active,
      scopes: rec.scopes,
    });
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

export function revoke(userId: string, id: string): boolean {
  const rec = STORE.get(id);
  if (!rec || rec.userId !== userId) return false;
  rec.active = false;
  return true;
}

export function verify(presented: string): ApiKeyMeta | null {
  if (!presented || !presented.startsWith('morbius_')) return null;
  const buf = Buffer.from(presented);
  // Linear scan is fine at project scale — would be replaced by an
  // indexed lookup in Postgres at production scale.
  for (const rec of STORE.values()) {
    if (!rec.active) continue;
    if (rec.secretBuf.length !== buf.length) continue;
    if (timingSafeEqual(rec.secretBuf, buf)) {
      rec.lastUsedAt = Date.now();
      return {
        id: rec.id,
        userId: rec.userId,
        label: rec.label,
        createdAt: rec.createdAt,
        lastUsedAt: rec.lastUsedAt,
        active: rec.active,
        scopes: rec.scopes,
      };
    }
  }
  return null;
}

/** Test-only: clear the registry between cases. */
export function _resetForTests(): void {
  STORE.clear();
}
