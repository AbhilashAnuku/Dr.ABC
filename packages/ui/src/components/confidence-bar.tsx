import { cn } from '../cn.ts';

export interface ConfidenceBarProps {
  /** Value in [0, 1]. Out-of-range inputs are clamped. */
  value: number;
  /** Whether to render the right-side numeric label. */
  showLabel?: boolean;
  className?: string;
}

/**
 * A 100%-width bar that fills to `value`. Color goes red→amber→bio
 * based on the value so the reader doesn't have to read the number to
 * know if the agent is confident.
 */
export function ConfidenceBar({ value, showLabel = true, className }: ConfidenceBarProps) {
  const v = Math.max(0, Math.min(1, value));
  const pct = Math.round(v * 100);
  const tone = v >= 0.7 ? 'bg-bio-500' : v >= 0.5 ? 'bg-amber-400' : 'bg-rose-500';
  const ring =
    v >= 0.7 ? 'shadow-bio-500/30' : v >= 0.5 ? 'shadow-amber-400/30' : 'shadow-rose-500/30';
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-white/5">
        <div
          className={cn(
            'h-full rounded-full shadow-inner transition-[width] duration-500',
            tone,
            ring,
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      {showLabel && (
        <span className="font-mono text-[11px] tabular-nums text-slate-300">{pct}%</span>
      )}
    </div>
  );
}
