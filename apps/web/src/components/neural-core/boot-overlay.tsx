// Reusable Mörbius neural-core boot overlay.
// Full-window blue blur + 10-second loader + WebAudio offline beep +
// Mörbius voice intro. Used by:
//   /app/neural-core   — dedicated neural-core experience
//   /app/brain         — same boot ceremony before the brain map paints
//   /app/dev-console   — Neural Core tab
//
// Drop-in: render <NeuralCoreBoot onComplete={...}> at the top of any
// page. The overlay is `fixed inset-0 z-[80]` so it covers the
// AppShell sidebar + topbar so the blur extends across the entire
// window. Once the 10-s boot finishes the overlay fades and
// `onComplete` is called.

import { motion, useReducedMotion } from 'framer-motion';
import { Brain } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { speakWithProsody } from '../../lib/voice.ts';

export type NeuralBootState = 'offline' | 'booting' | 'online';

const ACCESS_SCRIPT =
  'Hello user. You are accessing the Mörbius neural core. Initialising synaptic mesh.';

const INTRO_SCRIPT =
  'I am Mörbius. My knowledge base is built on local Ollama, six specialist agents, and a graphify-style medical Second Brain that grows every cycle. The Secure Pass runs on every reply. The Mörbius Secure Protocol guarantees one primary goal: save at least one human life. You are now accessing my neural core.';

interface BootOptions {
  /** Total duration of the boot loader in ms. Default 10_000. */
  durationMs?: number;
  /** Skip the voice intro at 100 % (e.g. when dev-console is muted). */
  silent?: boolean;
  /** Force the full boot sequence even when this session has already
   *  seen one. Used by the dev-console "replay boot" button. */
  force?: boolean;
  /** the editor-style stepped progress — jumps between key milestones
   *  (5 · 19 · 56 · 89 · 97 · 100) instead of smoothly interpolating.
   *  Reads as "loading something real" rather than "spinner".
   *  Implies a faster default duration (5 s). */
  stepped?: boolean;
  /** Use a separate session-storage namespace so a stepped boot in
   *  one surface (dev-console) doesn't suppress the cinematic boot
   *  somewhere else. */
  storageKey?: string;
}

const SESSION_KEY = 'dr-abc:neural-core-booted';

// Milestones for the stepped (the editor-style) loader. Each entry is
// the percentage shown and the cumulative time at which we land there.
// The value JUMPS — no easing — so it reads as discrete progress
// signals, not a sweeping bar. Milestones land at 5/19/56/89/97/100
// before the overlay opens, mirroring an editor-style loader.
const STEPPED_MILESTONES: Array<{ pct: number; atMs: number }> = [
  { pct: 5, atMs: 250 },
  { pct: 19, atMs: 950 },
  { pct: 56, atMs: 2300 },
  { pct: 89, atMs: 3600 },
  { pct: 97, atMs: 4500 },
  { pct: 100, atMs: 5000 },
];

function alreadyBootedThisSession(key: string): boolean {
  if (typeof window === 'undefined') return false;
  return window.sessionStorage.getItem(key) === '1';
}

function markBooted(key: string): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(key, '1');
}

/**
 * Runs the boot sequence (beep + voice + progress) once PER SESSION.
 * Subsequent mounts within the same browser tab skip the 10-s delay
 * and resolve straight to `online`. The dev-console exposes a
 * "replay boot" affordance via `force: true` for demos.
 *
 * Returns the live state for the caller to render its own UI.
 */
export function useNeuralBoot(opts: BootOptions = {}): {
  state: NeuralBootState;
  progress: number;
} {
  const { silent = false, force = false, stepped = false, storageKey = SESSION_KEY } = opts;
  const durationMs = opts.durationMs ?? (stepped ? 5_000 : 10_000);
  const initialState: NeuralBootState =
    !force && alreadyBootedThisSession(storageKey) ? 'online' : 'offline';
  const [state, setState] = useState<NeuralBootState>(initialState);
  const [progress, setProgress] = useState(initialState === 'online' ? 100 : 0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const startedRef = useRef(initialState === 'online');

  const playOfflineBeep = useCallback(() => {
    try {
      // biome-ignore lint/suspicious/noExplicitAny: webkit audio prefix
      const Ctor = (window as any).AudioContext || (window as any).webkitAudioContext;
      const ctx = audioCtxRef.current ?? (new Ctor() as AudioContext);
      audioCtxRef.current = ctx;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'square';
      osc.frequency.setValueAtTime(220, ctx.currentTime);
      osc.frequency.setValueAtTime(110, ctx.currentTime + 0.15);
      osc.frequency.setValueAtTime(220, ctx.currentTime + 0.3);
      gain.gain.setValueAtTime(0.06, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.45);
      osc.start();
      osc.stop(ctx.currentTime + 0.5);
    } catch {
      // some browsers block audio without a user gesture
    }
  }, []);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    let mounted = true;
    setState('booting');
    if (!silent) speakWithProsody(ACCESS_SCRIPT);
    playOfflineBeep();

    if (stepped) {
      // Discrete milestone walk — the editor-style. Each setTimeout
      // snaps the displayed percentage to the next milestone, so the
      // examiner reads "5 · 19 · 56 · 89 · 97 · 100" rather than a
      // smoothly sweeping bar.
      const timers: number[] = [];
      const lastMilestone = STEPPED_MILESTONES[STEPPED_MILESTONES.length - 1];
      const scale = lastMilestone ? durationMs / lastMilestone.atMs : 1;
      for (const m of STEPPED_MILESTONES) {
        const id = window.setTimeout(() => {
          if (!mounted) return;
          setProgress(m.pct);
          if (m.pct >= 100) {
            setState('online');
            markBooted(storageKey);
            if (!silent) {
              setTimeout(() => {
                if (mounted) speakWithProsody(INTRO_SCRIPT);
              }, 600);
            }
          }
        }, m.atMs * scale);
        timers.push(id);
      }
      return () => {
        mounted = false;
        for (const id of timers) clearTimeout(id);
        if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
          window.speechSynthesis.cancel();
        }
      };
    }

    const start = performance.now();
    const tick = () => {
      if (!mounted) return;
      const elapsed = performance.now() - start;
      const pct = Math.min(100, (elapsed / durationMs) * 100);
      setProgress(pct);
      if (pct < 100) {
        requestAnimationFrame(tick);
      } else {
        setState('online');
        markBooted(storageKey);
        if (!silent) {
          setTimeout(() => {
            if (mounted) speakWithProsody(INTRO_SCRIPT);
          }, 700);
        }
      }
    };
    requestAnimationFrame(tick);
    return () => {
      mounted = false;
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, [durationMs, silent, stepped, storageKey, playOfflineBeep]);

  return { state, progress };
}

