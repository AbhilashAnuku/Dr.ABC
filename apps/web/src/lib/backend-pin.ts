/**
 * Per-user backend pin — stored in localStorage, sent as a request
 * header so the orchestrator can route a single user's traffic to
 * their preferred backend without touching the project-wide .env.
 *
 *   readBackendPin()  → returns the user's saved pick (or 'cascade')
 *   writeBackendPin() → persists the pick + emits a `dr-abc:backend-pin`
 *                      window event so listeners (e.g. the top-bar
 *                      indicator chip) can re-render immediately.
 *   backendHeaders()  → headers object the fetch wrappers spread into
 *                      every API call.
 */

export type BackendId = 'cascade' | 'ollama' | 'nvidia' | 'huggingface' | 'anthropic';

interface BackendMeta {
  id: BackendId;
  label: string;
  detail: string;
  model: string;
  free: 'yes' | 'no' | 'after-pagefile';
  latency: string;
  medqa: string;
  bestFor: string;
}

export const BACKENDS: readonly BackendMeta[] = [
  {
    id: 'cascade',
    label: 'Cascade (recommended)',
    detail:
      'Try every backend in priority order — ollama → nvidia → huggingface → anthropic. First non-empty differential wins. No single point of failure.',
    model: 'all four · fall-through',
    free: 'yes',
    latency: '~100ms-10s (depends on which fires)',
    medqa: 'up to ~86%',
    bestFor: 'live demo · resilient · no manual switching',
  },
  {
    id: 'nvidia',
    label: 'NVIDIA NIM',
    detail:
      "NVIDIA-hosted Llama-3.3-70B. Free tier: 1000 credits/month. Fastest cloud path. Architect's recommended primary.",
    model: 'meta/llama-3.3-70b-instruct',
    free: 'yes',
    latency: '~107ms',
    medqa: '~83%',
    bestFor: 'demo day · live consults · fastest accurate path',
  },
  {
    id: 'anthropic',
    label: 'Anthropic Sonnet',
    detail:
      'Highest accuracy in the cascade. Requires ANTHROPIC_API_KEY in .env. Paid (cents per call).',
    model: 'claude-sonnet-4-6',
    free: 'no',
    latency: '~420ms',
    medqa: '~86%',
    bestFor: 'hardest cases · final-answer queries · paid OK',
  },
  {
    id: 'huggingface',
    label: 'HuggingFace · OpenBioLLM',
    detail:
      'Free inference tier · medical-specialty-tuned 8B model. Slower than NVIDIA, slightly less accurate. Good fallback.',
    model: 'aaditya/Llama3-OpenBioLLM-8B',
    free: 'yes',
    latency: '~170ms',
    medqa: '~74%',
    bestFor: 'fallback · medical-specialty-tuned · no paid key',
  },
  {
    id: 'ollama',
    label: 'Ollama (local)',
    detail:
      'Local 8B on 16 GB RAM. Sovereign · zero cloud. The 70B path needs the F: page file + reboot (see scripts/configure-f-pagefile.ps1). On 8B, accuracy is the cascade floor; on 70B it matches NVIDIA but at 30-90s/token.',
    model: 'llama3.1:8b (default) · llama3.3:70b-instruct-q4_K_M (with page file)',
    free: 'yes',
    latency: '~5-10s (8B) · 30-90s/token (70B with page file)',
    medqa: '~70% (8B) · ~83% (70B)',
    bestFor: 'offline · sovereign · overnight training',
  },
] as const;

const STORAGE_KEY = 'dr-abc:backend-pin';

export function readBackendPin(): BackendId {
  if (typeof window === 'undefined') return 'cascade';
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return 'cascade';
  return BACKENDS.some((b) => b.id === raw) ? (raw as BackendId) : 'cascade';
}

/**
 * Pin a backend. Writes localStorage AND POSTs the matching
 * MORBIUS_BACKEND env override to /dev/env-keys so the API rebuilds
 * its diagnostic agent on the spot. The next /orchestrate call uses
 * the new primary; cascade fallback chain stays intact.
 *
 * Cascade ('cascade') clears the override so the server falls back
 * to the project-wide DEFAULT_BACKEND_PRIORITY from .env.
 *
 * Returns { ok, error? } so the UI can show a saved/failed chip.
 */
export async function writeBackendPin(
  id: BackendId,
  apiBase = '/api',
): Promise<{ ok: boolean; error?: string; diagnosticBackend?: string }> {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (id === 'cascade') {
    window.localStorage.removeItem(STORAGE_KEY);
  } else {
    window.localStorage.setItem(STORAGE_KEY, id);
  }
  window.dispatchEvent(new CustomEvent('dr-abc:backend-pin', { detail: id }));

  // Push to the server's runtime-env overlay so the diagnostic agent
  // rebuilds. /dev/env-keys is dev-role-gated; the web app always
  // sends X-Dr-Abc-Role: developer on these architect-only writes.
  try {
    const url = `${apiBase}/dev/env-keys`;
    const method = id === 'cascade' ? 'DELETE' : 'POST';
    const init: RequestInit = {
      method,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-Dr-Abc-Role': 'developer',
      },
    };
    if (method === 'POST') {
      init.body = JSON.stringify({ MORBIUS_BACKEND: id });
    }
    const r = await fetch(url, init);
    if (!r.ok) {
      return { ok: false, error: `server returned ${r.status}` };
    }
    const j = (await r.json().catch(() => null)) as {
      ok?: boolean;
      diagnosticBackend?: string;
      error?: string;
    } | null;
    return {
      ok: j?.ok !== false,
      diagnosticBackend: j?.diagnosticBackend,
      error: j?.error,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown error' };
  }
}

/**
 * Headers the fetch wrappers spread into every API call. When the
 * pin is `cascade`, no header is sent and the server uses
 * DEFAULT_BACKEND_PRIORITY. When it's pinned, the header is set as a
 * belt-and-braces signal (the env override already changed the
 * primary; the header lets the orchestrator log which client asked).
 */
export function backendHeaders(): Record<string, string> {
  const pin = readBackendPin();
  if (pin === 'cascade') return {};
  return { 'X-Morbius-Backend': pin };
}
