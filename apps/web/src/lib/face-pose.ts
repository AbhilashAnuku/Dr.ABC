/**
 * Module-global face-pose ref + the user's "mirror my head" preference.
 *
 * The face tracker writes to this ref ~10 Hz; the Mörbius avatar
 * (`overlay/morbius-face.tsx`) reads it every frame inside its
 * `useFrame` callback. Decoupled this way so:
 *   - the tracker can mount in any overlay component without prop-
 *     drilling through the React tree,
 *   - the avatar treats the face signal as a drop-in replacement for
 *     the cursor signal — same `{ x, y }` in [-1, 1] coords,
 *   - if the tracker freezes, the avatar falls back to the cursor
 *     after `STALE_AFTER_MS` (250ms feels live; longer feels jumpy).
 *
 * Privacy: the values are normalised landmark coordinates only. No
 * frame, no embedding, no identifier ever leaves this module.
 */

const PREF_KEY = 'dr-abc:face-mirror';
const STALE_AFTER_MS = 250;

interface FacePose {
  x: number; // -1 (left) .. +1 (right) — head yaw, normalised
  y: number; // -1 (down)  .. +1 (up)    — head pitch, normalised
  count: number; // faces in frame
  ts: number; // wall-clock of last update
}

const pose: FacePose = { x: 0, y: 0, count: 0, ts: 0 };

export function readFacePose(): { x: number; y: number; count: number; fresh: boolean } {
  const fresh = pose.ts !== 0 && Date.now() - pose.ts < STALE_AFTER_MS;
  return { x: pose.x, y: pose.y, count: pose.count, fresh };
}

export function writeFacePose(x: number, y: number, count: number) {
  pose.x = x;
  pose.y = y;
  pose.count = count;
  pose.ts = Date.now();
}

export function clearFacePose() {
  pose.x = 0;
  pose.y = 0;
  pose.count = 0;
  pose.ts = 0;
}

// ============================================================
//  User preference — Settings → Appearance toggle
// ============================================================

export function readFaceMirrorPref(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(PREF_KEY) === 'on';
}

export function writeFaceMirrorPref(on: boolean) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(PREF_KEY, on ? 'on' : 'off');
  // Synthesise a storage event so other components (the camera
  // mounter, the avatar) re-read without a polling loop.
  window.dispatchEvent(new StorageEvent('storage', { key: PREF_KEY, newValue: on ? 'on' : 'off' }));
}
