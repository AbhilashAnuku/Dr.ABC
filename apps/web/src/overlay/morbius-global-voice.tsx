import { useEffect, useRef } from 'react';
import { type LangCode, bcp47, detectLang } from '../lib/lang-detect.ts';
import { type SpeakTone, isMorbiusSpeaking, speakWithProsody } from '../lib/voice.ts';

/**
 * MorbiusGlobalVoice — listens for `morbius:speak` custom events from
 * anywhere in the app and routes them to the on-device TTS.
 *
 * Enables Mörbius to speak any analysis result from anywhere in the
 * app.
 *
 * Any feature that produces an analysis result can emit:
 *
 *   window.dispatchEvent(new CustomEvent('morbius:speak', {
 *     detail: {
 *       text: 'Differential ready. Top condition: acute MI.',
 *       tone: 'reassuring',     // optional · default 'conversational'
 *       priority: 'high',       // optional · 'high' interrupts current speech
 *     },
 *   }));
 *
 * Mounted once at the App-level (next to MorbiusOverlay + Narrator) so
 * a single listener serves every route.
 *
 * Throttling rules — every new emit interrupts the prior one (latest
 * always wins), same-text dedupe sits at 30 seconds so a single Mörbius
 * reply never gets spoken twice from two listeners, and substring
 * dedupe catches the proactive-narrator's short ack overlapping a
 * longer consult reply. Anti-spam cap stays at ≤ 6 utterances/minute.
 */
export function MorbiusGlobalVoice() {
  const lastSpokenRef = useRef<{ text: string; at: number } | null>(null);
  const recentRef = useRef<number[]>([]);

  useEffect(() => {
    const handler = (raw: Event) => {
      const ev = raw as CustomEvent<{
        text?: string;
        tone?: SpeakTone;
        priority?: 'normal' | 'high';
        lang?: LangCode;
      }>;
      const text = (ev.detail?.text ?? '').trim();
      if (!text) return;

      const now = Date.now();

      // Dedupe — same text within 30 s, OR substring/superset overlap
      // with whatever we just spoke (the narrator + consult page both
      // emitted variations of the same reply and we'd hear it twice).
      const prior = lastSpokenRef.current;
      if (prior && now - prior.at < 30_000) {
        const a = prior.text.toLowerCase();
        const b = text.toLowerCase();
        if (a === b || a.includes(b) || b.includes(a)) return;
      }

      // Rate limit: 6/min
      const cutoff = now - 60_000;
      recentRef.current = recentRef.current.filter((t) => t >= cutoff);
      if (recentRef.current.length >= 6) return;
      recentRef.current.push(now);
      lastSpokenRef.current = { text, at: now };

      // Latest wins — always cancel any in-flight utterance so two
      // overlapping voices never play together.
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }

      // Pick the speaking language: prefer the caller-supplied `lang`
      // (consult page passes the LLM reply's detected language) but
      // fall back to auto-detect from the text itself so the voice
      // tracks the REPLY language, not the UI shell.
      const detected = ev.detail?.lang ?? detectLang(text).lang;
      void speakWithProsody(text, {
        tone: ev.detail?.tone ?? 'conversational',
        lang: bcp47(detected),
      });
    };

    window.addEventListener('morbius:speak', handler as EventListener);
    return () => window.removeEventListener('morbius:speak', handler as EventListener);
  }, []);

  return null;
}

/** Convenience helper for any route to fire a speak event without
 *  hand-rolling the CustomEvent. Tree-shakes to nothing when unused.
 *
 *  Callers can pass `coalesce: 'replace'` (default) so the new
 *  utterance interrupts whatever Mörbius is currently saying, or
 *  `coalesce: 'skip'` to drop the new emit when Mörbius is already
 *  speaking — useful for proactive narrator pings that should never
 *  step on a consult reply. */
export function morbiusSpeak(
  text: string,
  opts: {
    tone?: SpeakTone;
    priority?: 'normal' | 'high';
    coalesce?: 'replace' | 'skip';
    /** Optional language hint — when omitted the listener auto-detects. */
    lang?: LangCode;
  } = {},
): void {
  if (typeof window === 'undefined') return;
  if (opts.coalesce === 'skip' && isMorbiusSpeaking()) return;
  window.dispatchEvent(
    new CustomEvent('morbius:speak', {
      detail: { text, tone: opts.tone, priority: opts.priority, lang: opts.lang },
    }),
  );
}
