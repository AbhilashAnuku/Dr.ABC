import { Card, cn } from '@dr-abc/ui';
import { ChevronRight, Maximize2, Mic, Pause, Play, Sparkles } from 'lucide-react';
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MORBIUS_QA, type QaEntry, findAnswer } from '../../lib/morbius-qa.ts';
import { isMorbiusSpeaking, speakWithProsody } from '../../lib/voice.ts';
import { MorbiusMark } from '../../overlay/morbius-mark.tsx';

// Three.js lazy-loaded — only lands when the fullscreen overlay is
// launched. AGENTS.md §7 standing rule: heavy chunks must be
// React.lazy + Suspense, never in the initial bundle.
const MorbiusFullscreen = lazy(() =>
  import('../../overlay/morbius-fullscreen.tsx').then((m) => ({ default: m.MorbiusFullscreen })),
);

/**
 * MorbiusIntroCard — top-of-dev-console hero where Mörbius introduces
 * itself, fronted by a launch button.
 *
 * Two modes:
 *   1. Idle  — gradient hero · Launch button · Mörbius mark animated
 *   2. Live  — Mörbius is talking · text reveals letter-by-letter ·
 *              "Ask anything" prompt · 15 defense Q&A chips
 *
 * Behavior:
 *   - Click Launch → Mörbius speaks the canonical 30-second intro,
 *     text streams in sync, the card switches to Live mode.
 *   - Live mode shows defense-Q&A suggestion chips. Click one →
 *     Mörbius speaks that answer.
 *   - "Ask anything" textarea routes through findAnswer; if
 *     no match, falls back to a graceful "let me think" line.
 *
 * Doubles as a presentation teleprompter: selecting a question chip
 * has Mörbius answer it in voice + text, so a prepared answer can be
 * triggered on demand.
 */

const INTRO_TEXT =
  "I am Mörbius. A sovereign multi-agent medical AI built as the architect's MSc project at SRH Stuttgart. Five brains run in parallel inside me — retrieval, agentic reasoning, medical knowledge, persistent memory, and self-learning. My base model is Llama 3.3 70 billion Instruct, running locally on this box. My validator gauntlet, safety floor, and Mörbius Secure Protocol guarantee that my single stated goal — save at least one human life — overrides any confidence calculation. Ask me anything.";

