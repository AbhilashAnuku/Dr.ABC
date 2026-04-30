/**
 * Web-side instrumentation for the Training Cockpit's activity log.
 *
 * Every meaningful user action calls `recordActivity()` fire-and-forget.
 * Failures are silent — the UI never blocks on the journal. The API
 * gate is `X-Dr-Abc-Role: developer`, so for non-dev roles we still
 * emit the call but the server returns 403 and we drop the result;
 * once a dev session is open in the same browser the same instrumentation
 * starts landing rows (the cockpit is the consumer).
 *
 * Why no batching: writes are 1–2/sec at most across the whole app and
 * each is a tiny POST. Batching would just add latency to the
 * fire-and-forget path. If volume ever grows, swap in a `requestIdleCallback`
 * flusher behind the same recordActivity() entry point.
 */

export type ActivityRole = 'patient' | 'doctor' | 'student' | 'developer';

export interface ActivityActionInput {
  role: ActivityRole;
  userId: string;
  /** UI surface or API route the action originated from. */
  route: string;
  /** Verb-noun: 'consult.submit', 'rx.signed', 'lab.train.run', … */
  action: string;
  /** Free-form context. Keep small + redacted (no PHI, no tokens). */
  payload?: Record<string, unknown>;
  latencyMs?: number;
  status?: 'ok' | 'error';
}

const API_ROOT = '/api';

export function recordActivity(input: ActivityActionInput): void {
  const body = JSON.stringify({
    ts: Date.now(),
    ...input,
    status: input.status ?? 'ok',
  });
  // Prefer sendBeacon for reliability on page-leave; it doesn't accept
  // headers though, so we fall back to fetch when the role header is
  // strictly required (it is — the server gate reads X-Dr-Abc-Role).
  void fetch(`${API_ROOT}/dev/activity`, {
    method: 'POST',
    keepalive: true,
    headers: {
      'content-type': 'application/json',
      'x-dr-abc-role': input.role,
      'x-dr-abc-user': input.userId,
    },
    body,
  }).catch(() => {
    // swallow — the journal is best-effort
  });
}

/**
 * Convenience wrapper: time an async fn, record outcome.
 */
export async function withActivity<T>(
  meta: Omit<ActivityActionInput, 'latencyMs' | 'status' | 'payload'> & {
    payload?: Record<string, unknown>;
  },
  fn: () => Promise<T>,
): Promise<T> {
  const t0 = performance.now();
  try {
    const out = await fn();
    recordActivity({
      ...meta,
      latencyMs: Math.round(performance.now() - t0),
      status: 'ok',
    });
    return out;
  } catch (err) {
    recordActivity({
      ...meta,
      latencyMs: Math.round(performance.now() - t0),
      status: 'error',
      payload: { ...(meta.payload ?? {}), error: err instanceof Error ? err.message : String(err) },
    });
    throw err;
  }
}
