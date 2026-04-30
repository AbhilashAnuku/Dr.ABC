import { Card, cn } from '@dr-abc/ui';
import { Activity, RefreshCw, ShieldAlert, Sparkles, TrendingUp, Zap } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { API_BASE } from '../../lib/config.ts';

/**
 * Self-correction panel — gradient-boosting loop made visible.
 *
 * Gradient boosting learns from mistakes so they are not repeated:
 * this is active training and learning, not merely a journal. The
 * panel visualises the LOOP, not the log:
 *
 *   mistake (gauntlet fail · override · follow-up retraction)
 *      └→  recorded as residual against (complaint × condition)
 *           └→  next inference reads the residual
 *                 └→  same mistake never repeats
 *
 * Reads `/errors/stats` which aggregates the append-only journal at
 * `docs/status/boosting-journal.jsonl`. Polls every 30 s.
 */

interface BoostingStats {
  ts: number;
  totalEvents: number;
  bySource: Record<string, number>;
  byDirection: Record<'lift' | 'damp' | 'replace', number>;
  topPatterns: Array<{ predicted: string; actual: string; count: number }>;
}

const SOURCE_TONE: Record<string, string> = {
  validator: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  safety: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
  privacy: 'border-purple-500/40 bg-purple-500/10 text-purple-300',
  architect: 'border-quantum-400/40 bg-quantum-500/10 text-quantum-300',
  'follow-up': 'border-blue-500/40 bg-blue-500/10 text-blue-300',
  autopilot: 'border-app-subtle bg-white/5 text-app-secondary',
};

const DIRECTION_TONE: Record<string, string> = {
  lift: 'border-bio-500/40 bg-bio-500/10 text-bio-300',
  damp: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
  replace: 'border-quantum-400/40 bg-quantum-500/10 text-quantum-300',
};

