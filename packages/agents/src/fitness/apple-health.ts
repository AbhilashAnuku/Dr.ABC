/**
 * Apple HealthKit shim.
 *
 * HealthKit only exists on iOS (and inside the iPad/macOS sandbox via
 * Catalyst), so this module is intentionally a thin Capacitor-ready
 * adapter. It detects the runtime, advertises whether the real HealthKit
 * surface is reachable, and exposes the same FitnessSnapshot shape the
 * Google Fit client returns — so the Profile page and Dashboard cards
 * never branch on provider.
 *
 * Real reads land when the project gets built into a Capacitor iOS
 * shell. We use the community plugin name (`@perfood/capacitor-health-kit`)
 * since it covers the standard quantity types we need: steps, heart
 * rate, sleep analysis, workouts.
 *
 * On non-iOS runtimes (web today, Android / Tauri tomorrow) the
 * client returns null + a clear `unavailable` reason — callers should
 * fall back to GoogleFitClient or `demoFitnessSnapshot()`.
 */

import { demoFitnessSnapshot } from './demo.ts';
import type {
  FitnessSnapshot,
  HrSample,
  SleepSession,
  StepBucket,
  WorkoutSession,
} from './index.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export type AppleHealthAvailability =
  | 'no-window'
  | 'not-ios'
  | 'no-capacitor'
  | 'plugin-missing'
  | 'permission-denied'
  | 'available';

export interface AppleHealthCapabilities {
  available: boolean;
  reason: AppleHealthAvailability;
  /** Surfaced human-readable platform string for telemetry/ops. */
  platform: string;
}

interface CapacitorRuntime {
  Plugins?: { CapacitorHealthkit?: unknown; HealthKit?: unknown };
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
}

function getCapacitor(): CapacitorRuntime | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { Capacitor?: CapacitorRuntime };
  return w.Capacitor ?? null;
}

/**
 * Synchronous capability snapshot — safe to call from React on render.
 * Doesn't request permission; that happens lazily on the first
 * `snapshot()` call.
 */
export function detectAppleHealth(): AppleHealthCapabilities {
  if (typeof window === 'undefined') {
    return { available: false, reason: 'no-window', platform: 'server' };
  }
  const cap = getCapacitor();
  if (!cap) return { available: false, reason: 'no-capacitor', platform: 'web' };
  const platform = cap.getPlatform?.() ?? 'unknown';
  if (platform !== 'ios') return { available: false, reason: 'not-ios', platform };
  const plugin = cap.Plugins?.CapacitorHealthkit ?? cap.Plugins?.HealthKit;
  if (!plugin) return { available: false, reason: 'plugin-missing', platform };
  return { available: true, reason: 'available', platform };
}

interface HealthKitPluginShape {
  requestAuthorization(opts: { read: string[]; write: string[] }): Promise<{ granted: boolean }>;
  /** Steps grouped by hour. */
  queryHKitStatistics?(opts: {
    sampleType: 'stepCount';
    startDate: string;
    endDate: string;
    interval?: 'hour' | 'day';
  }): Promise<{ buckets: { startDate: string; endDate: string; value: number }[] }>;
  /** Heart-rate samples in bpm. */
  queryHKitSampleType?(opts: {
    sampleType: 'heartRate';
    startDate: string;
    endDate: string;
    limit?: number;
  }): Promise<{ samples: { startDate: string; value: number }[] }>;
  /** Sleep analysis samples. */
  queryHKitSleep?(opts: {
    startDate: string;
    endDate: string;
  }): Promise<{
    sessions: { startDate: string; endDate: string; stage: 'awake' | 'light' | 'deep' | 'rem' }[];
  }>;
  queryHKitWorkouts?(opts: {
    startDate: string;
    endDate: string;
  }): Promise<{
    workouts: {
      startDate: string;
      endDate: string;
      activityType: string;
      totalEnergyBurned?: number;
      totalDistance?: number;
      averageHeartRate?: number;
    }[];
  }>;
}

const READ_TYPES = [
  'HKQuantityTypeIdentifierStepCount',
  'HKQuantityTypeIdentifierHeartRate',
  'HKCategoryTypeIdentifierSleepAnalysis',
  'HKWorkoutTypeIdentifier',
];

/**
 * Reads an Apple-Health snapshot for the current UTC day. Returns the
 * same FitnessSnapshot shape as GoogleFitClient, so callers don't
 * branch on provider. Falls through to `demoFitnessSnapshot()` if
 * HealthKit isn't reachable — caller can detect that via
 * `provider === 'demo'`.
 */
