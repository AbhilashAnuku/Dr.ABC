/**
 * In-process env overlay so the developer can rotate API keys + flip
 * backend toggles from the /app/secrets panel without restarting the
 * Hono server. Every agent factory that consumes env should consult
 * `effectiveEnv()` instead of `process.env` directly so the overrides
 * take effect on the next call.
 *
 * Lifetime: process-only. Cleared on server restart, just like
 * process.env. The dev's secrets persist client-side in the AES-GCM
 * vault and are re-pushed on every web-app boot.
 *
 * Security posture: this is an alpha mock-auth surface. The
 * `POST /dev/env-keys` endpoint that writes here is gated by a
 * `X-Dr-Abc-Role: developer` header — adequate for the local-demo
 * posture. Production lands JWT verification with Keycloak in Phase 4.
 */

const overrides: Record<string, string> = {};

/** Canonical names the overlay recognises. Matches secret-vault.ts. */
export const OVERRIDABLE_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_VISION_MODEL',
  'NVIDIA_API_KEY',
  'NVIDIA_MODEL',
  'NVIDIA_VISION_MODEL',
  'HF_API_TOKEN',
  'HF_MODEL',
  'GEMINI_API_KEY',
  'GEMINI_MODEL',
  'OLLAMA_BASE_URL',
  'OLLAMA_MODEL',
  'OPENAI_API_KEY',
  'PY_SVC_URL',
  'PY_SVC_TIMEOUT_MS',
  'IMAGING_BACKEND',
  'MORBIUS_IMAGING',
  'NER_BACKEND',
  'GENOMICS_BACKEND',
  'GOOGLE_FIT_TOKEN',
  'KAGGLE_USERNAME',
  'KAGGLE_KEY',
  'HF_DATASETS_TOKEN',
  // Diagnostic backend routing — single-pin or comma-list override.
  // Lets the dev console flip from local Ollama to Anthropic without
  // touching the .env file.
  'MORBIUS_BACKEND',
  'BACKEND_PRIORITY',
  // Cookie-session signing secret, DB URL, and OAuth client IDs.
  // Allowed here so the dev console can persist them via /dev/env-persist.
  'AUTH_COOKIE_SECRET',
  'DATABASE_URL',
  'GOOGLE_OAUTH_CLIENT_ID',
  'GOOGLE_OAUTH_CLIENT_SECRET',
  'GOOGLE_OAUTH_REDIRECT',
  'FITBIT_OAUTH_CLIENT_ID',
  'FITBIT_OAUTH_CLIENT_SECRET',
  'RESEND_API_KEY',
  'EMAIL_FROM',
  // Roboflow YOLO second-pass — the imaging consult page calls
  // /imaging/roboflow after the primary /imaging route lands, then
  // merges the predictions into the ImagingResultCard.
  'ROBOFLOW_API_KEY',
  'ROBOFLOW_WORKSPACE',
  'ROBOFLOW_WORKFLOW',
] as const;

export type OverridableKey = (typeof OVERRIDABLE_KEYS)[number];

const OVERRIDABLE_SET = new Set<string>(OVERRIDABLE_KEYS);

/**
 * Merge dev-supplied overrides over the process env. Unknown keys are
 * silently dropped so the endpoint can't be abused to inject arbitrary
 * environment.
 */
export function setOverrides(next: Record<string, unknown>): {
  applied: number;
  rejected: string[];
} {
  let applied = 0;
  const rejected: string[] = [];
  for (const [k, v] of Object.entries(next)) {
    if (!OVERRIDABLE_SET.has(k)) {
      rejected.push(k);
      continue;
    }
    if (v == null || v === '') {
      delete overrides[k];
      applied++;
      continue;
    }
    overrides[k] = String(v);
    applied++;
  }
  return { applied, rejected };
}

/** Drops every override — back to pure process.env behaviour. */
export function clearOverrides(): void {
  for (const k of Object.keys(overrides)) delete overrides[k];
}

/** What the agent factories should consult on every call. */
export function effectiveEnv(): Record<string, string | undefined> {
  return new Proxy({} as Record<string, string | undefined>, {
    get(_target, key) {
      if (typeof key !== 'string') return undefined;
      if (key in overrides) return overrides[key];
      return process.env[key];
    },
    has(_target, key) {
      if (typeof key !== 'string') return false;
      return key in overrides || key in process.env;
    },
    ownKeys() {
      const set = new Set<string>([...Object.keys(process.env), ...Object.keys(overrides)]);
      return [...set];
    },
    getOwnPropertyDescriptor(_target, key) {
      if (typeof key !== 'string') return undefined;
      const value = key in overrides ? overrides[key] : process.env[key];
      if (value === undefined) return undefined;
      return { value, writable: false, enumerable: true, configurable: true };
    },
  });
}

/** Snapshot of currently-active overrides — for /health diagnostics. */
export function listOverrides(): { key: OverridableKey; redacted: string }[] {
  return (Object.keys(overrides) as OverridableKey[]).map((key) => {
    const value = overrides[key] ?? '';
    const redacted =
      value.length <= 4
        ? `${'*'.repeat(value.length)}`
        : `${value.slice(0, 2)}${'*'.repeat(Math.min(8, value.length - 4))}${value.slice(-2)}`;
    return { key, redacted };
  });
}
