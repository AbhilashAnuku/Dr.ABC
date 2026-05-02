import { Mic, MicOff, Send } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '../lib/auth.tsx';
import { type VoiceCommand, parseCommand, stripWakeWord } from '../lib/global-voice.ts';
import { listMemory } from '../lib/morbius-memory.ts';
import { cancelSpeech, isMorbiusSpeaking } from '../lib/voice.ts';

/**
 * GlobalVoiceListener — app-shell-mounted, always-on (when toggled
 * via the floating mic button) wake-word listener. Runs the same
 * cumulative-result-dedupe logic as clinic.tsx's per-page listener.
 *
 * The toggle is OFF by default — Chrome/Edge keep the mic permission
 * banner visible even when not actively recording, so we don't pop
 * the prompt on every sign-in. Tapping the floating mic once arms it;
 * "Mörbius open settings" / "Mörbius go to brain map" / "Mörbius stop"
 * then routes from anywhere.
 */

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult:
    | ((e: {
        results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>;
        resultIndex?: number;
      }) => void)
    | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionLike;
}

function getSpeechRecognition(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  // biome-ignore lint/suspicious/noExplicitAny: vendor-prefixed Web Speech API
  const w = window as any;
  return (w.SpeechRecognition ??
    w.webkitSpeechRecognition ??
    null) as SpeechRecognitionConstructor | null;
}

const STORAGE_KEY = 'dr-abc:global-voice-armed';

