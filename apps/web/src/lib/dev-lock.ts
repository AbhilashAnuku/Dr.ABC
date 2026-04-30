/**
 * dev-lock — PIN gate for /app/dev-console.
 *
 * The dev console exposes runtime env editing, the live system probe,
 * and the continuous-learning controls. None of these belong on the
 * patient-facing surface, so we gate the route behind a PIN.
 *
 * Posture:
 *   - Default PIN is 4242 — printed in AGENTS.md / README so the
 *     console can be demoed without first-run friction.
 *   - The PIN can be rotated from inside the dev console once
 *     unlocked (writes to localStorage).
 *   - Unlock is per-tab (sessionStorage) so closing the tab re-locks
 *     the route — provides a biometric / password-style lock without
 *     needing WebAuthn (which requires a TLS context the local dev
 *     server doesn't have).
 *   - Future upgrade path: swap `verifyPin()` for a WebAuthn
 *     `navigator.credentials.get(...)` call when running over HTTPS.
 *     The rest of the gate is untouched.
 */

const PIN_STORAGE_KEY = 'dr-abc:dev-pin';
const UNLOCKED_SESSION_KEY = 'dr-abc:dev-unlocked';
const PASSKEY_CRED_ID_KEY = 'dr-abc:dev-passkey-id';
const DEFAULT_PIN = '4242';

/** Read the configured PIN, falling back to the default. */
export function getConfiguredPin(): string {
  if (typeof window === 'undefined') return DEFAULT_PIN;
  return window.localStorage.getItem(PIN_STORAGE_KEY) ?? DEFAULT_PIN;
}

/** True when the current tab has unlocked the dev console this session. */
export function isDevConsoleUnlocked(): boolean {
  if (typeof window === 'undefined') return false;
  return window.sessionStorage.getItem(UNLOCKED_SESSION_KEY) === '1';
}

/**
 * Constant-time PIN compare. Returns true on match + persists the
 * unlock to sessionStorage so the gate stops asking until the tab
 * closes.
 */
export function verifyPin(input: string): boolean {
  const expected = getConfiguredPin();
  if (input.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= input.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  const ok = mismatch === 0;
  if (ok && typeof window !== 'undefined') {
    window.sessionStorage.setItem(UNLOCKED_SESSION_KEY, '1');
  }
  return ok;
}

/** Lock the dev console again (e.g. for a sign-out hook). */
export function lockDevConsole(): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(UNLOCKED_SESSION_KEY);
}

/** Rotate the PIN. Empty string resets to the default. */
export function setDevPin(next: string): void {
  if (typeof window === 'undefined') return;
  if (!next || next === DEFAULT_PIN) {
    window.localStorage.removeItem(PIN_STORAGE_KEY);
    return;
  }
  if (!/^\d{4,8}$/.test(next)) {
    throw new Error('PIN must be 4-8 digits');
  }
  window.localStorage.setItem(PIN_STORAGE_KEY, next);
}

export const DEV_PIN_DEFAULT = DEFAULT_PIN;

// ============================================================
//  WebAuthn / Passkey opt-in
// ============================================================
//
// The PIN gate is the floor. On secure contexts (https or localhost
// with platform authenticator support) a passkey can be enrolled —
// Touch ID / Windows Hello / Android fingerprint — to unlock the dev
// console without typing the PIN. The PIN remains as the
// always-available fallback.

export function isPasskeySupported(): boolean {
  if (typeof window === 'undefined') return false;
  if (!window.PublicKeyCredential) return false;
  // Platform authenticator (Touch ID / Windows Hello / Android fingerprint).
  return (
    typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function'
  );
}

export function isPasskeyEnrolled(): boolean {
  if (typeof window === 'undefined') return false;
  return !!window.localStorage.getItem(PASSKEY_CRED_ID_KEY);
}

function bytesToB64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let out = '';
  for (let i = 0; i < view.length; i++) out += String.fromCharCode(view[i] ?? 0);
  return btoa(out);
}

function b64ToBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const buf = new ArrayBuffer(bin.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
  return buf;
}

/**
 * Enroll a platform passkey for unlocking the dev console.
 *
 * Resolves with the credential id once enrolled. Throws if the
 * platform doesn't support WebAuthn or the user cancels.
 *
 * Note: `rp.id` defaults to the current host so passkeys are
 * scope-pinned per origin (localhost vs morbius.vercel.app are
 * separate enrolments — by design).
 */
export async function enrollPasskey(): Promise<string> {
  if (typeof window === 'undefined' || !window.PublicKeyCredential) {
    throw new Error('WebAuthn not available in this browser');
  }
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userId = crypto.getRandomValues(new Uint8Array(16));
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: 'Mörbius Dev Console' },
      user: {
        id: userId,
        name: 'architect@dr-abc.local',
        displayName: 'Architect',
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 }, // ES256
        { type: 'public-key', alg: -257 }, // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred',
      },
      timeout: 60_000,
      attestation: 'none',
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error('Passkey enrolment cancelled');
  const credId = bytesToB64(cred.rawId);
  window.localStorage.setItem(PASSKEY_CRED_ID_KEY, credId);
  return credId;
}

/** Verify the enrolled passkey unlocks the dev console. */
export async function verifyPasskey(): Promise<boolean> {
  if (typeof window === 'undefined' || !window.PublicKeyCredential) return false;
  const credIdB64 = window.localStorage.getItem(PASSKEY_CRED_ID_KEY);
  if (!credIdB64) return false;
  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const cred = (await navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: [{ type: 'public-key', id: b64ToBuffer(credIdB64) }],
        userVerification: 'required',
        timeout: 60_000,
      },
    })) as PublicKeyCredential | null;
    if (!cred) return false;
    window.sessionStorage.setItem(UNLOCKED_SESSION_KEY, '1');
    return true;
  } catch {
    return false;
  }
}

export function unenrollPasskey(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(PASSKEY_CRED_ID_KEY);
}
