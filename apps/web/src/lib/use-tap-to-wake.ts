import { useEffect, useRef } from 'react';

/**
 * Tap-to-wake — opens Mörbius when the user pats the laptop.
 *
 * Two signals, OR'd together:
 *   1. DeviceMotionEvent — accelerometer impulse > THRESHOLD_G (most
 *      mobile + many laptops with motion sensors).
 *   2. Microphone amplitude — short loud transient picked up by an
 *      AnalyserNode (works on any device with a mic).
 *
 * The mic stream is opened only when the user enables this feature in
 * Settings → Wake on tap (so we never request mic permission silently).
 * Uses a 250 ms cooldown so a single pat fires once, not 30 times.
 *
 * Implementation note: we deliberately use BOTH signals — accelerometer
 * because it's the obvious one and free of permission cost; microphone
 * because most desktops don't expose accelerometer at all.
 */

const LS_KEY = 'dr-abc:tap-to-wake';
const ACCEL_THRESHOLD_G = 1.4; // a firm pat reads ~1.6–2.5g delta-from-rest
const MIC_RMS_THRESHOLD = 0.35; // 0..1 normalised RMS — a "tap" peaks here briefly
const COOLDOWN_MS = 250;

export function readTapToWakeEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(LS_KEY) === '1';
}

export function writeTapToWakeEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  if (enabled) window.localStorage.setItem(LS_KEY, '1');
  else window.localStorage.removeItem(LS_KEY);
}

interface Options {
  enabled: boolean;
  onTap: () => void;
}

export function useTapToWake({ enabled, onTap }: Options): { micActive: boolean } {
  const micActiveRef = useRef(false);
  const lastFireRef = useRef(0);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    const fire = () => {
      const now = performance.now();
      if (now - lastFireRef.current < COOLDOWN_MS) return;
      lastFireRef.current = now;
      onTap();
    };

    // ---- 1. DeviceMotion (accelerometer) ----
    const onMotion = (e: DeviceMotionEvent) => {
      const a = e.accelerationIncludingGravity;
      if (!a) return;
      // Magnitude minus 1g rest baseline; pats register as a sharp spike.
      const mag = Math.hypot(a.x ?? 0, a.y ?? 0, a.z ?? 0);
      const delta = Math.abs(mag - 9.81) / 9.81;
      if (delta > ACCEL_THRESHOLD_G) fire();
    };
    window.addEventListener('devicemotion', onMotion, { passive: true });

    // ---- 2. Microphone amplitude ----
    let stream: MediaStream | undefined;
    let audioCtx: AudioContext | undefined;
    let rafId = 0;
    let stopped = false;

    const startMic = async () => {
      if (!navigator.mediaDevices?.getUserMedia) return;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        });
        if (stopped) {
          for (const t of stream.getTracks()) t.stop();
          return;
        }
        const AC =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        audioCtx = new AC();
        const src = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 1024;
        const buf = new Uint8Array(analyser.fftSize);
        src.connect(analyser);
        micActiveRef.current = true;

        const tick = () => {
          if (stopped) return;
          analyser.getByteTimeDomainData(buf);
          // RMS of the signal centered at 128
          let sum = 0;
          for (let i = 0; i < buf.length; i++) {
            const v = ((buf[i] ?? 128) - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / buf.length);
          if (rms > MIC_RMS_THRESHOLD) fire();
          rafId = requestAnimationFrame(tick);
        };
        rafId = requestAnimationFrame(tick);
      } catch {
        // user denied or no mic — silent fallback to accelerometer-only
        micActiveRef.current = false;
      }
    };

    void startMic();

    return () => {
      stopped = true;
      micActiveRef.current = false;
      window.removeEventListener('devicemotion', onMotion);
      cancelAnimationFrame(rafId);
      if (stream) for (const t of stream.getTracks()) t.stop();
      void audioCtx?.close().catch(() => undefined);
    };
  }, [enabled, onTap]);

  return { micActive: micActiveRef.current };
}
