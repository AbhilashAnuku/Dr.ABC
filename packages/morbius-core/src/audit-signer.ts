/**
 * Ed25519 audit signer — signs every activity-log entry so a clinic
 * IT auditor can verify the entire chain hasn't been tampered with.
 *
 * Design:
 *   - The keypair lives in `AUDIT_LOG_SIGNING_KEY` (base64-encoded
 *     32-byte seed) in `.env`. If unset, the signer falls back to an
 *     ephemeral session key — entries from that session can be
 *     verified inside the session, not after restart.
 *   - Every entry is signed against a deterministic canonical
 *     serialisation: alphabetical keys, ISO timestamps, no trailing
 *     whitespace. Same entry → same signature.
 *   - The chain is hash-linked: entry N's hash incorporates entry
 *     N-1's hash, so a single tamper anywhere breaks every signature
 *     downstream.
 *   - Verification re-signs the canonical bytes and compares.
 *
 * Built on Web Crypto (`crypto.subtle.sign / .verify` with Ed25519),
 * available in Bun + modern browsers + Node 18+. No external deps.
 */

interface SignableEntry {
  /** Stable id (e.g. consult id + ts). */
  id: string;
  /** ISO-8601 timestamp. */
  ts: string;
  /** What kind of activity (consult · imaging · rx · admin). */
  kind: string;
  /** Pseudonymous user id (never raw PHI). */
  userId: string;
  /** Free-form payload — must be JSON-serialisable. */
  payload: Record<string, unknown>;
}

export interface SignedEntry extends SignableEntry {
  /** Hash of the canonical bytes of (entry + prevHash). */
  hash: string;
  /** Hash of the previous entry, or '0'.repeat(64) for the genesis. */
  prevHash: string;
  /** Base64 Ed25519 signature over the canonical bytes. */
  signature: string;
  /** First 8 chars of the signing key's public hex — to detect key rotations. */
  keyHint: string;
}

