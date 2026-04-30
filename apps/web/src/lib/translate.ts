/**
 * Tiny browser-side wrapper over `POST /api/translate`. The chat
 * renderer in `clinic.tsx` calls `translateIfNeeded(text, locale)`
 * for every Mörbius reply — when the user's locale isn't English
 * (and auto-translate is on in Settings), the reply is rewritten on
 * the fly via py-svc's MarianMT pipeline.
 *
 * Failure mode is intentional: any network/sidecar error returns the
 * original text with `wasTranslated: false` and a small note. The
 * chat keeps streaming; the user just sees English instead of a
 * blank space.
 */

export type TranslateLang = 'en' | 'de' | 'hi' | 'es' | 'fr';

export interface TranslateResult {
  text: string;
  wasTranslated: boolean;
  /** HuggingFace model id, or undefined when no call was made. */
  model?: string;
  latencyMs?: number;
  /** Operator-facing explanation when `wasTranslated` is false. */
  note?: string;
}

const PREF_KEY = 'dr-abc:auto-translate';
const SUPPORTED: ReadonlySet<TranslateLang> = new Set(['en', 'de', 'hi', 'es', 'fr']);

export function readAutoTranslatePref(): boolean {
  if (typeof window === 'undefined') return true;
  // Default ON for non-English locales — users from de-DE/hi-IN almost
  // always want their replies localised. Explicit "off" stays off.
  const v = window.localStorage.getItem(PREF_KEY);
  if (v === 'off') return false;
  return true;
}

export function writeAutoTranslatePref(on: boolean) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(PREF_KEY, on ? 'on' : 'off');
}

/**
 * The main entry point used by the chat. Decides whether to call the
 * server, returns the (possibly rewritten) text + diagnostic metadata.
 *
 * `srcLang` defaults to 'en' — Mörbius's responses are English unless
 * something else was passed. `enabled` defaults to the user's saved
 * auto-translate preference but tests pass it explicitly so they
 * don't depend on a writable localStorage.
 */
export async function translateIfNeeded(
  text: string,
  userLocale: string,
  srcLang: TranslateLang = 'en',
  opts: { enabled?: boolean; fetchImpl?: typeof fetch } = {},
): Promise<TranslateResult> {
  const tgt = userLocale.slice(0, 2).toLowerCase() as TranslateLang;
  if (!SUPPORTED.has(tgt) || tgt === srcLang) {
    return { text, wasTranslated: false, note: 'tgt unsupported or same as src' };
  }
  const enabled = opts.enabled ?? readAutoTranslatePref();
  if (!enabled) {
    return { text, wasTranslated: false, note: 'auto-translate disabled by user' };
  }
  if (!text.trim()) {
    return { text, wasTranslated: false };
  }
  const f = opts.fetchImpl ?? fetch;
  try {
    const res = await f('/api/translate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, src: srcLang, tgt }),
    });
    if (!res.ok) {
      return { text, wasTranslated: false, note: `translate http ${res.status}` };
    }
    const data = (await res.json()) as {
      text?: string;
      backend?: 'marianmt' | 'stub';
      model?: string;
      latencyMs?: number;
      note?: string;
    };
    if (data.backend === 'marianmt' && data.text) {
      return {
        text: data.text,
        wasTranslated: true,
        model: data.model,
        latencyMs: data.latencyMs,
      };
    }
    return {
      text: data.text ?? text,
      wasTranslated: false,
      note: data.note ?? 'sidecar returned stub',
    };
  } catch (err) {
    return {
      text,
      wasTranslated: false,
      note: err instanceof Error ? err.message : String(err),
    };
  }
}
