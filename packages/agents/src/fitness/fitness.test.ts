import { describe, expect, mock, test } from 'bun:test';
import { demoFitnessSnapshot } from './demo.ts';
import { fitnessSnapshotFromEnv } from './factory.ts';
import {
  GoogleFitClient,
  computeRestingHr,
  parseHrSamples,
  parseLastSleep,
  parseStepBuckets,
  parseWorkouts,
} from './google-fit.ts';

describe('demoFitnessSnapshot', () => {
  test('produces 24 hourly buckets summing to stepsTotal', () => {
    const snap = demoFitnessSnapshot(Date.UTC(2026, 4, 1, 12));
    expect(snap.stepsHourly.length).toBe(24);
    const sum = snap.stepsHourly.reduce((s, b) => s + b.steps, 0);
    expect(sum).toBe(snap.stepsTotal);
    expect(snap.stepsTotal).toBeGreaterThan(0);
  });

  test('is deterministic per UTC day', () => {
    const a = demoFitnessSnapshot(Date.UTC(2026, 5, 15, 10));
    const b = demoFitnessSnapshot(Date.UTC(2026, 5, 15, 22));
    expect(a.stepsTotal).toBe(b.stepsTotal);
    expect(a.stepsHourly[0]?.steps).toBe(b.stepsHourly[0]?.steps);
  });

  test('different days produce different snapshots', () => {
    const a = demoFitnessSnapshot(Date.UTC(2026, 5, 15, 10));
    const b = demoFitnessSnapshot(Date.UTC(2026, 5, 16, 10));
    expect(a.stepsTotal).not.toBe(b.stepsTotal);
  });

  test('lastSleep has stage breakdown', () => {
    const snap = demoFitnessSnapshot(Date.UTC(2026, 5, 15, 10));
    expect(snap.lastSleep).not.toBeNull();
    expect(snap.lastSleep?.stages?.deepMs).toBeGreaterThan(0);
    expect(snap.lastSleep?.stages?.remMs).toBeGreaterThan(0);
  });

  test('provider field is "demo"', () => {
    const snap = demoFitnessSnapshot();
    expect(snap.provider).toBe('demo');
  });
});

