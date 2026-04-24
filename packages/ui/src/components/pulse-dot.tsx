import { cn } from '../cn.ts';

/**
 * PulseDot — the streaming-indicator dot.
 * `active` triggers the cyan ping animation; otherwise it sits as a dim slate dot.
 * Sizes intentionally limited to xs/sm/md so designers don't drift.
 */
export interface PulseDotProps {
  active?: boolean;
  size?: 'xs' | 'sm' | 'md';
  tone?: 'quantum' | 'bio' | 'amber' | 'rose';
  className?: string;
}

const SIZE_CLS = {
  xs: 'h-1.5 w-1.5',
  sm: 'h-2.5 w-2.5',
  md: 'h-3.5 w-3.5',
} as const;

const TONE_CLS = {
  quantum: { dot: 'bg-quantum-400', ping: 'bg-quantum-400/60' },
  bio: { dot: 'bg-bio-500', ping: 'bg-bio-500/60' },
  amber: { dot: 'bg-amber-400', ping: 'bg-amber-400/60' },
  rose: { dot: 'bg-rose-500', ping: 'bg-rose-500/60' },
} as const;

export function PulseDot({
  active = false,
  size = 'sm',
  tone = 'quantum',
  className,
}: PulseDotProps) {
  const sz = SIZE_CLS[size];
  const t = TONE_CLS[tone];
  return (
    <span
      className={cn(
        'relative inline-flex shrink-0 rounded-full',
        sz,
        active ? t.dot : 'bg-slate-600',
        className,
      )}
      aria-hidden="true"
    >
      {active && <span className={cn('absolute inset-0 animate-ping rounded-full', t.ping)} />}
    </span>
  );
}
