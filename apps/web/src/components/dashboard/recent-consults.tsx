import { Card, PulseDot, cn } from '@dr-abc/ui';
import { Activity, Brain, ChevronRight, Clock, Stethoscope } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { useAuth } from '../../lib/auth.tsx';
import { type MemoryEntry, listMemory } from '../../lib/morbius-memory.ts';

/**
 * RecentConsults — newest-first strip on the dashboard.
 *
 * Reads straight from Mörbius's per-user IndexedDB memory (which is
 * pre-seeded with the 15 demo cases on first sign-in via
 * `lib/case-seed.ts`). Every signed-off Rx in the live consult flow
 * also writes here, so this list grows naturally as the doctor uses
 * the app.
 *
 * Click a card → routes to `/app/clinic` with the chief complaint
 * pre-stuffed via the same `dr-abc:pending-consult` sessionStorage
 * channel the symptom-checker quickstart uses.
 */

const SPECIALTY_TONE: Record<string, { ring: string; chip: string }> = {
  cardiology: { ring: 'border-rose-500/30', chip: 'bg-rose-500/15 text-rose-300' },
  neurology: { ring: 'border-quantum-400/30', chip: 'bg-quantum-500/15 text-quantum-300' },
  oncology: { ring: 'border-amber-500/30', chip: 'bg-amber-500/15 text-amber-300' },
  pulmonology: { ring: 'border-bio-500/30', chip: 'bg-bio-500/15 text-bio-300' },
  endocrinology: { ring: 'border-purple-500/30', chip: 'bg-purple-500/15 text-purple-300' },
  dermatology: { ring: 'border-amber-400/30', chip: 'bg-amber-400/15 text-amber-200' },
  pediatrics: { ring: 'border-sky-400/30', chip: 'bg-sky-500/15 text-sky-300' },
  primary: { ring: 'border-app-subtle', chip: 'bg-white/5 text-app-muted' },
};

function toneFor(specialty: string | undefined): { ring: string; chip: string } {
  const k = (specialty ?? '').toLowerCase();
  for (const [needle, tone] of Object.entries(SPECIALTY_TONE)) {
    if (k.includes(needle)) return tone;
  }
  return SPECIALTY_TONE.primary as { ring: string; chip: string };
}

function relativeTime(ts: number, now = Date.now()): string {
  const diff = Math.max(0, now - ts);
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

export function RecentConsults({ limit = 6 }: { limit?: number }) {
  const { user } = useAuth();
  const [entries, setEntries] = useState<MemoryEntry[] | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    void listMemory(user.id, limit)
      .then((rows) => {
        if (!cancelled) setEntries(rows);
      })
      .catch(() => {
        if (!cancelled) setEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id, limit]);

  const launchReplay = (chiefComplaint: string) => {
    // Fallback for memories with no consultId (older entries) — fresh
    // consult, complaint pre-stuffed in the input box.
    window.sessionStorage.setItem('dr-abc:pending-consult', chiefComplaint);
  };

  return (
    <Card className="p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.32em] text-quantum-300">
            <Brain className="h-3 w-3" /> · memory · newest first
          </div>
          <h2 className="mt-1 font-display text-xl font-bold text-app-primary">
            Recent consults Mörbius remembers.
          </h2>
        </div>
        <Link
          href="/app/brain"
          className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint transition hover:text-quantum-300"
        >
          open brain map <ChevronRight className="h-3 w-3" />
        </Link>
      </div>

      {entries === null && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders, no semantic id
              key={i}
              className="h-24 animate-pulse rounded-xl border border-app-subtle bg-white/2"
            />
          ))}
        </div>
      )}

      {entries !== null && entries.length === 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-dashed border-app-subtle p-4 text-app-muted">
          <Activity className="h-4 w-4 shrink-0 text-app-faint" />
          <p className="font-sans text-sm">
            No consults yet. The next signed Rx becomes Mörbius's first memory.
          </p>
        </div>
      )}

      {entries !== null && entries.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {entries.map((e) => {
            const tone = toneFor(e.specialty);
            return (
              <Link
                key={e.id}
                href={e.consultId ? `/app/consult?id=${e.consultId}` : '/app/consult'}
                onClick={() => {
                  if (!e.consultId) launchReplay(e.chiefComplaint);
                }}
                className={cn(
                  'group flex flex-col gap-2 rounded-xl border bg-white/2 p-3 text-left transition hover:-translate-y-0.5 hover:bg-white/[0.05]',
                  tone.ring,
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 font-display text-sm font-semibold text-app-primary">
                    <Stethoscope className="h-3.5 w-3.5 text-app-faint" />
                    {e.diagnosis ?? 'Open case'}
                  </span>
                  {e.specialty && (
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.22em]',
                        tone.chip,
                      )}
                    >
                      {e.specialty}
                    </span>
                  )}
                </div>
                <p className="line-clamp-2 font-sans text-xs leading-snug text-app-muted">
                  {e.chiefComplaint}
                </p>
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
                    <Clock className="h-3 w-3" /> {relativeTime(e.ts)}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    {e.icd10 && (
                      <code className="rounded bg-black/20 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-app-secondary">
                        {e.icd10}
                      </code>
                    )}
                    <PulseDot active size="xs" tone="bio" />
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
        Local-only · IndexedDB · TF-cosine recall feeds the next consult's prompt
      </p>
    </Card>
  );
}

export const __test = { relativeTime, toneFor };