describe('parseStepBuckets', () => {
  test('sums intVal across all points in a bucket', () => {
    const out = parseStepBuckets({
      bucket: [
        {
          startTimeMillis: '1000',
          endTimeMillis: '2000',
          dataset: [
            {
              dataSourceId: 'derived:com.google.step_count.delta',
              point: [
                {
                  startTimeNanos: '1',
                  endTimeNanos: '2',
                  dataTypeName: 'x',
                  value: [{ intVal: 50 }],
                },
                {
                  startTimeNanos: '2',
                  endTimeNanos: '3',
                  dataTypeName: 'x',
                  value: [{ intVal: 75 }],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(out).toEqual([{ startTs: 1000, endTs: 2000, steps: 125 }]);
  });

  test('returns empty bucket array as zero-step list', () => {
    expect(parseStepBuckets({ bucket: [] })).toEqual([]);
  });
});

describe('parseHrSamples', () => {
  test('extracts fpVal and converts nanos to ms', () => {
    const out = parseHrSamples({
      bucket: [
        {
          startTimeMillis: '0',
          endTimeMillis: '1',
          dataset: [
            {
              dataSourceId: 'x',
              point: [
                {
                  startTimeNanos: '1700000000000000000', // 1.7e18 ns = 1.7e9 ms
                  endTimeNanos: '1700000001000000000',
                  dataTypeName: 'x',
                  value: [{ fpVal: 72.4 }],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(out).toEqual([{ ts: 1700000000000, bpm: 72 }]);
  });
});

describe('parseLastSleep', () => {
  test('groups contiguous segments and returns the latest group', () => {
    const HOUR = 60 * 60 * 1000;
    const yesterday22 = Date.UTC(2026, 5, 14, 22);
    const today6 = Date.UTC(2026, 5, 15, 6);
    const result = parseLastSleep({
      bucket: [
        {
          startTimeMillis: '0',
          endTimeMillis: '1',
          dataset: [
            {
              dataSourceId: 'sleep',
              point: [
                {
                  startTimeNanos: String(yesterday22 * 1_000_000),
                  endTimeNanos: String((yesterday22 + 2 * HOUR) * 1_000_000),
                  dataTypeName: 'x',
                  value: [{ intVal: 4 }],
                },
                {
                  startTimeNanos: String((yesterday22 + 2 * HOUR) * 1_000_000),
                  endTimeNanos: String((yesterday22 + 4 * HOUR) * 1_000_000),
                  dataTypeName: 'x',
                  value: [{ intVal: 5 }],
                },
                {
                  startTimeNanos: String((yesterday22 + 4 * HOUR) * 1_000_000),
                  endTimeNanos: String(today6 * 1_000_000),
                  dataTypeName: 'x',
                  value: [{ intVal: 6 }],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(result).not.toBeNull();
    expect(result?.startTs).toBe(yesterday22);
    expect(result?.endTs).toBe(today6);
    expect(result?.stages?.lightMs).toBe(2 * HOUR);
    expect(result?.stages?.deepMs).toBe(2 * HOUR);
    expect(result?.stages?.remMs).toBe(4 * HOUR);
  });

  test('returns null when no segments', () => {
    expect(parseLastSleep({ bucket: [] })).toBeNull();
  });
});

describe('parseWorkouts', () => {
  test('skips walking, sleep, and < 5min noise', () => {
    const NS = 1_000_000;
    const HOUR = 60 * 60 * 1000;
    const t0 = Date.UTC(2026, 5, 15, 10);
    const out = parseWorkouts({
      bucket: [
        {
          startTimeMillis: '0',
          endTimeMillis: '1',
          dataset: [
            {
              dataSourceId: 'activity',
              point: [
                // Walking — should be skipped
                {
                  startTimeNanos: String(t0 * NS),
                  endTimeNanos: String((t0 + HOUR) * NS),
                  dataTypeName: 'x',
                  value: [{ intVal: 7 }],
                },
                // Real run — should appear
                {
                  startTimeNanos: String((t0 + 2 * HOUR) * NS),
                  endTimeNanos: String((t0 + 2 * HOUR + 30 * 60 * 1000) * NS),
                  dataTypeName: 'x',
                  value: [{ intVal: 8 }],
                },
                // 2-min noise — should be skipped
                {
                  startTimeNanos: String((t0 + 4 * HOUR) * NS),
                  endTimeNanos: String((t0 + 4 * HOUR + 2 * 60 * 1000) * NS),
                  dataTypeName: 'x',
                  value: [{ intVal: 1 }],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(out.length).toBe(1);
    expect(out[0]?.activity).toBe('Running');
  });
});

describe('computeRestingHr', () => {
  test('returns 5th-percentile bpm', () => {
    const samples = Array.from({ length: 100 }, (_, i) => ({ ts: i, bpm: 60 + i }));
    expect(computeRestingHr(samples)).toBe(65);
  });

  test('returns null on empty input', () => {
    expect(computeRestingHr([])).toBeNull();
  });
});

describe('GoogleFitClient.snapshot', () => {
  test('issues four parallel aggregate calls and assembles a snapshot', async () => {
    const fetchMock = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ bucket: [] }),
      } as unknown as Response),
    );
    const original = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const c = new GoogleFitClient({ token: 't' });
      const snap = await c.snapshot(Date.UTC(2026, 5, 15, 12));
      expect(fetchMock).toHaveBeenCalledTimes(4);
      expect(snap.provider).toBe('google-fit');
      expect(snap.stepsHourly).toEqual([]);
    } finally {
      globalThis.fetch = original;
    }
  });

  test('throws with status detail on non-OK', async () => {
    const fetchMock = mock(() =>
      Promise.resolve({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: () => Promise.resolve('token expired'),
      } as unknown as Response),
    );
    const original = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const c = new GoogleFitClient({ token: 't' });
      await expect(c.snapshot()).rejects.toThrow(/401/);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('fitnessSnapshotFromEnv', () => {
  test('returns demo when no token', async () => {
    const snap = await fitnessSnapshotFromEnv({ env: {} });
    expect(snap.provider).toBe('demo');
  });

  test('uses GOOGLE_FIT_TOKEN env when present', async () => {
    const fetchMock = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ bucket: [] }),
      } as unknown as Response),
    );
    const original = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const snap = await fitnessSnapshotFromEnv({ env: { GOOGLE_FIT_TOKEN: 'tok' } });
      expect(snap.provider).toBe('google-fit');
    } finally {
      globalThis.fetch = original;
    }
  });

  test('explicit token arg beats env', async () => {
    const fetchMock = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ bucket: [] }),
      } as unknown as Response),
    );
    const original = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const snap = await fitnessSnapshotFromEnv({ token: 'override', env: {} });
      expect(snap.provider).toBe('google-fit');
    } finally {
      globalThis.fetch = original;
    }
  });
});