export function MorbiusIntroCard() {
  const [state, setState] = useState<'idle' | 'speaking' | 'idle-after-intro'>('idle');
  const [shownText, setShownText] = useState('');
  const [activeQA, setActiveQA] = useState<QaEntry | null>(null);
  const [askInput, setAskInput] = useState('');
  // Immersive fullscreen overlay. Lazy-loaded so three.js doesn't land
  // in the dev-console chunk until used.
  const [fullscreen, setFullscreen] = useState(false);
  const speakSeqRef = useRef(0);

  // Stream `text` letter-by-letter into shownText, locked to a single
  // active sequence id so an interruption (clicking a different chip
  // mid-speech) cancels the prior animation cleanly.
  const streamText = useMemo(
    () => (text: string, seq: number) => {
      setShownText('');
      let i = 0;
      const tick = () => {
        if (seq !== speakSeqRef.current) return;
        i += 2;
        setShownText(text.slice(0, i));
        if (i < text.length) {
          window.setTimeout(tick, 18);
        }
      };
      tick();
    },
    [],
  );

  const launch = () => {
    if (typeof window === 'undefined') return;
    const seq = ++speakSeqRef.current;
    setState('speaking');
    setActiveQA(null);
    streamText(INTRO_TEXT, seq);
    speakWithProsody(INTRO_TEXT, { lang: 'en-US' });
    // Roughly track end-of-speech via a generous timer; the voice lib
    // already pushes isMorbiusSpeaking(), so an interval polls it.
    const poll = window.setInterval(() => {
      if (seq !== speakSeqRef.current) {
        window.clearInterval(poll);
        return;
      }
      if (!isMorbiusSpeaking()) {
        window.clearInterval(poll);
        setState((s) => (s === 'speaking' ? 'idle-after-intro' : s));
      }
    }, 400);
  };

  const speakQA = (qa: QaEntry) => {
    const seq = ++speakSeqRef.current;
    setState('speaking');
    setActiveQA(qa);
    streamText(qa.a, seq);
    speakWithProsody(qa.a, { lang: 'en-US' });
    const poll = window.setInterval(() => {
      if (seq !== speakSeqRef.current) {
        window.clearInterval(poll);
        return;
      }
      if (!isMorbiusSpeaking()) {
        window.clearInterval(poll);
        setState((s) => (s === 'speaking' ? 'idle-after-intro' : s));
      }
    }, 400);
  };

  const stop = () => {
    speakSeqRef.current++;
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setState('idle-after-intro');
  };

  const ask = (e: React.FormEvent) => {
    e.preventDefault();
    const q = askInput.trim();
    if (!q) return;
    const match = findAnswer(q);
    if (match) {
      speakQA(match);
    } else {
      const fallback: QaEntry = {
        id: 'fallback',
        q,
        a: "That's a question I do not have a pre-canned answer for. Try one of the suggestion chips — what is Mörbius, why multi-agent, why local-first, accuracy, bias, or safety. Or ask the operator to walk through the dev console live.",
        keys: [],
      };
      speakQA(fallback);
    }
    setAskInput('');
  };

  // Pause speech when the route unmounts — otherwise navigating away
  // leaves Mörbius mid-sentence in the background.
  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  return (
    <Card className="overflow-hidden p-0">
      <div className="relative bg-gradient-to-br from-purple-500/15 via-quantum-500/10 to-bio-500/15 p-6 sm:p-8">
        {/* Decorative radial */}
        <div className="-translate-x-1/2 pointer-events-none absolute top-0 left-1/2 h-40 w-40 rounded-full bg-quantum-400/15 blur-3xl" />
        <div className="-translate-x-1/2 pointer-events-none absolute top-0 left-1/2 h-px w-32 bg-gradient-to-r from-transparent via-purple-400 to-transparent" />

        <div className="relative grid gap-5 lg:grid-cols-[auto_1fr] lg:items-center">
          <div className="relative inline-flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl border border-purple-400/40 bg-purple-500/10 shadow-[0_0_60px_-15px_rgba(139,92,246,0.55)]">
            <MorbiusMark
              className={cn('h-10 w-10 text-purple-200', state === 'speaking' && 'animate-pulse')}
            />
            {state === 'speaking' && (
              <span className="-bottom-1 -right-1 absolute inline-flex h-4 w-4 items-center justify-center rounded-full border border-bio-400 bg-bio-500/30">
                <span className="h-1.5 w-1.5 animate-ping rounded-full bg-bio-400" />
              </span>
            )}
          </div>

          <div>
            <div className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.32em] text-purple-300">
              <Sparkles className="h-3 w-3" /> · meet mörbius · live ai introduction
            </div>
            <h2 className="mt-2 font-display text-2xl font-bold text-app-primary sm:text-3xl">
              {state === 'idle' ? 'Press play. Mörbius will introduce himself.' : null}
              {state === 'speaking' && activeQA ? activeQA.q : null}
              {state === 'speaking' && !activeQA ? 'Mörbius is introducing himself…' : null}
              {state === 'idle-after-intro' ? 'Ask Mörbius anything about the system.' : null}
            </h2>
            <p className="mt-3 min-h-[3.5rem] max-w-3xl font-sans text-sm leading-relaxed text-app-secondary sm:text-base">
              {state === 'idle' ? (
                <>
                  Tap the button below — Mörbius reads a 30-second self-intro through your speakers
                  and the text streams here in sync. After that, ask anything: 15 pre-rehearsed
                  defense answers are wired in for project Q&A.
                </>
              ) : (
                shownText || ' '
              )}
            </p>

            {/* Controls */}
            <div className="mt-5 flex flex-wrap items-center gap-2">
              {state === 'idle' && (
                <>
                  <button
                    type="button"
                    onClick={() => setFullscreen(true)}
                    className="inline-flex items-center gap-2 rounded-full border border-purple-400/40 bg-gradient-to-r from-purple-500/30 to-quantum-500/30 px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.32em] text-purple-100 shadow-[0_0_40px_-15px_rgba(139,92,246,0.55)] transition hover:from-purple-500/40 hover:to-quantum-500/40"
                  >
                    <Maximize2 className="h-4 w-4" /> Mörbius · cinema mode
                  </button>
                  <button
                    type="button"
                    onClick={launch}
                    className="inline-flex items-center gap-2 rounded-full border border-app-subtle bg-white/5 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.22em] text-app-secondary transition hover:bg-white/10"
                  >
                    <Play className="h-3.5 w-3.5" /> inline intro
                  </button>
                </>
              )}
              {state === 'speaking' && (
                <button
                  type="button"
                  onClick={stop}
                  className="inline-flex items-center gap-2 rounded-full border border-rose-400/40 bg-rose-500/15 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.22em] text-rose-200 hover:bg-rose-500/25"
                >
                  <Pause className="h-3.5 w-3.5" /> stop
                </button>
              )}
              {state === 'idle-after-intro' && (
                <button
                  type="button"
                  onClick={launch}
                  className="inline-flex items-center gap-2 rounded-full border border-app-subtle bg-white/5 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.22em] text-app-secondary hover:bg-white/10"
                >
                  <Play className="h-3.5 w-3.5" /> replay intro
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Q&A chip rail — visible after the intro, prepared answers
            for the most likely questions. */}
        {(state === 'idle-after-intro' || state === 'speaking') && (
          <div className="mt-6 border-purple-400/20 border-t pt-5">
            <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.32em] text-app-faint">
              defense Q&A · 15 pre-rehearsed answers
            </div>
            <div className="flex flex-wrap gap-1.5">
              {MORBIUS_QA.map((qa) => (
                <button
                  key={qa.id}
                  type="button"
                  onClick={() => speakQA(qa)}
                  className={cn(
                    'group inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] transition',
                    activeQA?.id === qa.id
                      ? 'border-quantum-400/60 bg-quantum-500/20 text-quantum-100'
                      : 'border-app-subtle bg-white/5 text-app-muted hover:border-purple-400/40 hover:bg-purple-500/10 hover:text-purple-200',
                  )}
                  title={qa.q}
                >
                  {qa.q.length > 36 ? `${qa.q.slice(0, 34)}…` : qa.q}
                  <ChevronRight className="h-3 w-3 opacity-70 transition group-hover:translate-x-0.5" />
                </button>
              ))}
            </div>

            {/* Free-form ask box. If the input matches a defense entry,
                Mörbius reads that. Otherwise a graceful "no canned
                answer" line allows pivoting to a live response. */}
            <form onSubmit={ask} className="mt-4 flex flex-wrap items-center gap-2">
              <Mic className="h-3.5 w-3.5 text-app-faint" aria-hidden="true" />
              <input
                value={askInput}
                onChange={(e) => setAskInput(e.target.value)}
                placeholder="ask anything · e.g., why local-first?"
                className="min-w-[260px] flex-1 rounded-full border border-app-subtle bg-white/5 px-4 py-2 font-sans text-sm text-app-primary placeholder:text-app-faint focus:border-purple-400/60 focus:outline-none"
              />
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 rounded-full border border-purple-400/40 bg-purple-500/15 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.22em] text-purple-200 hover:bg-purple-500/25"
              >
                ask
              </button>
            </form>
          </div>
        )}
      </div>

      {/* Mörbius cinema-mode overlay · lazy-loaded three.js
          Portal'd to <body> so the `position: fixed` overlay isn't
          trapped by Card's hover-transform (which creates a new
          containing-block and was clipping the fixed children — the
          cause of an earlier "fullscreen not working" bug).
          React.lazy + Suspense holds the chunk until the button is
          clicked; the fallback splash makes the load visible. */}
      {fullscreen &&
        typeof document !== 'undefined' &&
        createPortal(
          <Suspense
            fallback={
              <div className="fixed inset-0 z-100 flex items-center justify-center bg-black/95 backdrop-blur-sm">
                <div className="text-center">
                  <Sparkles className="mx-auto h-10 w-10 animate-pulse text-purple-300" />
                  <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.32em] text-purple-200">
                    loading cinema mode…
                  </p>
                </div>
              </div>
            }
          >
            <MorbiusFullscreen open={fullscreen} onClose={() => setFullscreen(false)} />
          </Suspense>,
          document.body,
        )}
    </Card>
  );
}