export function BoostingPanel() {
  const [stats, setStats] = useState<BoostingStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${API_BASE}/errors/stats`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as BoostingStats;
      setStats(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(refresh, 30_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  return (
    <div className="space-y-4 p-3">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.32em] text-quantum-300">
            · self-correction · gradient boosting · learn once, never repeat
          </div>
          <h2 className="mt-1 font-display text-2xl font-bold text-app-primary">
            Mörbius doesn't repeat mistakes
          </h2>
          <p className="mt-1 max-w-2xl font-sans text-sm text-app-muted">
            Every gauntlet failure, architect override, and follow-up retraction becomes a residual
            against the (complaint × condition) signature it was wrong about. The next inference
            reads that residual and shifts its differential toward the correction — bounded,
            decayed, and direction-locked on red-flag pathways. The same mistake doesn't fire twice.
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md border border-app-subtle px-3 py-1.5',
            'font-mono text-[10px] uppercase tracking-[0.22em] text-app-secondary',
            'hover:border-quantum-400/60 hover:text-quantum-300 disabled:opacity-50',
          )}
        >
          <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
          {loading ? 'loading' : 'refresh'}
        </button>
      </header>

      {/* The learning loop, drawn out so the panel reads as a process,
          not a log. Each step is a chip; the arrows imply forward time. */}
      <Card className="p-4">
        <h3 className="mb-3 font-display text-sm text-app-primary">The learning loop</h3>
        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em]">
          <LoopStep tone="rose" label="mistake" sub="gauntlet · override · retraction" />
          <LoopArrow />
          <LoopStep tone="amber" label="record" sub="signature → journal · capped · decayed" />
          <LoopArrow />
          <LoopStep tone="quantum" label="next inference" sub="reads residual · shifts probs" />
          <LoopArrow />
          <LoopStep tone="bio" label="never again" sub="same complaint · won't repeat" />
        </div>
      </Card>

      {error && (
        <Card className="border-rose-500/40 bg-rose-500/10 p-4 font-mono text-xs text-rose-300">
          /errors/stats failed: {error}
        </Card>
      )}

      {stats && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <SummaryCard
              icon={Activity}
              label="Total events"
              value={stats.totalEvents.toLocaleString()}
              hint={`last updated ${new Date(stats.ts).toLocaleTimeString()}`}
              tone="quantum"
            />
            <SummaryCard
              icon={Sparkles}
              label="Lift corrections"
              value={(stats.byDirection.lift ?? 0).toString()}
              hint="differential pushed UP toward correction"
              tone="bio"
            />
            <SummaryCard
              icon={ShieldAlert}
              label="Damp corrections"
              value={(stats.byDirection.damp ?? 0).toString()}
              hint="differential pulled DOWN from a wrong call"
              tone="rose"
            />
          </div>

          <Card className="p-4">
            <h3 className="mb-3 font-display text-sm text-app-primary">By source</h3>
            <div className="flex flex-wrap gap-2">
              {Object.entries(stats.bySource).map(([source, count]) => (
                <span
                  key={source}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-full border px-3 py-1',
                    'font-mono text-[10px] uppercase tracking-[0.22em]',
                    SOURCE_TONE[source] ?? 'border-app-subtle bg-white/5 text-app-secondary',
                  )}
                >
                  {source}
                  <span className="rounded-full bg-black/30 px-1.5 py-0.5 tabular-nums">
                    {count}
                  </span>
                </span>
              ))}
            </div>
            <p className="mt-3 font-sans text-[11px] text-app-faint">
              Source weights (default magnitudes): architect 0.40 · follow-up 0.25 · safety/privacy
              0.20 · validator 0.10 · autopilot 0.05. Single-event cap 0.5; cumulative residual cap
              0.3 per (complaint × condition). Time decay 0.97/day (~42-day half-life).
            </p>
          </Card>

          <Card className="p-4">
            <h3 className="mb-3 font-display text-sm text-app-primary">By direction</h3>
            <div className="grid grid-cols-3 gap-2">
              {(['lift', 'damp', 'replace'] as const).map((dir) => (
                <div
                  key={dir}
                  className={cn(
                    'rounded-lg border p-3 text-center',
                    DIRECTION_TONE[dir] ?? 'border-app-subtle',
                  )}
                >
                  <div className="font-display text-2xl font-bold tabular-nums">
                    {stats.byDirection[dir] ?? 0}
                  </div>
                  <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.22em] opacity-70">
                    {dir}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-4">
            <h3 className="mb-3 inline-flex items-center gap-2 font-display text-sm text-app-primary">
              <TrendingUp className="h-4 w-4 text-quantum-300" />
              Top patterns · predicted → actual
            </h3>
            {stats.topPatterns.length === 0 ? (
              <p className="font-sans text-xs text-app-faint">
                No correction patterns recorded yet — the journal is empty.
              </p>
            ) : (
              <ul className="divide-y divide-app-subtle">
                {stats.topPatterns.map((p) => (
                  <li
                    key={`${p.predicted}-${p.actual}`}
                    className="flex items-center justify-between gap-3 py-2"
                  >
                    <div className="flex min-w-0 items-center gap-2 font-sans text-sm">
                      <span className="truncate text-rose-300">{p.predicted || '—'}</span>
                      <Zap className="h-3 w-3 shrink-0 text-app-faint" />
                      <span className="truncate text-bio-300">{p.actual || '—'}</span>
                    </div>
                    <span className="rounded-full border border-app-subtle bg-white/5 px-2 py-0.5 font-mono text-[10px] tabular-nums text-app-secondary">
                      ×{p.count}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function LoopStep({
  tone,
  label,
  sub,
}: {
  tone: 'rose' | 'amber' | 'quantum' | 'bio';
  label: string;
  sub: string;
}) {
  const toneCls = {
    rose: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
    amber: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
    quantum: 'border-quantum-400/40 bg-quantum-500/10 text-quantum-300',
    bio: 'border-bio-500/40 bg-bio-500/10 text-bio-300',
  } as const;
  return (
    <div className={cn('rounded-lg border px-3 py-2', toneCls[tone])}>
      <div className="font-display text-[12px] font-semibold tracking-normal">{label}</div>
      <div className="mt-0.5 text-[9px] tracking-[0.18em] opacity-70 normal-case">{sub}</div>
    </div>
  );
}

function LoopArrow() {
  return <span className="text-app-faint">→</span>;
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  hint: string;
  tone: 'quantum' | 'bio' | 'rose';
}) {
  const toneCls =
    tone === 'quantum' ? 'text-quantum-300' : tone === 'bio' ? 'text-bio-300' : 'text-rose-300';
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
        <Icon className={cn('h-3.5 w-3.5', toneCls)} />
        {label}
      </div>
      <div className={cn('mt-2 font-display text-3xl font-bold tabular-nums', toneCls)}>
        {value}
      </div>
      <div className="mt-1 font-sans text-[11px] text-app-faint">{hint}</div>
    </Card>
  );
}
