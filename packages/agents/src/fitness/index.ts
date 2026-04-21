/**
 * Fitness module — provider-agnostic shape that wraps Google Fit (web /
 * Android), Apple HealthKit (iOS via Capacitor — V2), and a demo
 * generator for the offline path.
 *
 * Why one shape: the Profile UI doesn't care which device synced; the
 * dashboard cards are bound to {@link FitnessSnapshot}. The provider
 * client converts.
 */

export type FitnessProvider = 'google-fit' | 'apple-health' | 'demo';

export interface StepBucket {
  startTs: number;
  endTs: number;
  steps: number;
}

export interface HrSample {
  ts: number;
  bpm: number;
}

export interface SleepSession {
  startTs: number;
  endTs: number;
  /** Total time in bed, ms. */
  durationMs: number;
  /** Optional stage-level breakdown when the source supports it. */
  stages?: { deepMs: number; lightMs: number; remMs: number; awakeMs: number };
}

export interface WorkoutSession {
  startTs: number;
  endTs: number;
  /** Free-form activity name from the source — "Running", "Yoga", … */
  activity: string;
  caloriesKcal?: number;
  distanceM?: number;
  avgHrBpm?: number;
}

export interface FitnessSnapshot {
  provider: FitnessProvider;
  /** ISO date the snapshot covers (UTC day boundaries). */
  date: string;
  /** Total steps in the day. */
  stepsTotal: number;
  /** Hourly buckets — exactly 24, oldest first. */
  stepsHourly: StepBucket[];
  /** Resting heart rate when computable, else null. */
  restingHrBpm: number | null;
  /** Most recent HR samples in the last 24h, capped at 96 (~15-min spacing). */
  recentHr: HrSample[];
  /** Last completed sleep session, if synced. */
  lastSleep: SleepSession | null;
  /** Workouts in the last 24h, newest first. */
  recentWorkouts: WorkoutSession[];
  /** Wall-clock the snapshot was assembled. */
  syncedAt: number;
}

export { GoogleFitClient, type GoogleFitClientOptions } from './google-fit.ts';
export { demoFitnessSnapshot } from './demo.ts';
export { fitnessSnapshotFromEnv } from './factory.ts';
export {
  type AppleHealthAvailability,
  type AppleHealthCapabilities,
  detectAppleHealth,
  readAppleHealthSnapshot,
} from './apple-health.ts';
