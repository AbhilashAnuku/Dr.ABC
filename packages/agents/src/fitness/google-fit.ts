import type {
  FitnessSnapshot,
  HrSample,
  SleepSession,
  StepBucket,
  WorkoutSession,
} from './index.ts';

/**
 * Google Fit REST client.
 *
 * Talks to https://www.googleapis.com/fitness/v1 — the public Fit
 * REST API. Uses {@link
 * https://developers.google.com/fit/rest/v1/data-types | aggregate
 * data sources}: `derived:com.google.step_count.delta`,
 * `derived:com.google.heart_rate.bpm`,
 * `derived:com.google.sleep.segment`, `derived:com.google.activity.segment`.
 *
 * Auth: pass an OAuth2 access token with the
 * `https://www.googleapis.com/auth/fitness.activity.read` +
 * `.heart_rate.read` + `.sleep.read` scopes. Web flow: the user grants
 * via Google's OAuth consent in the browser; the token round-trips as
 * `Authorization: Bearer …`. We never store it server-side beyond the
 * request lifetime.
 */

const FIT_BASE = 'https://www.googleapis.com/fitness/v1';
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export interface GoogleFitClientOptions {
  /** OAuth2 access token (NOT a refresh token). */
  token: string;
  /** Override base URL — useful for tests + emulators. */
  baseUrl?: string;
  /** Per-request timeout, default 15s. */
  timeoutMs?: number;
}

interface AggregateResponse {
  bucket: Array<{
    startTimeMillis: string;
    endTimeMillis: string;
    dataset: Array<{
      dataSourceId: string;
      point: Array<{
        startTimeNanos: string;
        endTimeNanos: string;
        dataTypeName: string;
        value: Array<{ intVal?: number; fpVal?: number; stringVal?: string }>;
      }>;
    }>;
  }>;
}

