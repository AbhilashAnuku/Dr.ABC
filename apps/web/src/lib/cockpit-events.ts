import { useEffect, useState } from 'react';

/**
 * useActivityTail — subscribes to the developer SSE feed at
 * /api/dev/activity/stream. Each new entry prepends to the returned
 * list (newest-first), capped at `maxEntries`. Pause / resume +
 * one-shot replay of the recent history are handled at the call site
 * via the toggle flags returned.
 *
 * Why an EventSource and not a custom fetch reader: EventSource gives
 * us automatic reconnection on network blips for free, and the cockpit
 * needs the live feed to outlive reload/standby cycles.
 */

export interface ActivityRow {
  id: string;
  ts: number;
  role: 'patient' | 'doctor' | 'student' | 'developer' | 'system';
  userId: string;
  route: string;
  action: string;
  payload?: Record<string, unknown>;
  latencyMs?: number;
  status?: 'ok' | 'error';
}

export interface UseActivityTailOptions {
  paused?: boolean;
  maxEntries?: number;
  /** Initial fetch — pulls last N rows so the feed isn't empty on first paint. */
  bootstrapLimit?: number;
}

export function useActivityTail(opts: UseActivityTailOptions = {}) {
  const paused = opts.paused ?? false;
  const max = opts.maxEntries ?? 500;
  const bootstrap = opts.bootstrapLimit ?? 50;

  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [status, setStatus] = useState<'idle' | 'connecting' | 'live' | 'paused' | 'error'>('idle');

  // Bootstrap with recent history so the feed isn't empty.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/dev/activity?limit=${bootstrap}`, {
          headers: { 'x-dr-abc-role': 'developer' },
        });
        if (!res.ok) return;
        const json = (await res.json()) as { entries?: ActivityRow[] };
        if (!cancelled && json.entries) {
          setRows(json.entries.slice(0, max));
        }
      } catch {
        // best-effort
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bootstrap, max]);

  // Live tail.
  useEffect(() => {
    if (paused) {
      setStatus('paused');
      return;
    }
    setStatus('connecting');
    const es = new EventSource('/api/dev/activity/stream');
    es.addEventListener('activity', (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as ActivityRow;
        setRows((prev) => [data, ...prev].slice(0, max));
      } catch {
        // ignore malformed
      }
    });
    es.addEventListener('open', () => setStatus('live'));
    es.addEventListener('error', () => setStatus('error'));
    return () => {
      es.close();
    };
  }, [paused, max]);

  const clear = () => setRows([]);

  return { rows, status, clear } as const;
}
