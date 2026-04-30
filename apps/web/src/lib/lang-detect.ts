/**
 * lang-detect — sub-millisecond language sniff for chat turns.
 *
 * Purpose: when the user types into the consult composer, detect
 * whether the text is German / English / Hindi so we can:
 *   1. Suggest an i18n UI switch when the detected language doesn't
 *      match the current page locale.
 *   2. Pass the right `lang` tag to the TTS layer so Mörbius speaks
 *      in the language of the REPLY, not the UI shell.
 *
 * Heuristic-only — no model call, no network. Three signals per
 * language: character-set, diacritic presence, function-word
 * frequency. Returns the language code plus a 0-1 confidence so
 * the caller can ignore weak signals (one-word messages, mixed
 * codeswitch turns, etc.).
 */

export type LangCode = 'en' | 'de' | 'hi';

const GERMAN_FUNCTION_WORDS = new Set([
  'ich',
  'du',
  'er',
  'sie',
  'wir',
  'ist',
  'sind',
  'war',
  'haben',
  'habe',
  'und',
  'oder',
  'aber',
  'nicht',
  'mit',
  'der',
  'die',
  'das',
  'den',
  'dem',
  'ein',
  'eine',
  'einen',
  'einer',
  'für',
  'auf',
  'auch',
  'sehr',
  'mein',
  'meine',
  'dein',
  'sich',
  'wie',
  'was',
  'wenn',
  'weil',
  'guten',
  'tag',
  'morgen',
  'abend',
  'hallo',
  'danke',
  'bitte',
  'arzt',
  'schmerz',
  'schmerzen',
  'kopf',
  'bauch',
  'fieber',
  'krank',
]);

const ENGLISH_FUNCTION_WORDS = new Set([
  'the',
  'a',
  'an',
  'i',
  'you',
  'he',
  'she',
  'we',
  'is',
  'are',
  'was',
  'have',
  'has',
  'and',
  'or',
  'but',
  'not',
  'with',
  'for',
  'on',
  'also',
  'very',
  'my',
  'your',
  'his',
  'her',
  'me',
  'how',
  'what',
  'when',
  'why',
  'because',
  'hello',
  'hi',
  'thanks',
  'please',
  'doctor',
  'pain',
  'head',
  'stomach',
  'fever',
  'sick',
]);

export interface LangDetectResult {
  lang: LangCode;
  confidence: number;
}

/**
 * Detect the language of `text`. Returns `{ lang, confidence }`.
 * Confidence under 0.4 means "ambiguous — don't act on it" (typical
 * for one-word messages or numeric input).
 */
export function detectLang(text: string): LangDetectResult {
  const trimmed = text.trim();
  if (!trimmed) return { lang: 'en', confidence: 0 };

  // Devanagari script — Hindi is unambiguous when present.
  if (/[ऀ-ॿ]/.test(trimmed)) {
    return { lang: 'hi', confidence: 0.95 };
  }

  const hasGermanDiacritic = /[äöüÄÖÜß]/.test(trimmed);

  const tokens = trimmed
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2);

  if (tokens.length === 0) return { lang: 'en', confidence: 0 };

  let germanHits = 0;
  let englishHits = 0;
  for (const t of tokens) {
    if (GERMAN_FUNCTION_WORDS.has(t)) germanHits += 1;
    if (ENGLISH_FUNCTION_WORDS.has(t)) englishHits += 1;
  }

  // Diacritic gives German a strong nudge — typing "guten" without
  // umlauts could still be German, but "schmerzen mit fieber" is
  // unambiguous on the umlaut signal.
  if (hasGermanDiacritic) germanHits += 3;

  const total = germanHits + englishHits;
  if (total === 0) {
    return { lang: 'en', confidence: 0 };
  }

  if (germanHits > englishHits) {
    return {
      lang: 'de',
      confidence: Math.min(1, germanHits / Math.max(1, tokens.length) + 0.2),
    };
  }
  return {
    lang: 'en',
    confidence: Math.min(1, englishHits / Math.max(1, tokens.length) + 0.2),
  };
}

/**
 * BCP-47 tag for a LangCode — used by SpeechSynthesisUtterance.lang
 * and SpeechRecognition.lang. Defaults match the LANG_MAP convention
 * used in the consult page.
 */
export function bcp47(lang: LangCode): string {
  if (lang === 'de') return 'de-DE';
  if (lang === 'hi') return 'hi-IN';
  return 'en-US';
}
