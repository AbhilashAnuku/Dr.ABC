import { describe, expect, it } from 'bun:test';
import { clearFacePose, readFacePose, writeFacePose } from './face-pose.ts';
import { clamp, toFrame } from './face-tracker.ts';

describe('clamp', () => {
  it('clips below + above the bounds', () => {
    expect(clamp(-2, -1, 1)).toBe(-1);
    expect(clamp(2, -1, 1)).toBe(1);
    expect(clamp(0.3, -1, 1)).toBe(0.3);
  });
});

describe('toFrame', () => {
  it('returns zeros when no faces detected', () => {
    const r = toFrame({ faceLandmarks: [] } as never);
    expect(r.count).toBe(0);
    expect(r.headYaw).toBe(0);
    expect(r.headPitch).toBe(0);
    expect(r.eyeGazeHint).toBe(0);
  });

  it('returns zeros when the landmark count is below 478', () => {
    const r = toFrame({
      faceLandmarks: [[{ x: 0, y: 0 }]],
    } as never);
    expect(r.count).toBe(1);
    expect(r.headYaw).toBe(0);
    expect(r.headPitch).toBe(0);
  });

  it('emits a positive yaw when the nose is offset toward one ear', () => {
    // Build a synthetic 478-landmark array. We only need the indices
    // toFrame() reads (1, 33, 133, 145, 159, 234, 263, 362, 374, 386,
    // 454, 468..477) to be sane.
    const lm = makeLandmarks();
    // Push the nose to the right (toward leftEar in MP coords is x=0.2,
    // rightEar is x=0.8). nose.x = 0.7 → far right.
    lm[1] = { x: 0.7, y: 0.5 };
    lm[234] = { x: 0.2, y: 0.5 }; // leftEar (MP labels are anatomical)
    lm[454] = { x: 0.8, y: 0.5 }; // rightEar
    const r = toFrame({ faceLandmarks: [lm] } as never);
    expect(r.count).toBe(1);
    expect(r.headYaw).toBeLessThan(0); // sign is mirrored to feel natural
    expect(Math.abs(r.headYaw)).toBeGreaterThan(0.3);
  });

  it('emits a near-zero yaw at the neutral pose', () => {
    const lm = makeLandmarks();
    lm[1] = { x: 0.5, y: 0.5 };
    lm[234] = { x: 0.2, y: 0.5 };
    lm[454] = { x: 0.8, y: 0.5 };
    const r = toFrame({ faceLandmarks: [lm] } as never);
    expect(Math.abs(r.headYaw)).toBeLessThan(0.05);
  });
});

describe('face-pose ref', () => {
  it('round-trips the most recent pose with a freshness gate', () => {
    clearFacePose();
    expect(readFacePose().fresh).toBe(false);
    writeFacePose(0.4, -0.2, 1);
    const r = readFacePose();
    expect(r.x).toBe(0.4);
    expect(r.y).toBe(-0.2);
    expect(r.count).toBe(1);
    expect(r.fresh).toBe(true);
  });

  it('clears back to a stale-zero state on clearFacePose', () => {
    writeFacePose(0.7, 0.1, 1);
    clearFacePose();
    const r = readFacePose();
    expect(r.fresh).toBe(false);
    expect(r.count).toBe(0);
  });
});

function makeLandmarks(): { x: number; y: number; z?: number }[] {
  return Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
}
