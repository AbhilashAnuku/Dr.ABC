/**
 * Password hashing — Argon2id via Bun.password.
 *
 * Argon2id is the OWASP-recommended scheme (winner of the Password
 * Hashing Competition). Bun.password ships it natively so we don't add
 * a third-party dependency. Hash includes salt + params, so no
 * separate salt column is needed.
 *
 * Params: memoryCost 19456 KiB ≈ 19 MiB, timeCost 2 — OWASP's 2023
 * minimum for argon2id at >=64 MiB virtual memory budget. Timing on a
 * modern CPU: ~50 ms per hash, which is the sweet spot between
 * defending against offline attacks and not blocking the event loop.
 */

const HASH_OPTS = {
  algorithm: 'argon2id' as const,
  memoryCost: 19_456,
  timeCost: 2,
};

export async function hashPassword(plain: string): Promise<string> {
  if (typeof plain !== 'string' || plain.length === 0) {
    throw new Error('password required');
  }
  if (plain.length < 8) {
    throw new Error('password must be at least 8 characters');
  }
  if (plain.length > 1024) {
    throw new Error('password too long');
  }
  return Bun.password.hash(plain, HASH_OPTS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  if (typeof plain !== 'string' || typeof hash !== 'string') return false;
  try {
    return await Bun.password.verify(plain, hash);
  } catch {
    return false;
  }
}

/** 32 crypto-random bytes → 64-char hex. Opaque session token. */
export function newSessionToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Canonical email — trimmed + lower-cased. Run before insert + lookup. */
export function canonEmail(raw: string): string {
  return raw.trim().toLowerCase();
}
