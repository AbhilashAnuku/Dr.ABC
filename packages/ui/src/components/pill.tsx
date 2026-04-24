import type { ComponentType, ReactNode } from 'react';
import { cn } from '../cn.ts';

/**
 * Pill — color-tag chip.
 *
 * Audit slice 2: replaces the
 *   `inline-flex items-center gap-1 rounded-full border border-bio-400/40
 *    bg-bio-500/10 px-2 py-0.5 font-mono text-[10px] uppercase
 *    tracking-[0.22em] text-bio-200`
 * string that ships in 8+ places. Six tones, two sizes, optional
 * icon — covers every existing chip use without bespoke Tailwind.
 *
 * Tones map to semantic state, not raw colour, so the clinical-tint
 * accent can later swap them without each call site changing.
 *
 * Audit slice 7 a11y: every Pill now defaults to a tone-appropriate
 * status glyph (✓ ⚠ ✗ ● i ★). Colourblind users no longer have to
 * distinguish state by hue — the SHAPE carries the meaning too.
 * Pass `icon` to override; pass `icon={null}` to suppress.
 */

export type PillTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';
export type PillSize = 'xs' | 'sm';

type IconOverride = ComponentType<{ className?: string }> | null;

export interface PillProps {
  tone?: PillTone;
  size?: PillSize;
  /** Override the default tone glyph. Pass `null` to suppress entirely. */
  icon?: IconOverride;
  children: ReactNode;
  className?: string;
}

// ────────────────────────────────────────────────────────────
//  Default tone glyphs — inline SVG so @dr-abc/ui stays lucide-free.
// ────────────────────────────────────────────────────────────

function GlyphCheck({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="m3 8 3 3 7-7" />
    </svg>
  );
}

function GlyphAlert({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M8 1.5 14.5 14h-13L8 1.5Z" />
      <path d="M8 6v4" />
      <path d="M8 12.5h.01" />
    </svg>
  );
}

function GlyphX({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M3 3l10 10M13 3 3 13" />
    </svg>
  );
}

function GlyphInfo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6.5" />
      <path d="M8 11V7" />
      <path d="M8 4.5h.01" />
    </svg>
  );
}

function GlyphSpark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M8 1.5v13M1.5 8h13M3.2 3.2l9.6 9.6M12.8 3.2l-9.6 9.6" />
    </svg>
  );
}

function GlyphDot({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true">
      <circle cx="8" cy="8" r="3" fill="currentColor" />
    </svg>
  );
}

const TONE_DEFAULT_ICON: Record<PillTone, ComponentType<{ className?: string }>> = {
  neutral: GlyphDot,
  accent: GlyphSpark,
  success: GlyphCheck,
  warning: GlyphAlert,
  danger: GlyphX,
  info: GlyphInfo,
};

const TONE: Record<PillTone, string> = {
  neutral: 'border-app-subtle bg-white/5 text-app-secondary',
  accent: 'border-quantum-400/40 bg-quantum-500/10 text-quantum-200',
  success: 'border-bio-400/40 bg-bio-500/10 text-bio-200',
  warning: 'border-amber-400/40 bg-amber-500/10 text-amber-200',
  danger: 'border-rose-400/40 bg-rose-500/10 text-rose-200',
  info: 'border-blue-400/40 bg-blue-500/10 text-blue-200',
};

const SIZE: Record<PillSize, string> = {
  xs: 'gap-1 px-1.5 py-0.5 text-[9px]',
  sm: 'gap-1.5 px-2 py-0.5 text-[10px]',
};

const ICON_SIZE: Record<PillSize, string> = {
  xs: 'h-2.5 w-2.5',
  sm: 'h-3 w-3',
};

export function Pill({ tone = 'neutral', size = 'sm', icon, children, className }: PillProps) {
  // Resolve icon: explicit prop wins (including null = suppress);
  // otherwise default-glyph-by-tone for colourblind a11y.
  const Icon: ComponentType<{ className?: string }> | null =
    icon === undefined ? TONE_DEFAULT_ICON[tone] : icon;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border font-mono uppercase tracking-[0.22em]',
        TONE[tone],
        SIZE[size],
        className,
      )}
    >
      {Icon && <Icon className={ICON_SIZE[size]} />}
      {children}
    </span>
  );
}
