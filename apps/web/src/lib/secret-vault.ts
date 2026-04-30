/**
 * Secret vault — AES-GCM at rest, PBKDF2-derived key, passphrase-only-
 * in-memory.
 *
 * Storage shape per key (all under `dr-abc:secret:<KEY>`):
 *   { v: 1, salt: <base64 16B>, iv: <base64 12B>, ct: <base64> }
 *
 * The salt is per-vault, not per-secret — generated once when the
 * passphrase is set, persisted under `dr-abc:secret-meta`. Reusing the
 * salt is fine here because every secret has its own random IV; we
 * just need a stable salt → key mapping so the dev sets the passphrase
 * once and unlocks everything.
 */

const META_KEY = 'dr-abc:secret-meta';
const SECRET_KEY_PREFIX = 'dr-abc:secret:';
const PBKDF2_ITERATIONS = 250_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const KEY_BITS = 256;

interface VaultMeta {
  v: 1;
  salt: string; // base64
  /** Probe ciphertext used to verify the passphrase before attempting the real reveal. */
  probeIv: string;
  probeCt: string;
}

interface SealedSecret {
  v: 1;
  iv: string;
  ct: string;
}

const PROBE_PLAINTEXT = 'dr-abc-vault-probe-v1';

function b64encode(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i] ?? 0);
  return btoa(s);
}

function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: toPlainArrayBuffer(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: KEY_BITS },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function encryptToSealed(plain: string, key: CryptoKey): Promise<SealedSecret> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ivBuf = toPlainArrayBuffer(iv);
  const ptBuf = toPlainArrayBuffer(new TextEncoder().encode(plain));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: ivBuf }, key, ptBuf);
  return { v: 1, iv: b64encode(iv), ct: b64encode(new Uint8Array(ct)) };
}

async function decryptFromSealed(sealed: SealedSecret, key: CryptoKey): Promise<string> {
  const iv = b64decode(sealed.iv);
  const ct = b64decode(sealed.ct);
  const ivBuf = toPlainArrayBuffer(iv);
  const ctBuf = toPlainArrayBuffer(ct);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivBuf }, key, ctBuf);
  return new TextDecoder().decode(pt);
}

/**
 * Coerce a Uint8Array (which TS types as `ArrayBufferLike` because the
 * backing store could in theory be a SharedArrayBuffer) into a plain
 * `ArrayBuffer` that WebCrypto's strict `BufferSource` accepts.
 */
function toPlainArrayBuffer(view: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(view.length);
  new Uint8Array(out).set(view);
  return out;
}

function readMeta(): VaultMeta | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(META_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as VaultMeta;
  } catch {
    return null;
  }
}

function writeMeta(meta: VaultMeta): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(META_KEY, JSON.stringify(meta));
}

/** True when the developer has set a passphrase + at least one probe secret. */
export function vaultExists(): boolean {
  return readMeta() !== null;
}

/**
 * Initialise a fresh vault with the chosen passphrase. Generates a new
 * salt + writes a probe ciphertext we use later to confirm a reveal
 * attempt knows the passphrase before we try decrypting real secrets.
 */
export async function initVault(passphrase: string): Promise<CryptoKey> {
  if (typeof window === 'undefined') throw new Error('vault: no window');
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const key = await deriveKey(passphrase, salt);
  const probe = await encryptToSealed(PROBE_PLAINTEXT, key);
  writeMeta({ v: 1, salt: b64encode(salt), probeIv: probe.iv, probeCt: probe.ct });
  return key;
}

/**
 * Re-derive the key from an entered passphrase + verify it against the
 * stored probe ciphertext. Returns the live key on success, throws on
 * wrong passphrase. The key never persists to disk — only in-memory.
 */
export async function unlockVault(passphrase: string): Promise<CryptoKey> {
  const meta = readMeta();
  if (!meta) throw new Error('vault: not initialised');
  const key = await deriveKey(passphrase, b64decode(meta.salt));
  // Probe — throws if wrong passphrase (AES-GCM auth-tag check).
  const probeOk = await decryptFromSealed({ v: 1, iv: meta.probeIv, ct: meta.probeCt }, key);
  if (probeOk !== PROBE_PLAINTEXT) throw new Error('vault: probe mismatch');
  return key;
}

/** Persist a secret under the canonical name. */
export async function sealSecret(name: string, plain: string, key: CryptoKey): Promise<void> {
  if (typeof window === 'undefined') return;
  const sealed = await encryptToSealed(plain, key);
  window.localStorage.setItem(`${SECRET_KEY_PREFIX}${name}`, JSON.stringify(sealed));
}

/** Reveal a secret — returns null when not stored. */
export async function revealSecret(name: string, key: CryptoKey): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(`${SECRET_KEY_PREFIX}${name}`);
  if (!raw) return null;
  try {
    const sealed = JSON.parse(raw) as SealedSecret;
    return await decryptFromSealed(sealed, key);
  } catch {
    return null;
  }
}

export function deleteSecret(name: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(`${SECRET_KEY_PREFIX}${name}`);
}

/** Names of every stored secret (for the diagnostics panel). */
export function listSecretNames(): string[] {
  if (typeof window === 'undefined') return [];
  const out: string[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    if (k?.startsWith(SECRET_KEY_PREFIX)) out.push(k.slice(SECRET_KEY_PREFIX.length));
  }
  return out;
}

/** Wipe everything — passphrase, probe, and every sealed secret. */
export function destroyVault(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(META_KEY);
  for (const name of listSecretNames()) deleteSecret(name);
}

/** Canonical names of every env key the secrets panel manages. */
export const ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_VISION_MODEL',
  'NVIDIA_API_KEY',
  'NVIDIA_MODEL',
  'NVIDIA_VISION_MODEL',
  'HF_API_TOKEN',
  'HF_MODEL',
  'OLLAMA_BASE_URL',
  'OLLAMA_MODEL',
  'OPENAI_API_KEY',
  'PY_SVC_URL',
  'PY_SVC_TIMEOUT_MS',
  'IMAGING_BACKEND',
  'NER_BACKEND',
  'GENOMICS_BACKEND',
  'GOOGLE_FIT_TOKEN',
  'KAGGLE_USERNAME',
  'KAGGLE_KEY',
  'HF_DATASETS_TOKEN',
] as const;

export type EnvKey = (typeof ENV_KEYS)[number];

/** Where each key fits in the secrets-panel grouping. */
export const KEY_GROUPS: Record<string, EnvKey[]> = {
  Reasoning: [
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_MODEL',
    'ANTHROPIC_VISION_MODEL',
    'NVIDIA_API_KEY',
    'NVIDIA_MODEL',
    'NVIDIA_VISION_MODEL',
    'HF_API_TOKEN',
    'HF_MODEL',
    'OPENAI_API_KEY',
  ],
  'Local LLM': ['OLLAMA_BASE_URL', 'OLLAMA_MODEL'],
  'Sidecar + Backends': [
    'PY_SVC_URL',
    'PY_SVC_TIMEOUT_MS',
    'IMAGING_BACKEND',
    'NER_BACKEND',
    'GENOMICS_BACKEND',
  ],
  'Fitness + Datasets': ['GOOGLE_FIT_TOKEN', 'KAGGLE_USERNAME', 'KAGGLE_KEY', 'HF_DATASETS_TOKEN'],
};
