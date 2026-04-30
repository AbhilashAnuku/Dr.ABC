import { Card, PulseDot, cn } from '@dr-abc/ui';
import { ChevronRight, Pill, Stethoscope } from 'lucide-react';
import { Link } from 'wouter';
import type { SeedCase } from '../../lib/case-seed.ts';

/**
 * CaseCard — compact tile per seeded case in the case library.
 *
 * Click → routes to /app/clinic with the chief complaint pre-stuffed
 * via the same `dr-abc:pending-consult` sessionStorage channel the
 * symptom-checker quickstart and recent-consults strip use, so the
 * agent mesh runs the case live.
 */

const SPECIALTY_TONE: Record<string, { ring: string; chip: string; glow: string }> = {
  cardiology: {
    ring: 'border-rose-500/30 hover:border-rose-500/60',
    chip: 'bg-rose-500/15 text-rose-300',
    glow: 'shadow-[0_0_30px_-15px_rgba(244,63,94,0.5)]',
  },
  neurology: {
    ring: 'border-quantum-400/30 hover:border-quantum-400/60',
    chip: 'bg-quantum-500/15 text-quantum-300',
    glow: 'shadow-[0_0_30px_-15px_rgba(56,189,248,0.5)]',
  },
  oncology: {
    ring: 'border-amber-500/30 hover:border-amber-500/60',
    chip: 'bg-amber-500/15 text-amber-300',
    glow: 'shadow-[0_0_30px_-15px_rgba(245,158,11,0.5)]',
  },
  pulmonology: {
    ring: 'border-bio-500/30 hover:border-bio-500/60',
    chip: 'bg-bio-500/15 text-bio-300',
    glow: 'shadow-[0_0_30px_-15px_rgba(16,185,129,0.5)]',
  },
  endocrinology: {
    ring: 'border-purple-500/30 hover:border-purple-500/60',
    chip: 'bg-purple-500/15 text-purple-300',
    glow: 'shadow-[0_0_30px_-15px_rgba(168,85,247,0.5)]',
  },
  dermatology: {
    ring: 'border-amber-400/30 hover:border-amber-400/60',
    chip: 'bg-amber-400/15 text-amber-200',
    glow: 'shadow-[0_0_30px_-15px_rgba(251,191,36,0.5)]',
  },
  pediatrics: {
    ring: 'border-sky-400/30 hover:border-sky-400/60',
    chip: 'bg-sky-500/15 text-sky-300',
    glow: 'shadow-[0_0_30px_-15px_rgba(56,189,248,0.5)]',
  },
  psychiatry: {
    ring: 'border-violet-400/30 hover:border-violet-400/60',
    chip: 'bg-violet-500/15 text-violet-300',
    glow: 'shadow-[0_0_30px_-15px_rgba(167,139,250,0.5)]',
  },
  surgery: {
    ring: 'border-orange-500/30 hover:border-orange-500/60',
    chip: 'bg-orange-500/15 text-orange-300',
    glow: 'shadow-[0_0_30px_-15px_rgba(249,115,22,0.5)]',
  },
  internal: {
    ring: 'border-app-subtle hover:border-quantum-400/40',
    chip: 'bg-white/5 text-app-secondary',
    glow: '',
  },
};

export function specialtyTone(specialty: string): { ring: string; chip: string; glow: string } {
  const k = specialty.toLowerCase();
  for (const [needle, tone] of Object.entries(SPECIALTY_TONE)) {
    if (k.includes(needle)) return tone;
  }
  return SPECIALTY_TONE.internal as { ring: string; chip: string; glow: string };
}

interface CaseCardProps {
  caseEntry: SeedCase;
}

export function CaseCard({ caseEntry: c }: CaseCardProps) {
  const tone = specialtyTone(c.specialty);
  // Continue a selected case-library entry in the clinic chat for
  // re-analysis and saving. Pass the deterministic consultId via ?id=
  // so clinic restores the saved transcript when it exists. Fallback:
  // sessionStorage holds the chief complaint so clinic auto-fills the
  // input even if no transcript was previously saved.
  const launchReplay = () => {
    window.sessionStorage.setItem('dr-abc:pending-consult', c.chiefComplaint);
  };

  return (
    <Link
      href={`/app/clinic?id=seed_${c.id}`}
      onClick={launchReplay}
      data-case-id={c.id}
      className={cn(
        'group flex h-full flex-col gap-3 rounded-xl border bg-white/2 p-4 transition hover:-translate-y-0.5 hover:bg-white/[0.05]',
        tone.ring,
        tone.glow,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-mono text-[10px] uppercase tracking-[0.32em] text-app-faint">
            {c.id} · {c.daysAgo}d ago
          </div>
          <h3 className="mt-1 inline-flex items-center gap-1.5 font-display text-base font-semibold text-app-primary">
            <Stethoscope className="h-4 w-4 shrink-0 text-app-faint" />
            {c.diagnosis}
          </h3>
        </div>
        <span
          className={cn(
            'shrink-0 rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.22em]',
            tone.chip,
          )}
        >
          {c.specialty}
        </span>
      </div>

      <p className="line-clamp-3 font-sans text-xs leading-relaxed text-app-muted">
        {c.chiefComplaint}
      </p>

      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-app-subtle pt-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <code className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-app-secondary">
            {c.icd10}
          </code>
          {c.drugs.length > 0 ? (
            c.drugs.slice(0, 2).map((d) => (
              <span
                key={d}
                className="inline-flex items-center gap-1 rounded-full border border-app-subtle bg-white/2 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em] text-app-muted"
              >
                <Pill className="h-2.5 w-2.5" />
                {d}
              </span>
            ))
          ) : (
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-app-faint">
              no Rx
            </span>
          )}
          {c.drugs.length > 2 && (
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-app-faint">
              +{c.drugs.length - 2}
            </span>
          )}
        </div>
        <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.22em] text-app-secondary group-hover:text-quantum-300">
          replay
          <ChevronRight className="h-3 w-3 transition group-hover:translate-x-0.5" />
        </span>
      </div>
    </Link>
  );
}

/**
 * CaseCardCompact — list-row variant for the dense table view.
 */
export function CaseCardCompact({ caseEntry: c }: CaseCardProps) {
  const tone = specialtyTone(c.specialty);
  const launchReplay = () => {
    window.sessionStorage.setItem('dr-abc:pending-consult', c.chiefComplaint);
  };
  return (
    <Card className="p-0">
      <Link
        href={`/app/clinic?id=seed_${c.id}`}
        onClick={launchReplay}
        className={cn('group flex items-center gap-3 px-3 py-2 transition hover:bg-white/[0.04]')}
      >
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
          {c.id}
        </span>
        <PulseDot active size="xs" tone="bio" />
        <span className="flex-1 truncate font-sans text-sm text-app-primary">{c.diagnosis}</span>
        <code className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-app-secondary">
          {c.icd10}
        </code>
        <span
          className={cn(
            'rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em]',
            tone.chip,
          )}
        >
          {c.specialty}
        </span>
        <ChevronRight className="h-3.5 w-3.5 text-app-faint transition group-hover:translate-x-0.5 group-hover:text-quantum-300" />
      </Link>
    </Card>
  );
}
