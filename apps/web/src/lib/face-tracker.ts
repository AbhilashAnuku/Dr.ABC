/**
 * Face tracker — wraps Google's MediaPipe Tasks Vision FaceLandmarker
 * to derive a normalised head-pose signal from a webcam feed:
 *
 *   - `count`     — faces detected in the frame
 *   - `headYaw`   — left/right head turn, [-1..+1]
 *   - `headPitch` — up/down head tilt, [-1..+1]
 *   - `eyeGazeHint` — 0..1 estimate that the user is looking at the camera
 *
 * The head-pose channel feeds the Mörbius avatar so when you turn your
 * head, the bot mirrors it — same surface as the cursor-tracking, but
 * driven by a face instead of a mouse.
 *
 * Privacy: 100% on-device. The MediaPipe WASM + the .task model file
 * download once (cached by the browser). Frames never leave the
 * browser. The pref is OFF by default; the camera permission prompt
 * is the user's first signal that anything is happening.
 *
 * Performance: ~10 Hz inference is plenty for a head-mirror loop. We
 * use `requestVideoFrameCallback` when available so we synchronise to
 * the actual video frame rate instead of burning cycles on rAF.
 */

import type { FaceLandmarker, FaceLandmarkerResult } from '@mediapipe/tasks-vision';

const WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

export interface FaceFrame {
  count: number;
  /** -1 .. +1 — left to right head turn. */
  headYaw: number;
  /** -1 .. +1 — down to up head tilt. */
  headPitch: number;
  /** 0..1 — best-guess that the user is looking at the camera. */
  eyeGazeHint: number;
  ts: number;
}

export type FaceFrameListener = (frame: FaceFrame) => void;

export interface FaceTrackerHandle {
  stop(): void;
}

export interface StartFaceTrackerOpts {
  /** Maximum inferences per second. Defaults to 10. */
  fps?: number;
  /** Maximum faces to detect. Defaults to 2 (count is most we care about). */
  maxFaces?: number;
  /** Fired when the FaceLandmarker has loaded + first frame is being inferred. */
  onReady?: () => void;
  /** Fired when the model fails to load (offline, blocked CDN, no WebGL, …). */
  onError?: (err: unknown) => void;
}

let landmarkerSingleton: FaceLandmarker | null = null;
let landmarkerLoading: Promise<FaceLandmarker | null> | null = null;

async function loadLandmarker(
  maxFaces: number,
  onError?: (err: unknown) => void,
): Promise<FaceLandmarker | null> {
  if (landmarkerSingleton) return landmarkerSingleton;
  if (landmarkerLoading) return landmarkerLoading;
  landmarkerLoading = (async () => {
    try {
      const tasks = await import('@mediapipe/tasks-vision');
      const fileset = await tasks.FilesetResolver.forVisionTasks(WASM_BASE);
      // GPU first (best perf); fall back to CPU if WebGL/WASM-SIMD blocks
      // GPU init — Safari + some Linux/Windows configs need this.
      let lm: FaceLandmarker;
      try {
        lm = await tasks.FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
          runningMode: 'VIDEO',
          numFaces: maxFaces,
          outputFaceBlendshapes: false,
          outputFacialTransformationMatrixes: false,
        });
      } catch (gpuErr) {
        console.warn('[face-tracker] GPU delegate failed, retrying on CPU:', gpuErr);
        lm = await tasks.FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' },
          runningMode: 'VIDEO',
          numFaces: maxFaces,
          outputFaceBlendshapes: false,
          outputFacialTransformationMatrixes: false,
        });
      }
      landmarkerSingleton = lm;
      return lm;
    } catch (err) {
      console.error('[face-tracker] Failed to load MediaPipe FaceLandmarker:', err);
      onError?.(err);
      return null;
    } finally {
      landmarkerLoading = null;
    }
  })();
  return landmarkerLoading;
}

