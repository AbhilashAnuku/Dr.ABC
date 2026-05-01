import type { FitnessSnapshot } from '@dr-abc/agents';
import { Card, cn } from '@dr-abc/ui';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Heart,
  HeartPulse,
  History,
  MessageSquareText,
  Pill,
  Sparkles,
  Stethoscope,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { useAuth } from '../lib/auth.tsx';
import { type ConsultHistoryEntry, loadConsultHistory } from '../lib/consult-history.ts';
import { type MedicalRecord, loadRecord } from '../lib/medical-record.ts';

/**
 * DashboardCohesion — two glanceable cards + a recent-consults strip
 * that turn the dashboard into a real status surface:
 *
 *   1. Health Snapshot — pulled from /app/profile (allergies count,
 *      active conditions, current meds, last update).
 *   2. Fitness Today — last sync from POST /fitness/sync (steps,
 *      resting HR, last sleep duration).
 *
 * The Stage-7 "Training Plan" card was tied to the deleted /app/lab —
 * dropped in Stage 8.
 */

export function DashboardCohesion() {
  const { user } = useAuth();
  const [record, setRecord] = useState<MedicalRecord | null>(null);
  const [fitness, setFitness] = useState<FitnessSnapshot | null>(null);
  const [recentConsults, setRecentConsults] = useState<ConsultHistoryEntry[]>([]);

  useEffect(() => {
    if (!user) return;
    setRecord(loadRecord(user.id));
    setRecentConsults(loadConsultHistory(user.id).slice(0, 5));
    const base = (import.meta.env.VITE_API_BASE_URL ?? '/api').toString();
    fetch(`${base}/fitness/sync`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
      .then((r) => (r.ok ? (r.json() as Promise<FitnessSnapshot>) : null))
      .then((s) => setFitness(s))
      .catch(() => {});
  }, [user]);

  return (
    <div className="space-y-4">
      <section className="grid gap-4 sm:grid-cols-2">
        <HealthSnapshotCard record={record} />
        <FitnessSnapshotCard snap={fitness} />
      </section>
      <RecentConsultsCard entries={recentConsults} />
    </div>
  );
}

function RecentConsultsCard({ entries }: { entries: ConsultHistoryEntry[] }) {
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-quantum-300" />
          <span className="font-display text-base font-semibold text-app-primary">
            Recent consultations
          </span>
        </div>
        <Link
          href="/app/clinic"
          className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.18em] text-app-faint hover:text-quantum-300"
        >
          new <ArrowUpRight className="h-3 w-3" />
        </Link>
      </div>
      {entries.length === 0 ? (
        <p className="font-sans text-xs text-app-faint">
          You haven't run a consultation yet. Open the clinic and describe a chief complaint —
          Mörbius will log every exchange here.
        </p>
      ) : (
        <ul className="space-y-2">
          {entries.map((c) => (
            <li
              key={c.id}
              className="grid grid-cols-[16px_1fr_auto] items-center gap-2 rounded-md border border-app-subtle bg-white/[0.02] px-3 py-2"
            >
              <MessageSquareText className="h-3.5 w-3.5 text-app-muted" />
              <div className="min-w-0">
                <p className="truncate font-sans text-sm text-app-primary">{c.complaint}</p>
                <p className="mt-0.5 truncate font-mono text-[10px] uppercase tracking-[0.16em] text-app-faint">
                  {c.topCondition
                    ? `${c.topCondition} · ${c.topProb !== undefined ? `${Math.round(c.topProb * 100)}%` : ''}`
                    : 'no diagnosis'}
                  {c.specialty ? ` · ${c.specialty}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em]">
                {c.prescriptionIssued && (
                  <span className="rounded-full border border-bio-500/40 bg-bio-500/10 px-2 py-0.5 text-bio-300">
                    rx
                  </span>
                )}
                <span className="text-app-faint">{relTime(c.startedAt)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function relTime(ts: number): string {
  const sec = Math.round((Date.now() - ts) / 1000);
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  if (sec < 86_400) return `${Math.round(sec / 3600)}h`;
  return `${Math.round(sec / 86_400)}d`;
}

function HealthSnapshotCard({ record }: { record: MedicalRecord | null }) {
  return (
    <CohesionCard
      icon={Heart}
      tone="bio"
      title="My Records"
      to="/app/profile"
      kicker="medical record"
    >
      {!record ? (
        <p className="font-sans text-xs text-app-faint">
          No record yet. Open My Records to add allergies, conditions, and medications so every
          consultation is primed.
        </p>
      ) : (
        <div className="space-y-2">
          <Stat
            icon={AlertTriangle}
            label="allergies"
            value={String(record.allergies.length)}
            tone={record.allergies.length === 0 ? 'muted' : 'amber'}
          />
          <Stat
            icon={Stethoscope}
            label="active conditions"
            value={String(record.conditions.filter((c) => c.status === 'active').length)}
            tone="quantum"
          />
          <Stat
            icon={Pill}
            label="current meds"
            value={String(record.medications.length)}
            tone="bio"
          />
          <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-app-faint">
            updated {new Date(record.updatedAt).toLocaleDateString()}
          </p>
        </div>
      )}
    </CohesionCard>
  );
}

function FitnessSnapshotCard({ snap }: { snap: FitnessSnapshot | null }) {
  return (
    <CohesionCard
      icon={HeartPulse}
      tone="quantum"
      title="Fitness today"
      to="/app/profile"
      kicker={snap ? `from ${snap.provider === 'demo' ? 'demo data' : snap.provider}` : 'syncing…'}
    >
      {!snap ? (
        <p className="font-sans text-xs text-app-faint">
          No sync yet. Connect Google Fit on your profile.
        </p>
      ) : (
        <div className="space-y-2">
          <Stat
            icon={Activity}
            label="steps · today"
            value={snap.stepsTotal.toLocaleString()}
            tone="quantum"
          />
          <Stat
            icon={HeartPulse}
            label="resting HR"
            value={snap.restingHrBpm ? `${snap.restingHrBpm} bpm` : '—'}
            tone="bio"
          />
          <Stat
            icon={Sparkles}
            label="last sleep"
            value={
              snap.lastSleep
                ? `${Math.round(snap.lastSleep.durationMs / 3_600_000)}h ${Math.round((snap.lastSleep.durationMs % 3_600_000) / 60_000)}m`
                : '—'
            }
            tone="muted"
          />
          <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-app-faint">
            synced {new Date(snap.syncedAt).toLocaleTimeString()}
          </p>
        </div>
      )}
    </CohesionCard>
  );
}

function CohesionCard({
  icon: Icon,
  tone,
  title,
  kicker,
  to,
  children,
}: {
  icon: typeof Activity;
  tone: 'bio' | 'quantum' | 'amber';
  title: string;
  kicker: string;
  to: string;
  children: React.ReactNode;
}) {
  const toneCls = {
    bio: 'border-bio-500/30 bg-bio-500/5',
    quantum: 'border-quantum-400/30 bg-quantum-500/5',
    amber: 'border-amber-500/30 bg-amber-500/5',
  } as const;
  const iconCls = {
    bio: 'text-bio-400',
    quantum: 'text-quantum-400',
    amber: 'text-amber-400',
  } as const;
  return (
    <Card className={cn('p-4', toneCls[tone])}>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className={cn('h-4 w-4', iconCls[tone])} />
          <span className="font-display text-base font-semibold text-app-primary">{title}</span>
        </div>
        <Link
          href={to}
          className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.18em] text-app-faint hover:text-quantum-300"
        >
          open <ArrowUpRight className="h-3 w-3" />
        </Link>
      </div>
      <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-app-faint">
        {kicker}
      </p>
      {children}
    </Card>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  tone: 'bio' | 'quantum' | 'amber' | 'muted';
}) {
  const valueCls = {
    bio: 'text-bio-300',
    quantum: 'text-quantum-300',
    amber: 'text-amber-300',
    muted: 'text-app-secondary',
  } as const;
  return (
    <div className="flex items-center justify-between rounded-md border border-app-subtle bg-white/[0.02] px-2.5 py-1.5">
      <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-app-faint">
        <Icon className="h-3 w-3" />
        {label}
      </span>
      <span className={cn('font-mono text-base font-bold tabular-nums', valueCls[tone])}>
        {value}
      </span>
    </div>
  );
}