interface OverlayProps {
  state: NeuralBootState;
  progress: number;
  /** Defaults to true. When false, the overlay sits inside its parent
   *  rather than covering the whole viewport. */
  fullScreen?: boolean;
  /** Optional override for the headline (default REBOOTING). */
  headline?: string;
}

export function NeuralCoreBootOverlay({
  state,
  progress,
  fullScreen = true,
  headline = 'REBOOTING',
}: OverlayProps) {
  // v0.7 audit slice 3 a11y — honour prefers-reduced-motion. The
  // 10-second pulsing brain + scanline can trigger vestibular issues;
  // when reduced-motion is on we render a static overlay (still
  // visible, still progresses) but skip the breathing scale animation.
  const reduced = useReducedMotion();
  const positionClasses = fullScreen ? 'fixed inset-0 z-[80]' : 'absolute inset-0 z-50';
  // v1.0.18 fix (2026-05-10): unmount the overlay entirely when state
  // becomes 'online'. Previously the overlay faded to opacity 0 but
  // STAYED in the DOM, occluding the underlying page (including the
  // dev-console PIN gate when deep-linked via ?tab=research). This
  // surfaced as a blank scanline-pattern screen — the page below
  // was rendering but the overlay's z-[80] sat on top with 0 alpha.
  if (state === 'online') return null;
  return (
    <motion.div
      initial={{ opacity: 1 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.6 }}
      className={`${positionClasses} flex flex-col items-center justify-center bg-gradient-to-br from-blue-950 via-ink-950 to-blue-900 backdrop-blur-xl`}
    >
      <div className="absolute inset-0 opacity-30">
        <ScanlineGrid />
      </div>
      <motion.div
        animate={reduced ? undefined : { scale: [1, 1.08, 1], opacity: [0.7, 1, 0.7] }}
        transition={reduced ? undefined : { duration: 2, repeat: Number.POSITIVE_INFINITY }}
        className="relative mb-6"
      >
        <Brain className="h-20 w-20 text-blue-300" strokeWidth={1.2} />
        {!reduced && <div className="absolute inset-0 animate-ping rounded-full bg-blue-400/20" />}
      </motion.div>
      <div className="font-mono text-[10px] uppercase tracking-[0.4em] text-blue-300">
        · Mörbius · neural core · initialising ·
      </div>
      <div className="mt-4 font-syne text-2xl font-black tracking-[-0.02em] text-blue-100 sm:text-4xl">
        {headline}
      </div>
      <div className="mt-6 w-72 max-w-[80vw]">
        <div className="h-1 w-full overflow-hidden rounded-full bg-blue-950 ring-1 ring-blue-400/20">
          <motion.div
            className="h-full bg-gradient-to-r from-blue-500 via-cyan-400 to-blue-300"
            style={{ width: `${progress}%` }}
            transition={{ duration: 0.2 }}
          />
        </div>
        <div className="mt-2 flex justify-between font-mono text-[9px] uppercase tracking-[0.22em] text-blue-300/70">
          <span>● off-robotic</span>
          <span>{Math.round(progress)} %</span>
          <span>{progress < 100 ? 'loading' : 'online'}</span>
        </div>
      </div>
      <div className="mt-8 max-w-md px-6 text-center font-grotesk text-xs text-blue-200/70 sm:text-sm">
        <span className="block">Hello user. You are accessing the Mörbius neural core.</span>
        <span className="mt-1 block opacity-70">
          Synaptic mesh assembling · agents waking · gauntlet warm-up
        </span>
      </div>
    </motion.div>
  );
}

function ScanlineGrid() {
  return (
    <svg
      className="h-full w-full"
      preserveAspectRatio="none"
      viewBox="0 0 100 100"
      role="img"
      aria-label="Scanline grid"
    >
      <title>Scanline grid</title>
      <defs>
        <pattern id="scan-overlay" width="2" height="2" patternUnits="userSpaceOnUse">
          <line
            x1="0"
            y1="0"
            x2="2"
            y2="0"
            stroke="#60a5fa"
            strokeOpacity="0.15"
            strokeWidth="0.3"
          />
        </pattern>
      </defs>
      <rect width="100" height="100" fill="url(#scan-overlay)" />
    </svg>
  );
}
