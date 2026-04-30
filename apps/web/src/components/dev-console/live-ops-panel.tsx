// Live ops panel — docker · migrations · per-functionality stats.
//
// Surfaces live operational metrics: docker containers, seed
// migrations, training/testing and regression stats, and per-feature
// counters, all auto-updating in the browser.
//
// Reads three endpoints (15 s poll):
//   1. /ops/docker — container list + state + uptime per container
//   2. /ops/migrations — last applied migration per workspace
//   3. /ops/functionality — per-feature counters (consults · medqa · imaging)
//
// Each section degrades gracefully when the endpoint isn't available
// yet — the panel still shows a stub row "endpoint not implemented" so
// it's clear what surface still has to land.

import { Card } from '@dr-abc/ui';
import { Activity, Box, Database, GitBranch, Heart, type LucideIcon, Server } from 'lucide-react';
import { useEffect, useState } from 'react';

interface DockerContainer {
  name: string;
  state: 'running' | 'exited' | 'paused' | 'restarting' | 'unknown';
  uptime_s: number;
  image: string;
}

interface Migration {
  workspace: string;
  last_applied: string | null;
  applied_at: string | null;
  pending_count: number;
}

interface FunctionalityStat {
  feature: string;
  count_24h: number;
  count_7d: number;
  delta_pct: number | null;
  pass_rate: number | null;
}

const STATE_DOT: Record<DockerContainer['state'], string> = {
  running: 'bg-bio-400',
  exited: 'bg-rose-400',
  paused: 'bg-amber-400',
  restarting: 'bg-quantum-400',
  unknown: 'bg-app-faint',
};

