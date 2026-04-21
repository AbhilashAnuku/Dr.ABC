import type {
  FitnessSnapshot,
  HrSample,
  SleepSession,
  StepBucket,
  WorkoutSession,
} from './index.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/**
 * Deterministic demo data so the Profile UI looks alive even when no
 * Google Fit / HealthKit token is configured. Seeded from the day so
 * the same date always renders identically — no flicker on remount.
 */
export function demoFitnessSnapshot(now: number = Date.now()): FitnessSnapshot {
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  const dayStart = today.getTime();
  const seed = today.getUTCDate() + today.getUTCMonth() * 31;
  const rng = mulberry32(seed);

  const stepsHourly: StepBucket[] = [];
  let stepsTotal = 0;
  for (let h = 0; h < 24; h++) {
    // Sleep hours mostly idle, daytime walking, evening peak.
    const baseline =
      h < 6 ? 5 : h < 9 ? 350 : h < 12 ? 600 : h < 14 ? 900 : h < 18 ? 700 : h < 22 ? 450 : 80;
    const noise = Math.round(baseline * (0.7 + rng() * 0.6));
    stepsHourly.push({
      startTs: dayStart + h * HOUR_MS,
      endTs: dayStart + (h + 1) * HOUR_MS,
      steps: noise,
    });
    stepsTotal += noise;
  }

  const recentHr: HrSample[] = [];
  for (let i = 95; i >= 0; i--) {
    const ts = now - i * (15 * 60 * 1000);
    const hour = new Date(ts).getUTCHours();
    const restBaseline = 64 + Math.round(rng() * 4);
    const dayBoost = hour >= 7 && hour <= 22 ? 18 + Math.round(rng() * 12) : 4;
    recentHr.push({ ts, bpm: restBaseline + dayBoost });
  }

  const restingHrBpm =
    recentHr
      .filter((s) => {
        const h = new Date(s.ts).getUTCHours();
        return h < 6 || h > 23;
      })
      .reduce((acc, s, _i, arr) => acc + s.bpm / arr.length, 0) || null;

  const lastSleep: SleepSession = {
    startTs: dayStart - 2 * HOUR_MS, // ~22:00 yesterday
    endTs: dayStart + 6 * HOUR_MS, // ~06:00 today
    durationMs: 8 * HOUR_MS,
    stages: {
      deepMs: 95 * 60 * 1000,
      lightMs: 4 * HOUR_MS,
      remMs: 90 * 60 * 1000,
      awakeMs: 25 * 60 * 1000,
    },
  };

  const recentWorkouts: WorkoutSession[] = [
    {
      startTs: now - 3 * HOUR_MS,
      endTs: now - 3 * HOUR_MS + 32 * 60 * 1000,
      activity: 'Outdoor run',
      caloriesKcal: 312,
      distanceM: 5200,
      avgHrBpm: 152,
    },
  ];

  return {
    provider: 'demo',
    date: today.toISOString().slice(0, 10),
    stepsTotal,
    stepsHourly,
    restingHrBpm: restingHrBpm ? Math.round(restingHrBpm) : null,
    recentHr,
    lastSleep,
    recentWorkouts,
    syncedAt: now,
  };
}

// Tiny seeded PRNG so the snapshot is stable per day.
function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
