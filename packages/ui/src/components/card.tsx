import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../cn.ts';

/**
 * Card — surface primitive.
 *
 * Audit slice 2: padding density now lives in a `density` prop instead
 * of every caller picking p-3 / p-4 / p-5 / p-6 ad hoc. Three pinned
 * options drive the spacing rhythm:
 *
 *   tight    p-2 — list items, dense tabs
 *   cozy     p-4 — DEFAULT · most cards
 *   spacious p-6 — hero sections, modals
 *
 * The legacy `className="p-X"` overrides still work — the prop just
 * sets the default. Existing callers passing `p-3` keep the old look.
 */

export type CardDensity = 'tight' | 'cozy' | 'spacious';
export type CardTone = 'default' | 'pass' | 'warn' | 'fail' | 'star';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Glow ring on focus-within / hover. Off for static cards. */
  interactive?: boolean;
  tone?: CardTone;
  density?: CardDensity;
  children: ReactNode;
}

const TONE: Record<CardTone, string> = {
  default: 'border-white/5 bg-ink-950/60',
  pass: 'border-bio-400/30 bg-bio-500/[0.03]',
  warn: 'border-amber-400/30 bg-amber-500/[0.03]',
  fail: 'border-rose-400/30 bg-rose-500/[0.03]',
  star: 'border-quantum-400/40 bg-quantum-500/[0.05]',
};

const DENSITY: Record<CardDensity, string> = {
  tight: 'p-2',
  cozy: 'p-4',
  spacious: 'p-6',
};

export function Card({
  interactive = false,
  tone = 'default',
  density = 'cozy',
  className,
  children,
  ...rest
}: CardProps) {
  return (
    <div
      className={cn(
        'rounded-xl border backdrop-blur-md transition-colors',
        TONE[tone],
        DENSITY[density],
        interactive && 'hover:border-quantum-400/40 hover:bg-quantum-500/[0.04]',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
