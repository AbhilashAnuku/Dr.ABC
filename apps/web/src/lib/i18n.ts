import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';
import de from '../locales/de.json';
import en from '../locales/en.json';

/**
 * Stage 8: the static UI ships in English + German only — the two
 * locales the review board reads. The chat itself
 * still translates into any MarianMT-supported language at runtime via
 * py-svc (lib/translate.ts) — the user's reply locale is decoupled
 * from the panel chrome.
 *
 * The Hindi bundle (`locales/hi.json`) is kept on disk so we can
 * re-enable it in one line, but it isn't loaded until then.
 */

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      de: { translation: de },
    },
    fallbackLng: 'en',
    supportedLngs: ['en', 'de'],
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'dr-abc:lang',
    },
  });

export default i18n;

export const SUPPORTED_LANGS = [
  { code: 'en', label: 'English', native: 'English' },
  { code: 'de', label: 'German', native: 'Deutsch' },
] as const;
