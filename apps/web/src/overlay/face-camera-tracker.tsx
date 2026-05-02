import { Camera, CameraOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  clearFacePose,
  readFaceMirrorPref,
  writeFaceMirrorPref,
  writeFacePose,
} from '../lib/face-pose.ts';
import { startFaceTracker } from '../lib/face-tracker.ts';

/**
 * Stage-8 face-mirror — the lightweight global overlay that:
 *   - watches the `dr-abc:face-mirror` pref,
 *   - when ON, requests `getUserMedia({ video: true })` and pipes the
 *     stream into a tiny hidden <video>,
 *   - runs MediaPipe FaceLandmarker on every frame (10 Hz) and writes
 *     the derived head-pose into the module-global pose ref,
 *   - the Mörbius avatar reads that ref and mirrors the user's head.
 *
 * UI is intentionally minimal: a single floating chip in the top-right
 * corner that shows the current state (`mirroring N face`, `requesting
 * camera`, `permission denied`, etc.) and lets the user kill the
 * camera with one tap. No frames are uploaded, ever.
 */
export function FaceCameraTracker() {
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState<
    'idle' | 'requesting' | 'tracking' | 'denied' | 'unavailable'
  >('idle');
  const [faceCount, setFaceCount] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Read the pref + listen for cross-tab / settings-page changes.
  useEffect(() => {
    setEnabled(readFaceMirrorPref());
    const onStorage = (ev: StorageEvent) => {
      if (ev.key === 'dr-abc:face-mirror') setEnabled(readFaceMirrorPref());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Camera + tracker lifecycle.
  useEffect(() => {
    if (!enabled) {
      // Tear down on disable.
      for (const track of streamRef.current?.getTracks() ?? []) track.stop();
      streamRef.current = null;
      clearFacePose();
      setStatus('idle');
      setFaceCount(0);
      return;
    }

    let cancelled = false;
    let trackerHandle: { stop(): void } | null = null;

    setStatus('requesting');
    void (async () => {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        setStatus('unavailable');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 320, height: 240, facingMode: 'user' },
          audio: false,
        });
        if (cancelled) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play().catch(() => {
          /* autoplay sometimes rejects in iframes — ignore */
        });
        setStatus('tracking');

        trackerHandle = startFaceTracker(
          video,
          (frame) => {
            writeFacePose(frame.headYaw, frame.headPitch, frame.count);
            setFaceCount(frame.count);
          },
          { fps: 10 },
        );
      } catch {
        setStatus('denied');
      }
    })();

    return () => {
      cancelled = true;
      trackerHandle?.stop();
      for (const track of streamRef.current?.getTracks() ?? []) track.stop();
      streamRef.current = null;
      clearFacePose();
    };
  }, [enabled]);

  return (
    <>
      {/* Hidden but real <video> — MediaPipe needs a real DOM video. */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        aria-hidden
        className="pointer-events-none fixed -left-[9999px] top-0 h-1 w-1 opacity-0"
      />

      {enabled && (
        <button
          type="button"
          onClick={() => {
            writeFaceMirrorPref(false);
            setEnabled(false);
          }}
          className="fixed top-4 right-4 z-50 inline-flex items-center gap-2 rounded-full border border-quantum-400/40 bg-ink-950/80 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-quantum-300 backdrop-blur-md transition-colors hover:border-rose-400/60 hover:text-rose-300"
          aria-label="Stop face mirror"
        >
          {status === 'tracking' ? (
            <>
              <Camera className="h-3 w-3" />
              mirror · {faceCount} face{faceCount === 1 ? '' : 's'} · on-device
              <CameraOff className="ml-2 h-3 w-3 opacity-60" />
            </>
          ) : status === 'requesting' ? (
            <>
              <Camera className="h-3 w-3 animate-pulse" />
              requesting camera…
            </>
          ) : status === 'denied' ? (
            <>
              <CameraOff className="h-3 w-3 text-rose-300" />
              camera denied · settings → privacy
            </>
          ) : status === 'unavailable' ? (
            <>
              <CameraOff className="h-3 w-3 text-rose-300" />
              no camera api on this device
            </>
          ) : (
            <>
              <Camera className="h-3 w-3" />
              starting…
            </>
          )}
        </button>
      )}
    </>
  );
}