export class GoogleFitClient {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(opts: GoogleFitClientOptions) {
    this.token = opts.token;
    this.baseUrl = (opts.baseUrl ?? FIT_BASE).replace(/\/$/, '');
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  /**
   * Fetches a full {@link FitnessSnapshot} for the current UTC day.
   * Fans out four aggregate calls in parallel — Google Fit allows up
   * to 60 req/s per token, this is well under quota.
   */
  async snapshot(now: number = Date.now()): Promise<FitnessSnapshot> {
    const dayStart = startOfUtcDay(now);
    const [steps, hr, sleep, workouts] = await Promise.all([
      this.aggregate({
        dataTypeName: 'com.google.step_count.delta',
        startMs: dayStart,
        endMs: dayStart + DAY_MS,
        bucketMs: HOUR_MS,
      }),
      this.aggregate({
        dataTypeName: 'com.google.heart_rate.bpm',
        startMs: now - DAY_MS,
        endMs: now,
        bucketMs: 15 * 60 * 1000,
      }),
      this.aggregate({
        dataTypeName: 'com.google.sleep.segment',
        startMs: now - 2 * DAY_MS,
        endMs: now,
        bucketMs: DAY_MS,
      }),
      this.aggregate({
        dataTypeName: 'com.google.activity.segment',
        startMs: now - DAY_MS,
        endMs: now,
        bucketMs: HOUR_MS,
      }),
    ]);

    const stepsHourly = parseStepBuckets(steps);
    const recentHr = parseHrSamples(hr);
    const lastSleep = parseLastSleep(sleep);
    const recentWorkouts = parseWorkouts(workouts);

    const restingHrBpm = computeRestingHr(recentHr);
    const stepsTotal = stepsHourly.reduce((s, b) => s + b.steps, 0);

    return {
      provider: 'google-fit',
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

  private async aggregate(opts: {
    dataTypeName: string;
    startMs: number;
    endMs: number;
    bucketMs: number;
  }): Promise<AggregateResponse> {
    const body = {
      aggregateBy: [{ dataTypeName: opts.dataTypeName }],
      bucketByTime: { durationMillis: opts.bucketMs },
      startTimeMillis: opts.startMs,
      endTimeMillis: opts.endMs,
    };
    const res = await fetch(`${this.baseUrl}/users/me/dataset:aggregate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(
        `google-fit ${res.status} ${res.statusText} on ${opts.dataTypeName}: ${detail.slice(0, 200)}`,
      );
    }
    return (await res.json()) as AggregateResponse;
  }
}

// ---- pure parsers, all exported for testability ----

export function parseStepBuckets(resp: AggregateResponse): StepBucket[] {
  return resp.bucket.map((b) => {
    const steps = b.dataset
      .flatMap((ds) => ds.point.flatMap((p) => p.value.map((v) => v.intVal ?? 0)))
      .reduce((s, n) => s + n, 0);
    return {
      startTs: Number(b.startTimeMillis),
      endTs: Number(b.endTimeMillis),
      steps,
    };
  });
}

export function parseHrSamples(resp: AggregateResponse): HrSample[] {
  const out: HrSample[] = [];
  for (const b of resp.bucket) {
    for (const ds of b.dataset) {
      for (const p of ds.point) {
        const bpm = p.value.find((v) => typeof v.fpVal === 'number')?.fpVal;
        if (bpm !== undefined) {
          out.push({
            ts: Math.round(Number(p.startTimeNanos) / 1_000_000),
            bpm: Math.round(bpm),
          });
        }
      }
    }
  }
  return out;
}

export function parseLastSleep(resp: AggregateResponse): SleepSession | null {
  const segments: { startTs: number; endTs: number; stage: number }[] = [];
  for (const b of resp.bucket) {
    for (const ds of b.dataset) {
      for (const p of ds.point) {
        const stage = p.value.find((v) => typeof v.intVal === 'number')?.intVal ?? 0;
        segments.push({
          startTs: Math.round(Number(p.startTimeNanos) / 1_000_000),
          endTs: Math.round(Number(p.endTimeNanos) / 1_000_000),
          stage,
        });
      }
    }
  }
  if (segments.length === 0) return null;
  segments.sort((a, b) => a.startTs - b.startTs);
  // Group contiguous-ish segments (≤ 60min gap) into a single session;
  // return the most recent group as `lastSleep`.
  const groups: (typeof segments)[] = [];
  let current: typeof segments = [];
  let lastEnd = Number.NEGATIVE_INFINITY;
  for (const seg of segments) {
    if (seg.startTs - lastEnd > 60 * 60 * 1000 && current.length > 0) {
      groups.push(current);
      current = [];
    }
    current.push(seg);
    lastEnd = seg.endTs;
  }
  if (current.length > 0) groups.push(current);
  const last = groups[groups.length - 1];
  if (!last || last.length === 0) return null;
  const startTs = last[0]?.startTs ?? 0;
  const endTs = last[last.length - 1]?.endTs ?? startTs;
  // Google Fit sleep stage codes: 1=awake, 4=light, 5=deep, 6=rem (others ignored).
  const stages = { deepMs: 0, lightMs: 0, remMs: 0, awakeMs: 0 };
  for (const seg of last) {
    const dur = seg.endTs - seg.startTs;
    if (seg.stage === 5) stages.deepMs += dur;
    else if (seg.stage === 4) stages.lightMs += dur;
    else if (seg.stage === 6) stages.remMs += dur;
    else if (seg.stage === 1) stages.awakeMs += dur;
  }
  return {
    startTs,
    endTs,
    durationMs: endTs - startTs,
    stages,
  };
}

const ACTIVITY_NAME: Record<number, string> = {
  // Google Fit activity type → display name (subset; full list is huge).
  7: 'Walking',
  8: 'Running',
  1: 'Cycling',
  72: 'Sleep',
  82: 'Swimming',
  16: 'Elliptical',
  3: 'Weight training',
  82001: 'Open water swim',
  113: 'Crossfit',
};

export function parseWorkouts(resp: AggregateResponse): WorkoutSession[] {
  const out: WorkoutSession[] = [];
  for (const b of resp.bucket) {
    for (const ds of b.dataset) {
      for (const p of ds.point) {
        const code = p.value.find((v) => typeof v.intVal === 'number')?.intVal ?? -1;
        if (code === 7 || code === 72 || code === -1) continue; // skip walking/sleep — those have own sources
        const startTs = Math.round(Number(p.startTimeNanos) / 1_000_000);
        const endTs = Math.round(Number(p.endTimeNanos) / 1_000_000);
        if (endTs - startTs < 5 * 60 * 1000) continue; // skip < 5min noise
        out.push({
          startTs,
          endTs,
          activity: ACTIVITY_NAME[code] ?? `Activity #${code}`,
        });
      }
    }
  }
  return out.sort((a, b) => b.startTs - a.startTs).slice(0, 5);
}

export function computeRestingHr(samples: HrSample[]): number | null {
  if (samples.length === 0) return null;
  // Resting HR ≈ 5th-percentile of the day's samples — simple, robust,
  // matches what Fit/Apple show in their UIs.
  const sorted = [...samples].map((s) => s.bpm).sort((a, b) => a - b);
  const idx = Math.max(0, Math.floor(sorted.length * 0.05));
  return sorted[idx] ?? null;
}

function startOfUtcDay(ts: number): number {
  const d = new Date(ts);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}