export function startFaceTracker(
  videoEl: HTMLVideoElement,
  listener: FaceFrameListener,
  opts: StartFaceTrackerOpts = {},
): FaceTrackerHandle {
  let stopped = false;
  let lastInferenceTs = 0;
  const minIntervalMs = 1000 / (opts.fps ?? 10);

  type RvfcVideo = HTMLVideoElement & {
    requestVideoFrameCallback?: (cb: (now: number) => void) => number;
    cancelVideoFrameCallback?: (id: number) => void;
  };
  const rvfcVideo = videoEl as RvfcVideo;
  let rvfcId: number | null = null;
  let rafId: number | null = null;

  void loadLandmarker(opts.maxFaces ?? 2, opts.onError).then((lm) => {
    if (!lm) {
      opts.onError?.(new Error('FaceLandmarker unavailable'));
      return;
    }
    if (stopped) return;

    let firstFrameSent = false;
    let badFrameWarned = false;
    const tick = (now: number) => {
      if (stopped) return;
      if (now - lastInferenceTs >= minIntervalMs && videoEl.readyState >= 2) {
        lastInferenceTs = now;
        try {
          const result = lm.detectForVideo(videoEl, performance.now());
          listener(toFrame(result));
          if (!firstFrameSent) {
            firstFrameSent = true;
            opts.onReady?.();
          }
        } catch (err) {
          // A single bad frame should never kill the loop; warn ONCE so
          // the operator can see what's wrong without flooding the console.
          if (!badFrameWarned) {
            badFrameWarned = true;
            console.warn('[face-tracker] detectForVideo threw on first frame:', err);
          }
        }
      }
      schedule();
    };
    const schedule = () => {
      if (stopped) return;
      if (rvfcVideo.requestVideoFrameCallback) {
        rvfcId = rvfcVideo.requestVideoFrameCallback((t) => tick(t));
      } else {
        rafId = requestAnimationFrame((t) => tick(t));
      }
    };
    schedule();
  });

  return {
    stop() {
      stopped = true;
      if (rvfcId !== null && rvfcVideo.cancelVideoFrameCallback) {
        rvfcVideo.cancelVideoFrameCallback(rvfcId);
      }
      if (rafId !== null) cancelAnimationFrame(rafId);
    },
  };
}

/**
 * Convert a MediaPipe result into our small FaceFrame shape. Pure —
 * exported so tests can pin the math without spinning up a camera.
 *
 * Yaw is derived from the asymmetry between the left and right ear
 * positions relative to the nose tip. Pitch is the vertical offset
 * of the nose from the eye-line. Both are normalised to [-1, +1] via
 * tunable scalars chosen by hand so a comfortable head turn (~25°)
 * lands at ±0.6 — past that we clamp.
 *
 * We DON'T use the full Procrustes head-pose math because (a) it's
 * massively more expensive, and (b) for an avatar mirror the cheap
 * landmark-ratio version feels just as alive.
 */
export function toFrame(result: FaceLandmarkerResult): FaceFrame {
  const count = result.faceLandmarks?.length ?? 0;
  if (count === 0) return { count: 0, headYaw: 0, headPitch: 0, eyeGazeHint: 0, ts: Date.now() };

  const lm = result.faceLandmarks[0];
  if (!lm || lm.length < 478) {
    return { count, headYaw: 0, headPitch: 0, eyeGazeHint: 0, ts: Date.now() };
  }

  const noseTip = lm[1];
  const leftEar = lm[234];
  const rightEar = lm[454];
  const leftEye = lm[33];
  const rightEye = lm[263];
  if (!noseTip || !leftEar || !rightEar || !leftEye || !rightEye) {
    return { count, headYaw: 0, headPitch: 0, eyeGazeHint: 0, ts: Date.now() };
  }

  // Yaw: nose deviation from the midpoint between the two ears,
  // normalised by ear-to-ear distance. +1 means nose far to the
  // mediapipe-x direction (which is the user's right when the camera
  // is mirror-flipped — we negate so the avatar mirrors the user's
  // left when they turn left).
  const earMid = (leftEar.x + rightEar.x) / 2;
  const earSpan = Math.abs(rightEar.x - leftEar.x) || 0.001;
  const yawRaw = (noseTip.x - earMid) / earSpan;
  const headYaw = clamp(-yawRaw / 0.4, -1, 1);

  // Pitch: nose-y vs eye-line-y, normalised by inter-eye distance.
  const eyeMidY = (leftEye.y + rightEye.y) / 2;
  const eyeSpan = Math.abs(rightEye.x - leftEye.x) || 0.001;
  const pitchRaw = (eyeMidY - noseTip.y) / eyeSpan;
  // pitchRaw is small at neutral; positive when chin tucks down.
  const headPitch = clamp(-(pitchRaw - 0.7) / 0.3, -1, 1);

  // Iris ring landmarks (468–477 on the augmented topology) — when the
  // iris centre is close to the eye-socket centre on both eyes, the
  // user is looking near the camera.
  const leftIris = average(lm.slice(468, 473));
  const rightIris = average(lm.slice(473, 478));
  const leftEyeC = average(
    [lm[33], lm[133], lm[159], lm[145]].filter(Boolean) as { x: number; y: number }[],
  );
  const rightEyeC = average(
    [lm[362], lm[263], lm[386], lm[374]].filter(Boolean) as { x: number; y: number }[],
  );
  const dist = (distance(leftIris, leftEyeC) + distance(rightIris, rightEyeC)) / 2;
  const eyeGazeHint = clamp(1 - dist / 0.06, 0, 1);

  return { count, headYaw, headPitch, eyeGazeHint, ts: Date.now() };
}

// ---- pure helpers (exported for tests) ----

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function average(points: { x: number; y: number }[]): { x: number; y: number } {
  if (points.length === 0) return { x: 0, y: 0 };
  let sx = 0;
  let sy = 0;
  for (const p of points) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / points.length, y: sy / points.length };
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}