export function GlobalVoiceListener() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const [armed, setArmed] = useState(false);
  const [lastCommand, setLastCommand] = useState<{ text: string; ts: number } | null>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const lastSentRef = useRef<string>('');
  const armedRef = useRef(false);

  // Hydrate the toggle from sessionStorage so it persists across
  // route changes within a single session but resets on tab close.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setArmed(window.sessionStorage.getItem(STORAGE_KEY) === '1');
  }, []);

  const dispatch = useCallback(
    (cmd: VoiceCommand) => {
      switch (cmd.kind) {
        case 'navigate':
          setLastCommand({ text: `→ ${cmd.label}`, ts: Date.now() });
          setLocation(cmd.path);
          break;
        case 'dictate':
          window.sessionStorage.setItem('dr-abc:pending-consult', cmd.text);
          setLastCommand({ text: `ask · ${cmd.text}`, ts: Date.now() });
          setLocation('/app/consult');
          break;
        case 'control':
          // Use the voice module's cancelSpeech so the speaking-state
          // flag clears in lock-step with the actual cancel — not
          // just the underlying speechSynthesis call. This keeps the
          // recognition listener consistent with what the user heard.
          cancelSpeech();
          setLastCommand({ text: `${cmd.action}`, ts: Date.now() });
          break;
        case 'clear':
          window.sessionStorage.setItem('dr-abc:clear-chat', String(Date.now()));
          setLastCommand({ text: 'clear chat', ts: Date.now() });
          setLocation('/app/consult');
          break;
        case 'resume':
          // Resume the most recent consult (newest entry in
          // per-user memory that has a consultId attached).
          if (user) {
            void listMemory(user.id, 25)
              .then((rows) => {
                const newest = rows.find((r) => r.consultId);
                if (newest?.consultId) {
                  setLastCommand({
                    text: `→ resume ${newest.diagnosis ?? 'last consult'}`,
                    ts: Date.now(),
                  });
                  setLocation(`/app/clinic?id=${newest.consultId}`);
                } else {
                  setLastCommand({ text: 'no consult to resume yet', ts: Date.now() });
                }
              })
              .catch(() => {
                setLastCommand({ text: 'resume failed', ts: Date.now() });
              });
          }
          break;
        case 'recents':
          // Toggle the recents drawer via a session flag the
          // app-shell reads.
          window.sessionStorage.setItem('dr-abc:recents-open', '1');
          window.dispatchEvent(new CustomEvent('dr-abc:recents:open'));
          setLastCommand({ text: 'show recents', ts: Date.now() });
          break;
      }
    },
    [setLocation, user],
  );

  const start = useCallback(() => {
    const Ctor = getSpeechRecognition();
    if (!Ctor) {
      window.alert('Voice commands need Chrome or Edge.');
      return;
    }
    const r = new Ctor();
    r.continuous = true;
    r.interimResults = false;
    r.lang = 'en-US';
    r.onresult = (e) => {
      // Echo guard — same fix as clinic.tsx. Skip transcripts that
      // arrive while Mörbius is speaking so the mic doesn't pick up
      // his own TTS.
      if (isMorbiusSpeaking()) return;
      const startAt = e.resultIndex ?? 0;
      let final = '';
      for (let i = startAt; i < e.results.length; i++) {
        const res = e.results[i];
        if (!res || !res.isFinal) continue;
        final += `${res[0]?.transcript ?? ''} `;
      }
      const trimmed = final.trim();
      if (!trimmed || trimmed === lastSentRef.current) return;
      lastSentRef.current = trimmed;
      const rest = stripWakeWord(trimmed);
      if (rest === null) return;
      const cmd = parseCommand(rest);
      if (!cmd) {
        setLastCommand({ text: `? "${rest}"`, ts: Date.now() });
        return;
      }
      dispatch(cmd);
    };
    r.onend = () => {
      // Auto-restart while armed so the listener feels truly
      // always-on. Browsers (Chromium especially) auto-stop after
      // ~60 s of silence; restarting here keeps the wake-word alive.
      if (armedRef.current && recRef.current === r) {
        try {
          r.start();
        } catch {
          // Race with .stop() — accept defeat for this session.
        }
      }
    };
    r.onerror = (e) => {
      // 'no-speech' fires routinely; ignore it to avoid spam.
      if (e.error !== 'no-speech') {
        setLastCommand({ text: `voice error: ${e.error}`, ts: Date.now() });
      }
    };
    recRef.current = r;
    armedRef.current = true;
    setArmed(true);
    window.sessionStorage.setItem(STORAGE_KEY, '1');
    try {
      r.start();
    } catch {
      // Some Chromium builds throw if start() is called twice in a row.
    }
  }, [dispatch]);

  const stop = useCallback(() => {
    armedRef.current = false;
    setArmed(false);
    window.sessionStorage.removeItem(STORAGE_KEY);
    try {
      recRef.current?.stop();
    } catch {
      // ignore
    }
  }, []);

  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-40 flex flex-col items-end gap-2">
      {lastCommand && Date.now() - lastCommand.ts < 4000 && (
        <div className="pointer-events-auto rounded-lg border border-quantum-400/40 bg-ink-950/85 px-3 py-1.5 font-mono text-[11px] text-quantum-200 shadow-lg backdrop-blur">
          <span className="text-app-faint">mörbius · </span>
          {lastCommand.text}
        </div>
      )}
      <button
        type="button"
        onClick={armed ? stop : start}
        title={
          armed
            ? 'Disarm Mörbius voice ("Mörbius stop")'
            : 'Arm Mörbius voice — say "Mörbius open …"'
        }
        className={
          armed
            ? 'pointer-events-auto inline-flex h-11 w-11 items-center justify-center rounded-full border border-bio-500/60 bg-bio-500/20 text-bio-300 shadow-[0_0_20px_-4px_rgba(16,185,129,0.6)] backdrop-blur transition hover:bg-bio-500/30'
            : 'pointer-events-auto inline-flex h-11 w-11 items-center justify-center rounded-full border border-app-subtle bg-ink-950/70 text-app-muted backdrop-blur transition hover:border-quantum-400/60 hover:text-quantum-300'
        }
      >
        {armed ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
      </button>
      {armed && (
        <div className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full border border-app-subtle bg-ink-950/85 px-3 py-1 font-mono text-[9px] uppercase tracking-[0.32em] text-app-faint backdrop-blur">
          <Send className="h-3 w-3 text-bio-300" />
          listening · say "mörbius …"
        </div>
      )}
    </div>
  );
}