export async function readAppleHealthSnapshot(now: number = Date.now()): Promise<FitnessSnapshot> {
  const cap = detectAppleHealth();
  if (!cap.available) return demoFitnessSnapshot(now);
  const plugin = (getCapacitor()?.Plugins?.CapacitorHealthkit ??
    getCapacitor()?.Plugins?.HealthKit) as HealthKitPluginShape | undefined;
  if (!plugin) return demoFitnessSnapshot(now);

  try {
    const auth = await plugin.requestAuthorization({ read: READ_TYPES, write: [] });
    if (!auth.granted) return demoFitnessSnapshot(now);
  } catch {
    return demoFitnessSnapshot(now);
  }

  const dayStart = startOfUtcDay(now);
  const [steps, hr, sleep, workouts] = await Promise.all([
    callOrEmpty(() =>
      plugin.queryHKitStatistics?.({
        sampleType: 'stepCount',
        startDate: new Date(dayStart).toISOString(),
        endDate: new Date(dayStart + DAY_MS).toISOString(),
        interval: 'hour',
      }),
    ),
    callOrEmpty(() =>
      plugin.queryHKitSampleType?.({
        sampleType: 'heartRate',
        startDate: new Date(now - DAY_MS).toISOString(),
        endDate: new Date(now).toISOString(),
        limit: 96,
      }),
    ),
    callOrEmpty(() =>
      plugin.queryHKitSleep?.({
        startDate: new Date(now - 2 * DAY_MS).toISOString(),
        endDate: new Date(now).toISOString(),
      }),
    ),
    callOrEmpty(() =>
      plugin.queryHKitWorkouts?.({
        startDate: new Date(now - DAY_MS).toISOString(),
        endDate: new Date(now).toISOString(),
      }),
    ),
  ]);

  const stepsHourly = parseStepBuckets(steps);
  const recentHr = parseHrSamples(hr);
  const lastSleep = parseLastSleep(sleep);
  const recentWorkouts = parseWorkouts(workouts);
  const restingHrBpm = computeRestingHr(recentHr);
  const stepsTotal = stepsHourly.reduce((s, b) => s + b.steps, 0);

  return {
    provider: 'apple-health',
    date: new Date(dayStart).toISOString().slice(0, 10),
    stepsTotal,
    stepsHourly,
    restingHrBpm,
    recentHr,
    lastSleep,
    recentWorkouts,
    syncedAt: Date.now(),
  };
}

// ============================================================
//  Pure parsers (exported for the unit tests)
// ============================================================

interface StepsResp {
  buckets?: { startDate: string; endDate: string; value: number }[];
}
interface HrResp {
  samples?: { startDate: string; value: number }[];
}
interface SleepResp {
  sessions?: { startDate: string; endDate: string; stage: 'awake' | 'light' | 'deep' | 'rem' }[];
}
interface WorkoutsResp {
  workouts?: {
    startDate: string;
    endDate: string;
    activityType: string;
    totalEnergyBurned?: number;
    totalDistance?: number;
    averageHeartRate?: number;
  }[];
}

export function parseStepBuckets(resp: StepsResp): StepBucket[] {
  return (resp.buckets ?? []).map((b) => ({
    startTs: new Date(b.startDate).getTime(),
    endTs: new Date(b.endDate).getTime(),
    steps: Math.round(b.value),
  }));
}

export function parseHrSamples(resp: HrResp): HrSample[] {
  return (resp.samples ?? []).map((s) => ({
    ts: new Date(s.startDate).getTime(),
    bpm: Math.round(s.value),
  }));
}

export function parseLastSleep(resp: SleepResp): SleepSession | null {
  const sessions = resp.sessions ?? [];
  if (sessions.length === 0) return null;
  const sorted = [...sessions].sort(
    (a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime(),
  );
  // Group contiguous-ish (≤ 60 min gap) into one sleep session, return the last group.
  const groups: (typeof sorted)[] = [];
  let current: typeof sorted = [];
  let lastEnd = Number.NEGATIVE_INFINITY;
  for (const s of sorted) {
    const start = new Date(s.startDate).getTime();
    const end = new Date(s.endDate).getTime();
    if (start - lastEnd > HOUR_MS && current.length > 0) {
      groups.push(current);
      current = [];
    }
    current.push(s);
    lastEnd = end;
  }
  if (current.length > 0) groups.push(current);
  const last = groups[groups.length - 1];
  if (!last || last.length === 0) return null;
  const startTs = new Date(last[0]?.startDate ?? '').getTime();
  const endTs = new Date(last[last.length - 1]?.endDate ?? '').getTime();
  const stages = { deepMs: 0, lightMs: 0, remMs: 0, awakeMs: 0 };
  for (const seg of last) {
    const dur = new Date(seg.endDate).getTime() - new Date(seg.startDate).getTime();
    if (seg.stage === 'deep') stages.deepMs += dur;
    else if (seg.stage === 'light') stages.lightMs += dur;
    else if (seg.stage === 'rem') stages.remMs += dur;
    else stages.awakeMs += dur;
  }
  return { startTs, endTs, durationMs: endTs - startTs, stages };
}

export function parseWorkouts(resp: WorkoutsResp): WorkoutSession[] {
  return (resp.workouts ?? [])
    .map((w) => ({
      startTs: new Date(w.startDate).getTime(),
      endTs: new Date(w.endDate).getTime(),
      activity: prettyActivity(w.activityType),
      caloriesKcal: w.totalEnergyBurned,
      distanceM: w.totalDistance,
      avgHrBpm: w.averageHeartRate,
    }))
    .sort((a, b) => b.startTs - a.startTs)
    .slice(0, 5);
}

function prettyActivity(t: string): string {
  // HK activity types look like "HKWorkoutActivityTypeRunning"; strip + Title-Case.
  return t
    .replace(/^HKWorkoutActivityType/, '')
    .replace(/([A-Z])/g, ' $1')
    .trim();
}

export function computeRestingHr(samples: HrSample[]): number | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].map((s) => s.bpm).sort((a, b) => a - b);
  const idx = Math.max(0, Math.floor(sorted.length * 0.05));
  return sorted[idx] ?? null;
}

function startOfUtcDay(ts: number): number {
  const d = new Date(ts);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

async function callOrEmpty<T>(
  call: () => Promise<T> | undefined,
): Promise<T | Record<string, unknown>> {
  try {
    const v = await call();
    return v ?? {};
  } catch {
    return {};
  }
}