function fmtUptime(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function StubBlock({
  icon: Icon,
  title,
  message,
}: { icon: LucideIcon; title: string; message: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2">
      <Icon className="h-4 w-4 text-amber-300" />
      <div className="flex-1">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-amber-200">
          {title}
        </div>
        <div className="font-sans text-[11px] text-app-muted">{message}</div>
      </div>
    </div>
  );
}

export function LiveOpsTab() {
  const [containers, setContainers] = useState<DockerContainer[] | null>(null);
  const [migrations, setMigrations] = useState<Migration[] | null>(null);
  const [features, setFeatures] = useState<FunctionalityStat[] | null>(null);
  const [stale, setStale] = useState(0);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch('/ops/docker');
        if (r.ok) {
          const j = (await r.json()) as { containers?: DockerContainer[] };
          if (alive) setContainers(j.containers ?? []);
        } else {
          if (alive) setContainers(null);
        }
      } catch {
        if (alive) setContainers(null);
      }
      try {
        const r = await fetch('/ops/migrations');
        if (r.ok) {
          const j = (await r.json()) as { migrations?: Migration[] };
          if (alive) setMigrations(j.migrations ?? []);
        } else {
          if (alive) setMigrations(null);
        }
      } catch {
        if (alive) setMigrations(null);
      }
      try {
        const r = await fetch('/ops/functionality');
        if (r.ok) {
          const j = (await r.json()) as { features?: FunctionalityStat[] };
          if (alive) setFeatures(j.features ?? []);
        } else {
          if (alive) setFeatures(null);
        }
      } catch {
        if (alive) setFeatures(null);
      }
      if (alive) setStale((s) => s + 1);
    };
    tick();
    const id = window.setInterval(tick, 15_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-quantum-300" />
          <span className="font-mono text-[10px] uppercase tracking-[0.32em] text-quantum-300">
            live ops · 15 s poll · day-to-day surface
          </span>
        </div>
        <span className="font-mono text-[10px] tabular-nums text-app-faint">
          tick · {stale.toString().padStart(3, '0')}
        </span>
      </div>

      {/* Docker containers */}
      <Card className="p-4">
        <div className="mb-2 flex items-center gap-2">
          <Box className="h-4 w-4 text-bio-300" />
          <span className="font-display text-sm font-semibold text-app-primary">
            Docker · containers
          </span>
        </div>
        {containers === null ? (
          <StubBlock
            icon={Server}
            title="endpoint /ops/docker not yet implemented"
            message="Drop a Hono route that runs `docker ps --format json` and returns the parsed list. Sentinel will pick it up automatically."
          />
        ) : containers.length === 0 ? (
          <p className="font-sans text-[11px] text-app-muted">No containers running.</p>
        ) : (
          <div className="grid gap-2 lg:grid-cols-2">
            {containers.map((c) => (
              <div
                key={c.name}
                className="flex items-center justify-between gap-3 rounded-md border border-app-subtle bg-app-surface px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${STATE_DOT[c.state]}`} />
                  <div>
                    <div className="font-mono text-[11px] text-app-primary">{c.name}</div>
                    <div className="font-mono text-[9px] text-app-faint">{c.image}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-app-muted">
                    {c.state}
                  </div>
                  <div className="font-mono text-[10px] tabular-nums text-app-faint">
                    {fmtUptime(c.uptime_s)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Migrations */}
      <Card className="p-4">
        <div className="mb-2 flex items-center gap-2">
          <Database className="h-4 w-4 text-purple-300" />
          <span className="font-display text-sm font-semibold text-app-primary">
            Migrations · per-workspace
          </span>
        </div>
        {migrations === null ? (
          <StubBlock
            icon={GitBranch}
            title="endpoint /ops/migrations not yet implemented"
            message="Read drizzle.meta · packages/db migrations folder + return last applied. Free implementation: glob the journal.json + report the latest tag."
          />
        ) : migrations.length === 0 ? (
          <p className="font-sans text-[11px] text-app-muted">No migrations recorded.</p>
        ) : (
          <div className="flex flex-col divide-y divide-app-subtle">
            {migrations.map((m) => (
              <div key={m.workspace} className="flex items-center justify-between gap-3 py-2">
                <div>
                  <div className="font-mono text-[11px] text-app-primary">{m.workspace}</div>
                  <div className="font-mono text-[9px] text-app-faint">
                    {m.last_applied ?? '— never applied —'}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-[10px] tabular-nums text-app-muted">
                    {m.applied_at ?? '--'}
                  </div>
                  {m.pending_count > 0 && (
                    <div className="font-mono text-[10px] tabular-nums text-amber-300">
                      +{m.pending_count} pending
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Per-functionality stats */}
      <Card className="p-4">
        <div className="mb-2 flex items-center gap-2">
          <Heart className="h-4 w-4 text-rose-300" />
          <span className="font-display text-sm font-semibold text-app-primary">
            Per-functionality · 24 h vs 7 d
          </span>
        </div>
        {features === null ? (
          <StubBlock
            icon={Activity}
            title="endpoint /ops/functionality not yet implemented"
            message="Aggregate from activity-sink — group by `action` prefix (consult.* / medqa.* / imaging.*) and return counts + pass-rate per feature."
          />
        ) : features.length === 0 ? (
          <p className="font-sans text-[11px] text-app-muted">No activity logged.</p>
        ) : (
          <div className="grid gap-2 lg:grid-cols-2">
            {features.map((f) => (
              <div
                key={f.feature}
                className="rounded-md border border-app-subtle bg-app-surface px-3 py-2"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[11px] text-app-primary">{f.feature}</span>
                  {f.delta_pct !== null && (
                    <span
                      className={`font-mono text-[10px] tabular-nums ${
                        f.delta_pct >= 0 ? 'text-bio-300' : 'text-rose-300'
                      }`}
                    >
                      {f.delta_pct >= 0 ? '+' : ''}
                      {f.delta_pct.toFixed(1)}%
                    </span>
                  )}
                </div>
                <div className="mt-1 grid grid-cols-3 gap-2 text-center">
                  <div>
                    <div className="font-mono text-[9px] uppercase text-app-faint">24 h</div>
                    <div className="font-mono text-base font-bold tabular-nums text-app-primary">
                      {f.count_24h}
                    </div>
                  </div>
                  <div>
                    <div className="font-mono text-[9px] uppercase text-app-faint">7 d</div>
                    <div className="font-mono text-base font-bold tabular-nums text-app-primary">
                      {f.count_7d}
                    </div>
                  </div>
                  <div>
                    <div className="font-mono text-[9px] uppercase text-app-faint">pass</div>
                    <div className="font-mono text-base font-bold tabular-nums text-app-primary">
                      {f.pass_rate === null ? '--' : `${(f.pass_rate * 100).toFixed(0)}%`}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <p className="font-sans text-[11px] text-app-faint">
        Auto-refresh every 15 s. Endpoints `/ops/docker`, `/ops/migrations`, `/ops/functionality`
        are read-only by design — they never mutate state. When an endpoint isn't yet implemented,
        the panel surfaces a stub row so the missing surface is visible, not invisible.
      </p>
    </div>
  );
}
