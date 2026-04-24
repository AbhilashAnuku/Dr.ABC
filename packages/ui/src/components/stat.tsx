import type { ComponentType, ReactNode } from 'react';
import { cn } from '../cn.ts';

/**
 * Stat — labelled number tile with optional trend.
 *
 * Audit slice 2: generalises the inline `<Stat>` shape that the
 * neural-core header rolls. Every numeric tile in the app should now
 * read `<Stat icon={...} label="..." value={42} delta="+3 today" trend="up" />`
 * for consistent typography + tabular-num alignment + delta tone.
 */

export interface StatProps {
  icon?: ComponentType<{ className?: string }>;
  label: ReactNode;
  value: ReactNode;
  /** Optional delta string ("+3 today", "−1.2 pp", …). */
  delta?: ReactNode;
  /** Drives the delta colour. `flat` is the neutral fallback. */
  trend?: 'up' | 'down' | 'flat';
  /** Compact = h6 size · default = h5 size. */
  size?: 'compact' | 'default';
  className?: string;
}

const TREND_TONE: Record<NonNullable<StatProps['trend']>, string> = {
  up: 'text-bio-300',
  down: 'text-rose-300',
  flat: 'text-app-faint',
};

export function Stat({
  icon: Icon,
  label,
  value,
  delta,
  trend = 'flat',
  size = 'default',
  className,
}: StatProps) {
  const valueClass =
    size === 'compact'
      ? 'font-syne text-lg font-bold tabular-nums text-app-primary'
      : 'font-syne text-2xl font-bold tabular-nums text-app-primary';
  return (
    <div
      className={cn(
        'rounded-lg border border-app-subtle bg-black/30 p-3 backdrop-blur transition hover:border-quantum-400/40',
        className,
      )}
    >
      <div className="flex items-center gap-1.5">
        {Icon && <Icon className="h-3 w-3 text-app-faint" />}
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
          {label}
        </span>
      </div>
      <div className="mt-1 flex items-baseline justify-between gap-2">
        <span className={valueClass}>{value}</span>
        {delta !== undefined && (
          <span className={cn('font-mono text-[10px] tabular-nums', TREND_TONE[trend])}>
            {delta}
          </span>
        )}
      </div>
    </div>
  );
}