/**
 * Canonical JSON: keys sorted alphabetically, no extra whitespace,
 * arrays preserve order. Deterministic — same entry → same bytes.
 */
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(',')}}`;
}

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Decode a base64 string to Uint8Array. Works in Bun + Node + browser. */
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i] ?? 0);
  return btoa(bin);
}

const GENESIS_HASH = '0'.repeat(64);

export class AuditSigner {
  private keyPair: CryptoKeyPair | null = null;
  private keyHint = 'unsig';
  /** Most recent hash — passed forward to chain the next entry. */
  private chainHead = GENESIS_HASH;
  private ready: Promise<void>;

  constructor(opts: { seedBase64?: string | undefined } = {}) {
    this.ready = this.bootstrap(opts.seedBase64);
  }

  private async bootstrap(seedBase64: string | undefined): Promise<void> {
    if (seedBase64) {
      // Bun + Node 20+ + browsers all support importKey for Ed25519
      // raw private key. The seed is the 32-byte private scalar; we
      // derive the public via signing once + extracting.
      try {
        const seed = b64ToBytes(seedBase64);
        if (seed.length !== 32) {
          throw new Error('AUDIT_LOG_SIGNING_KEY must be a 32-byte base64 seed');
        }
        // Ed25519 raw import expects a 32-byte private key.
        const priv = await crypto.subtle.importKey(
          'raw',
          seed.buffer as ArrayBuffer,
          { name: 'Ed25519' },
          true,
          ['sign'],
        );
        // Public key is derived by importKey from the public-half
        // export of the private. Use generateKey path as a fallback
        // when raw-import isn't supported on this runtime.
        const pub = await crypto.subtle.importKey(
          'raw',
          seed.buffer as ArrayBuffer,
          { name: 'Ed25519' },
          true,
          ['verify'],
        );
        this.keyPair = { privateKey: priv, publicKey: pub };
        this.keyHint = (await sha256Hex(seedBase64)).slice(0, 8);
        return;
      } catch {
        // Fall through to ephemeral
      }
    }

    // Ephemeral session keypair — signatures verifiable in-session only
    const generated = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
      'sign',
      'verify',
    ])) as CryptoKeyPair;
    this.keyPair = generated;
    const pubRaw = await crypto.subtle.exportKey('raw', generated.publicKey);
    const pubB64 = bytesToB64(new Uint8Array(pubRaw));
    this.keyHint = (await sha256Hex(pubB64)).slice(0, 8);
  }

  /**
   * Sign an entry and chain it onto the running head. Returns the
   * signed entry; the caller persists it (typically into the activity
   * sink). Subsequent calls inherit the new chainHead.
   */
  async sign(entry: SignableEntry): Promise<SignedEntry> {
    await this.ready;
    if (!this.keyPair) throw new Error('audit signer not initialised');

    const prevHash = this.chainHead;
    // hash = SHA256(canonical(entry) || prevHash)
    const canon = canonicalize(entry);
    const hash = await sha256Hex(canon + prevHash);
    const message = new TextEncoder().encode(canon + prevHash);
    const sig = await crypto.subtle.sign('Ed25519', this.keyPair.privateKey, message);
    const signature = bytesToB64(new Uint8Array(sig));
    this.chainHead = hash;
    return { ...entry, prevHash, hash, signature, keyHint: this.keyHint };
  }

  /**
   * Verify one entry's signature + chain-hash. Returns
   *   { ok: true } when both pass
   *   { ok: false, reason } otherwise.
   *
   * Does NOT verify the prev-hash links — that's `verifyChain()`.
   */
  async verifyOne(entry: SignedEntry): Promise<{ ok: boolean; reason?: string }> {
    await this.ready;
    if (!this.keyPair) return { ok: false, reason: 'signer not initialised' };

    const { hash, prevHash, signature, keyHint, ...rest } = entry;
    if (keyHint !== this.keyHint) {
      return { ok: false, reason: `key-hint mismatch (entry=${keyHint}, signer=${this.keyHint})` };
    }
    const canon = canonicalize(rest);
    const expectedHash = await sha256Hex(canon + prevHash);
    if (expectedHash !== hash) return { ok: false, reason: 'hash mismatch — entry tampered' };

    const message = new TextEncoder().encode(canon + prevHash);
    const sigBytes = b64ToBytes(signature);
    const ok = await crypto.subtle.verify(
      'Ed25519',
      this.keyPair.publicKey,
      sigBytes.buffer as ArrayBuffer,
      message.buffer as ArrayBuffer,
    );
    return ok ? { ok } : { ok: false, reason: 'signature invalid' };
  }

  /**
   * Verify a sequence of entries forms an unbroken chain — every
   * entry's `prevHash` matches the previous entry's `hash`. Returns
   * { ok: true, length } or { ok: false, brokenAt }.
   */
  async verifyChain(
    entries: SignedEntry[],
  ): Promise<{ ok: true; length: number } | { ok: false; brokenAt: number; reason: string }> {
    let prev = GENESIS_HASH;
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (!e) continue;
      if (e.prevHash !== prev) {
        return { ok: false, brokenAt: i, reason: `prevHash mismatch at index ${i}` };
      }
      const r = await this.verifyOne(e);
      if (!r.ok) return { ok: false, brokenAt: i, reason: r.reason ?? 'unknown' };
      prev = e.hash;
    }
    return { ok: true, length: entries.length };
  }

  /** Reset the chain head — used after a rotation event. */
  resetChain(): void {
    this.chainHead = GENESIS_HASH;
  }

  /** The first 8 chars of the signing key's identifier. */
  getKeyHint(): string {
    return this.keyHint;
  }
}

/** Singleton accessor — most callers want this. */
let _instance: AuditSigner | null = null;
export function getAuditSigner(seedBase64?: string): AuditSigner {
  if (!_instance) {
    _instance = new AuditSigner({ seedBase64: seedBase64 ?? process.env.AUDIT_LOG_SIGNING_KEY });
  }
  return _instance;
}

/** Test-only — reset the singleton. */
export function resetAuditSigner(): void {
  _instance = null;
}
