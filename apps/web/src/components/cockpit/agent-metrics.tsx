import { Card, cn } from '@dr-abc/ui';
import { Activity } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ActivityRow } from '../../lib/cockpit-events.ts';

/**
 * Centre column of the cockpit. Aggregates the last 24 h of activity
 * into a per-agent latency + error-rate table, plus a coarse
 * 24-bucket-by-hour bar chart of consult volume.
 *
 * No new SSE subscription — pulls from /dev/activity?since= every 30s.
 * That's deliberate: the live feed (left column) gives the developer
 * row-by-row truth; this column gives the rolling shape, and burning
 * a separate stream just for histogram bins is overkill.
 */
export function AgentMetrics() {
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const since = Date.now() - 24 * 60 * 60 * 1000;
        const res = await fetch(`/api/dev/activity?since=${since}&limit=1000`, {
          headers: { 'x-dr-abc-role': 'developer' },
        });
        if (!res.ok) return;
        const json = (await res.json()) as { entries?: ActivityRow[] };
        if (!cancelled) {
          setRows(json.entries ?? []);
          setRefreshedAt(Date.now());
        }
      } catch {
        // best-effort
      }
    };
    void load();
    const id = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const agentRows = aggregateByAgent(rows);
  const hourly = bucketByHour(rows);

  return (
    <Card className="flex h-full flex-col p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="flex items-center gap-2 font-display text-sm font-semibold text-app-primary">
          <Activity className="h-4 w-4 text-quantum-400" /> Agent metrics · last 24h
        </h3>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-app-faint">
          {refreshedAt ? `refreshed ${new Date(refreshedAt).toLocaleTimeString()}` : 'loading…'}
        </span>
      </div>

      {/* Per-agent table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="font-mono text-[10px] uppercase tracking-[0.18em] text-app-faint">
              <th className="py-1 pr-3">surface / route</th>
              <th className="py-1 pr-3">calls</th>
              <th className="py-1 pr-3">err %</th>
              <th className="py-1 pr-3">p50 ms</th>
              <th className="py-1">p95 ms</th>
            </tr>
          </thead>
          <tbody className="font-sans text-sm">
            {agentRows.length === 0 && (
              <tr>
                <td colSpan={5} className="py-3 text-app-muted">
                  No activity recorded in the last 24h.
                </td>
              </tr>
            )}
            {agentRows.map((row) => (
              <tr key={row.route} className="border-t border-app-subtle/60">
                <td className="py-1 pr-3 font-mono text-[11px] text-app-secondary">{row.route}</td>
                <td className="py-1 pr-3 font-mono text-[11px] text-app-primary">{row.calls}</td>
                <td
                  className={cn(
                    'py-1 pr-3 font-mono text-[11px]',
                    row.errPct > 10
                      ? 'text-rose-300'
                      : row.errPct > 0
                        ? 'text-amber-300'
                        : 'text-bio-300',
                  )}
                >
                  {row.errPct.toFixed(1)}
                </td>
                <td className="py-1 pr-3 font-mono text-[11px] text-app-primary">{row.p50}</td>
                <td className="py-1 font-mono text-[11px] text-app-primary">{row.p95}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 24-hour histogram */}
      <div className="mt-5">
        <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.18em] text-app-faint">
          consults per hour · last 24h
        </div>
        <div className="flex h-24 items-end gap-px">
          {hourly.map((b, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: stable 24-slot histogram
              key={i}
              className="flex-1 rounded-sm bg-quantum-500/40"
              style={{ height: `${(b / Math.max(1, ...hourly)) * 100}%` }}
              title={`${b} actions`}
            />
          ))}
        </div>
      </div>
    </Card>
  );
}

interface AgentRow {
  route: string;
  calls: number;
  errPct: number;
  p50: number;
  p95: number;
}

function aggregateByAgent(rows: ActivityRow[]): AgentRow[] {
  const buckets = new Map<string, { calls: number; errors: number; latencies: number[] }>();
  for (const r of rows) {
    if (!buckets.has(r.route)) buckets.set(r.route, { calls: 0, errors: 0, latencies: [] });
    const b = buckets.get(r.route);
    if (!b) continue;
    b.calls++;
    if ((r.status ?? 'ok') === 'error') b.errors++;
    if (r.latencyMs !== undefined) b.latencies.push(r.latencyMs);
  }
  const out: AgentRow[] = [];
  for (const [route, b] of buckets) {
    const sorted = [...b.latencies].sort((a, b2) => a - b2);
    out.push({
      route,
      calls: b.calls,
      errPct: (b.errors / b.calls) * 100,
      p50: pct(sorted, 0.5),
      p95: pct(sorted, 0.95),
    });
  }
  return out.sort((a, b) => b.calls - a.calls);
}

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor(sorted.length * p)));
  return Math.round(sorted[idx] ?? 0);
}

function bucketByHour(rows: ActivityRow[]): number[] {
  const now = Date.now();
  const buckets = new Array(24).fill(0) as number[];
  for (const r of rows) {
    const hoursAgo = Math.floor((now - r.ts) / (60 * 60 * 1000));
    if (hoursAgo >= 0 && hoursAgo < 24) {
      const idx = 23 - hoursAgo;
      buckets[idx] = (buckets[idx] ?? 0) + 1;
    }
  }
  return buckets;
}
