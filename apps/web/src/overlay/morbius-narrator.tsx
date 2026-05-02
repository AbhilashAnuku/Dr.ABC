import { Button, cn } from '@dr-abc/ui';
import { ChevronLeft, ChevronRight, Volume2, VolumeX, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../lib/auth.tsx';
import { speakWithProsody } from '../lib/voice.ts';
import { MorbiusMark } from './morbius-mark.tsx';

/**
 * Stage 8.5 narrator — single guided tour for the demo user. The
 * previous role-routing was collapsed when the role surface was
 * dropped; this is now just one ordered list.
 */
type StepId = 'dashboard' | 'clinic' | 'appointments' | 'profile' | 'settings';

const TOUR_STEPS: StepId[] = ['dashboard', 'clinic', 'appointments', 'profile', 'settings'];

/**
 * MorbiusNarrator — first-run guided tour that fires the very first
 * time a freshly-signed-in user lands on /app. Mörbius narrates each
 * sidebar destination (role-aware) with synchronised text + voice
 * (browser SpeechSynthesis), highlights the matching nav item via a
 * data-narrator attribute, and persists "seen" to localStorage so it
 * never replays automatically.
 *
 * Reachable any time from Settings or by deleting the storage key.
 */

const NARRATOR_SEEN_PREFIX = 'dr-abc:narrator-seen:';

interface Step {
  id: StepId;
  title: string;
  body: string;
}

const STEPS: Record<StepId, Step> = {
  dashboard: {
    id: 'dashboard',
    title: 'Dashboard',
    body: 'Your live snapshot — recent consultations, the medical-record summary, and the memory graph of every consult you have run.',
  },
  clinic: {
    id: 'clinic',
    title: 'Consultation',
    body: 'I run the consult here. Capture vitals, talk to me, watch the differential build, and end with a downloadable PDF prescription.',
  },
  appointments: {
    id: 'appointments',
    title: 'Appointments',
    body: 'Schedule and review visits — booking for patients, schedule grid for doctors.',
  },
  profile: {
    id: 'profile',
    title: 'Records',
    body: 'The medical record I read on every consult — demographics, allergies, conditions, medications, family history. Auto-saves locally.',
  },
  settings: {
    id: 'settings',
    title: 'Settings',
    body: 'Theme, language, voice, and the door to replay this tour any time.',
  },
};

const I18N_LANG_MAP: Record<string, string> = { en: 'en-US', de: 'de-DE', hi: 'hi-IN' };

export function readNarratorSeen(userId: string): boolean {
  if (typeof window === 'undefined') return true;
  return window.localStorage.getItem(`${NARRATOR_SEEN_PREFIX}${userId}`) === '1';
}

export function markNarratorSeen(userId: string) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(`${NARRATOR_SEEN_PREFIX}${userId}`, '1');
}

export function clearNarratorSeen(userId: string) {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(`${NARRATOR_SEEN_PREFIX}${userId}`);
}

interface Props {
  /** External "open" override (Settings → Replay tour). */
  forceOpen?: boolean;
  onClose?: () => void;
}

export function MorbiusNarrator({ forceOpen = false, onClose }: Props) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [muted, setMuted] = useState(false);

  // Decide whether to auto-open on mount.
  useEffect(() => {
    if (!user) return;
    if (forceOpen) {
      setOpen(true);
      setStep(0);
      return;
    }
    if (!readNarratorSeen(user.id)) {
      setOpen(true);
      setStep(0);
    }
  }, [user, forceOpen]);

  const steps: Step[] = useMemo(() => {
    if (!user) return [];
    const tour = TOUR_STEPS.map((id) => STEPS[id]);
    const intro: Step = {
      id: 'dashboard',
      title: `Welcome, ${user.name.split(' ')[0]}`,
      body: `I am Mörbius, your on-call medical AI. I'll walk you through ${tour.length} panes — use the arrows or press Esc to skip.`,
    };
    return [intro, ...tour];
  }, [user]);

  const speak = useCallback(
    (text: string) => {
      if (muted) return;
      const lang = window.navigator.language?.split('-')[0] ?? 'en';
      speakWithProsody(text, { lang: I18N_LANG_MAP[lang] ?? 'en-US' });
    },
    [muted],
  );

  // Speak + spotlight whenever the step changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: speak is intentionally captured by value
  useEffect(() => {
    if (!open) return;
    const s = steps[step];
    if (!s) return;
    speak(`${s.title}. ${s.body}`);
    // Spotlight the matching sidebar item via data attribute.
    for (const el of document.querySelectorAll<HTMLElement>('[data-narrator-target]')) {
      el.removeAttribute('data-narrator-active');
    }
    const target = document.querySelector<HTMLElement>(`[data-narrator-target="${s.id}"]`);
    if (target) target.setAttribute('data-narrator-active', 'true');
    return () => {
      for (const el of document.querySelectorAll<HTMLElement>('[data-narrator-target]')) {
        el.removeAttribute('data-narrator-active');
      }
    };
  }, [open, step, steps]);

  // Esc to close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowRight') next();
      if (e.key === 'ArrowLeft') prev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const close = () => {
    if (user) markNarratorSeen(user.id);
    setOpen(false);
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    onClose?.();
  };

  const next = () => {
    if (step >= steps.length - 1) return close();
    setStep((s) => s + 1);
  };

  const prev = () => setStep((s) => Math.max(0, s - 1));

  if (!open || steps.length === 0) return null;

  const current = steps[step];
  if (!current) return null;
  const last = step === steps.length - 1;

  return (
    <dialog
      open
      aria-labelledby="narrator-title"
      className="pointer-events-none fixed inset-0 z-[60] m-0 flex max-h-none max-w-none items-end justify-end bg-transparent p-4 sm:items-end sm:justify-end"
    >
      <div
        className={cn(
          'animate-narrator-jump pointer-events-auto relative z-10 flex w-[min(420px,calc(100vw-2rem))] flex-col gap-3 rounded-2xl border border-quantum-400/50 bg-ink-950/98 p-4 shadow-[0_18px_80px_-28px_rgba(56,189,248,0.85)]',
        )}
      >
        <div className="flex items-start gap-3">
          <div className="shrink-0">
            <MorbiusMark size={56} active speaking={!muted} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-quantum-300">
                Mörbius · narrator
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setMuted((m) => !m)}
                  aria-label={muted ? 'Unmute narrator' : 'Mute narrator'}
                  className="rounded-md p-1 text-app-muted hover:bg-white/5 hover:text-app-primary"
                >
                  {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                </button>
                <button
                  type="button"
                  onClick={close}
                  aria-label="Close"
                  className="rounded-md p-1 text-app-muted hover:bg-white/5 hover:text-app-primary"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <h2
              id="narrator-title"
              className="mt-1 font-display text-lg font-bold text-app-primary"
            >
              {current.title}
            </h2>
            <p className="mt-1 font-sans text-sm leading-relaxed text-app-secondary">
              {current.body}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-app-faint">
            step {step + 1} / {steps.length}
          </span>
          <div className="flex items-center gap-1.5">
            <Button variant="ghost" onClick={prev} disabled={step === 0}>
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <Button variant="primary" onClick={next}>
              {last ? 'Begin' : 'Next'}
              {!last && <ChevronRight className="ml-1 h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>

        <div className="-mb-1 -mx-1 mt-1 h-1 rounded-full bg-white/5">
          <div
            className="h-full rounded-full bg-quantum-400 transition-all"
            style={{ width: `${((step + 1) / steps.length) * 100}%` }}
          />
        </div>
      </div>
    </dialog>
  );
}
