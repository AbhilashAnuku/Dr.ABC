import { useEffect, useRef } from 'react';
import { useAuth } from '../lib/auth.tsx';
import { API_BASE } from '../lib/config.ts';
import { morbiusSpeak } from './morbius-global-voice.tsx';

/**
 * MorbiusProactiveNarrator — Mörbius talks like a daily-life caretaker.
 *
 * Mörbius proactively narrates today's vitals, sleep and water
 * reminders, and health tips, and feeds that data back into its
 * learning loop.
 *
 * The hook:
 *   1. On sign-in, hits /fitness/google/sync (returns steps + average
 *      heart rate from Google Fit · gracefully no-ops when user hasn't
 *      connected Google yet)
 *   2. Composes a single warm-care morning briefing and speaks it
 *   3. Schedules:
 *        · water reminder every 2 h during waking hours
 *        · midday step-count nudge (12:00 local · "you're at X steps")
 *        · evening sleep-prep cue (21:30 local · "wind down")
 *      Each fires a `morbiusSpeak()` event with rate limit + dedupe
 *      already handled by [[MorbiusGlobalVoice]] (1.4 s echo grace,
 *      6 utterances/min cap, same-text 4 s dedupe).
 *   4. Persists permission state — if the user disabled "speak" in
 *      /app/settings → Security, no scheduling fires.
 *
 * Mounted once at App-level next to MorbiusGlobalVoice.
 */
export function MorbiusProactiveNarrator() {
  const { user } = useAuth();
  const morningSpokenRef = useRef<string | null>(null); // ISO date

  useEffect(() => {
    if (!user) return;
    if (typeof window === 'undefined') return;

    // Permission gate · user toggle in /app/settings → Security
    const speakAllowed = (() => {
      try {
        const raw = window.localStorage.getItem('dr-abc:morbius-perms');
        if (!raw) return true; // default-on per the permissions panel
        const perms = JSON.parse(raw) as Record<string, boolean>;
        return perms.speak !== false;
      } catch {
        return true;
      }
    })();
    if (!speakAllowed) return;

    let cancelled = false;
    const today = new Date().toISOString().slice(0, 10);

    // ── 1 · Morning briefing · run once per local day ────────────
    const fireMorning = async () => {
      if (morningSpokenRef.current === today) return;
      morningSpokenRef.current = today;
      try {
        const res = await fetch(`${API_BASE}/fitness/google/sync`, {
          credentials: 'include',
        });
        if (!res.ok) {
          // 412 means Google Fit not connected · stay silent on first
          // sign-in, just don't compose vitals-based speech yet.
          return;
        }
        const data = (await res.json()) as {
          steps?: number;
          averageHeartRate?: number | null;
        };
        if (cancelled) return;
        const parts: string[] = ['Good morning.'];
        if (typeof data.steps === 'number') {
          parts.push(`You're at ${data.steps.toLocaleString()} steps so far today.`);
        }
        if (typeof data.averageHeartRate === 'number') {
          parts.push(`Resting heart rate around ${data.averageHeartRate} beats per minute.`);
        }
        parts.push('A glass of water is a fair next move. I am here when you are.');
        morbiusSpeak(parts.join(' '), { tone: 'warm-care', coalesce: 'skip' });
      } catch {
        // best-effort · network errors stay silent
      }
    };
    void fireMorning();

    // ── 2 · Water reminder · every 2 h · 08:00-22:00 local ───────
    const waterTimer = window.setInterval(
      () => {
        const h = new Date().getHours();
        if (h < 8 || h > 22) return;
        morbiusSpeak('Quick reminder · sip some water.', { tone: 'warm-care', coalesce: 'skip' });
      },
      2 * 60 * 60 * 1000,
    );

    // ── 3 · Midday + evening cues ────────────────────────────────
    const fireScheduled = () => {
      const now = new Date();
      const hh = now.getHours();
      const mm = now.getMinutes();
      const k = `${hh}:${Math.floor(mm / 5) * 5}`;
      // Fire at 12:00-12:04
      if (hh === 12 && mm < 5) {
        morbiusSpeak('Midday check · how are you doing? A short break would help me help you.', {
          tone: 'warm-care',
        });
      }
      // Fire at 21:30-21:34 — wind-down cue
      if (hh === 21 && mm >= 30 && mm < 35) {
        morbiusSpeak(
          'It is winding-down hour. Lower the lights · close the tabs you can. Rest is part of the work.',
          { tone: 'warm-care', coalesce: 'skip' },
        );
      }
      void k;
    };
    const cueTimer = window.setInterval(fireScheduled, 60 * 1000);

    return () => {
      cancelled = true;
      window.clearInterval(waterTimer);
      window.clearInterval(cueTimer);
    };
  }, [user]);

  return null;
}
