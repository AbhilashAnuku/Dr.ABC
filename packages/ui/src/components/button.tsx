import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../cn.ts';

/**
 * Button — 3 sizes × 4 variants × loading state.
 *
 * Audit slice 2: replaces the ad-hoc Tailwind-string buttons that ship
 * across multiple files (each with its own height + padding rhythm).
 * Three pinned sizes (h-7 / h-8 / h-10) keep the visual jitter out.
 *
 * Variants:
 *   primary      — main action, gradient fill, glow
 *   secondary    — alternate action, surface fill
 *   ghost        — low-emphasis, transparent
 *   destructive  — irreversible action (delete, lock, force-reset)
 *
 * States:
 *   idle / hover / active / focus-visible / loading / disabled
 *
 * Loading swaps the leading-icon slot with a CSS spinner and locks
 * the click; the button STAYS at full size so the layout doesn't jump.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
export type ButtonSize = 'xs' | 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** When true, click is locked + a spinner replaces the leading icon. */
  loading?: boolean;
  /** Optional icon at the start of the button. Spinner replaces it when loading. */
  leadingIcon?: ReactNode;
  /** Optional icon at the end of the button. */
  trailingIcon?: ReactNode;
  children: ReactNode;
}

const BASE =
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-sans font-semibold ' +
  'transition-[background-color,border-color,box-shadow,opacity] duration-150 ease-out ' +
  'focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-quantum-400/70 ' +
  'disabled:cursor-not-allowed disabled:opacity-40';

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'rounded-lg bg-gradient-to-r from-quantum-500 to-quantum-400 text-ink-950 ' +
    'shadow-md shadow-quantum-500/25 hover:shadow-lg hover:shadow-quantum-500/40 ' +
    'active:from-quantum-600 active:to-quantum-500',
  secondary:
    'rounded-lg border border-app-subtle bg-white/5 text-app-primary ' +
    'hover:border-quantum-400/40 hover:bg-white/10 active:bg-white/15',
  ghost:
    'rounded-lg bg-transparent text-app-secondary hover:bg-white/5 hover:text-app-primary active:bg-white/10',
  destructive:
    'rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-200 ' +
    'hover:border-rose-400/60 hover:bg-rose-500/20 active:bg-rose-500/30',
};

const SIZES: Record<ButtonSize, string> = {
  xs: 'h-7 px-2.5 text-[11px]',
  sm: 'h-8 px-3 text-xs',
  md: 'h-10 px-5 text-sm',
};

const ICON_SIZE: Record<ButtonSize, string> = {
  xs: 'h-3 w-3',
  sm: 'h-3.5 w-3.5',
  md: 'h-4 w-4',
};

function Spinner({ size }: { size: ButtonSize }) {
  return (
    <svg
      className={cn('animate-spin', ICON_SIZE[size])}
      viewBox="0 0 24 24"
      fill="none"
      role="img"
      aria-label="Loading"
    >
      <title>Loading</title>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path
        d="M22 12a10 10 0 0 1-10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  leadingIcon,
  trailingIcon,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={rest.type ?? 'button'}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(BASE, VARIANTS[variant], SIZES[size], className)}
      {...rest}
    >
      {loading ? <Spinner size={size} /> : leadingIcon}
      {children}
      {!loading && trailingIcon}
    </button>
  );
}
