/**
 * @dr-abc/ui · design tokens
 *
 * The TS contract for the values the runtime CSS variables expose
 * (see apps/web/src/index.css). Components that need values at compile
 * time (e.g. a framer-motion duration prop) import from here. Runtime
 * theme switching still goes through `[data-mode]` and `[data-theme]`
 * + the new `[data-clinical-tint]` on `<html>`.
 *
 * Why both: CSS variables can't be read in static contexts (Tailwind
 * arbitrary-value strings, JS animation easings, framer-motion props).
 * Keeping the values in TS too means a single source of truth for the
 * common cases without duplicating the per-mode override logic.
 */

// ────────────────────────────────────────────────────────────
//  Spacing scale
//  Matches Tailwind's spacing rem-step but pinned by name so we
//  don't end up with `gap-2 / gap-3 / gap-4 / gap-5` drift.
// ────────────────────────────────────────────────────────────

export const space = {
  px: '1px',
  '2xs': '0.125rem', // 2px
  xs: '0.25rem', // 4px
  sm: '0.5rem', // 8px
  md: '0.75rem', // 12px
  lg: '1rem', // 16px
  xl: '1.5rem', // 24px
  '2xl': '2rem', // 32px
  '3xl': '3rem', // 48px
  '4xl': '4rem', // 64px
} as const;

// ────────────────────────────────────────────────────────────
//  Radius
// ────────────────────────────────────────────────────────────

export const radius = {
  none: '0',
  sm: '0.375rem', // 6px
  md: '0.5rem', // 8px
  lg: '0.75rem', // 12px — Card default
  xl: '1rem', // 16px
  '2xl': '1.5rem', // 24px
  full: '9999px',
} as const;

// ────────────────────────────────────────────────────────────
//  Shadows — matching the runtime CSS counterparts
// ────────────────────────────────────────────────────────────

export const shadow = {
  none: 'none',
  sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  md: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
  lg: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
  xl: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
  /** Soft cyan glow, used for active/focus accents on dark surfaces. */
  glow: '0 0 24px -8px currentColor',
  /** A11y focus ring — sits OUTSIDE the element so the border doesn't change shape. */
  focusRing: '0 0 0 3px var(--focus-ring, rgba(56,189,248,0.55))',
} as const;

// ────────────────────────────────────────────────────────────
//  Motion — easings + durations
//  Used by framer-motion props + custom rAF animations.
// ────────────────────────────────────────────────────────────

export const motion = {
  ease: {
    /** Default for entrances + lifts. Mörbius house easing. */
    out: [0.22, 1, 0.36, 1] as [number, number, number, number],
    /** Fast in, slow settle. Pin transitions. */
    inOut: [0.65, 0, 0.35, 1] as [number, number, number, number],
    /** Linear for progress bars + count-up. */
    linear: [0, 0, 1, 1] as [number, number, number, number],
  },
  duration: {
    /** Hover, focus ring fade — invisible if you blink. */
    instant: 80,
    /** Default UI transition. */
    fast: 180,
    /** Card lifts, page-fade-in. */
    medium: 320,
    /** Page-level reveals. */
    slow: 600,
  },
} as const;

// ────────────────────────────────────────────────────────────
//  Z-index scale — keeps overlays from racing each other
// ────────────────────────────────────────────────────────────

export const zIndex = {
  base: 0,
  dropdown: 10,
  sidebar: 20,
  topbar: 30,
  toast: 50,
  modal: 60,
  recents: 70,
  cheatSheet: 75,
  bootOverlay: 80,
} as const;

// ────────────────────────────────────────────────────────────
//  Color scales (50 → 900)
//
//  These are the canonical brand families. The CSS variables in
//  apps/web/src/index.css inherit from these (when we want compile-
//  time access) AND from Tailwind's @theme-inline mappings.
// ────────────────────────────────────────────────────────────

export const palette = {
  /** Cyan — "quantum" family · clinical · blue tint */
  blue: {
    50: '#ecfeff',
    100: '#cffafe',
    200: '#a5f3fc',
    300: '#67e8f9',
    400: '#22d3ee',
    500: '#06b6d4',
    600: '#0891b2',
    700: '#0e7490',
    800: '#155e75',
    900: '#164e63',
  },
  /** Green — "bio" family · clinical · green tint */
  green: {
    50: '#f0fdf4',
    100: '#dcfce7',
    200: '#bbf7d0',
    300: '#86efac',
    400: '#4ade80',
    500: '#22c55e',
    600: '#16a34a',
    700: '#15803d',
    800: '#166534',
    900: '#14532d',
  },
  /** Violet — clinical · purple tint */
  violet: {
    50: '#f5f3ff',
    100: '#ede9fe',
    200: '#ddd6fe',
    300: '#c4b5fd',
    400: '#a78bfa',
    500: '#8b5cf6',
    600: '#7c3aed',
    700: '#6d28d9',
    800: '#5b21b6',
    900: '#4c1d95',
  },
  /** Slate — neutrals shared across all themes */
  ink: {
    50: '#f8fafc',
    100: '#f1f5f9',
    200: '#e2e8f0',
    300: '#cbd5e1',
    400: '#94a3b8',
    500: '#64748b',
    600: '#475569',
    700: '#334155',
    800: '#1e293b',
    900: '#0f172a',
    950: '#020617',
  },
  /** Amber — warning state (validator gauntlet partial pass) */
  amber: {
    50: '#fffbeb',
    100: '#fef3c7',
    400: '#fbbf24',
    500: '#f59e0b',
    600: '#d97706',
    900: '#78350f',
  },
  /** Rose — error state (gauntlet fail, red flag) */
  rose: {
    50: '#fff1f2',
    100: '#ffe4e6',
    400: '#fb7185',
    500: '#f43f5e',
    600: '#e11d48',
    900: '#881337',
  },
} as const;

export type PaletteFamily = keyof typeof palette;
export type PaletteStep = keyof typeof palette.blue;

/**
 * Clinical-tint accent picks. The runtime CSS sets `--accent-{step}`
 * variables to one of these per the `data-clinical-tint` attribute on
 * `<html>` (see index.css). Components reading `var(--accent-500)`
 * get blue / green / violet without knowing which.
 */
export const CLINICAL_TINTS = {
  blue: palette.blue,
  green: palette.green,
  purple: palette.violet,
} as const;

export type ClinicalTint = keyof typeof CLINICAL_TINTS;

// ────────────────────────────────────────────────────────────
//  Typography scale — paired with the per-mode font-display
//  override in index.css. Body is Inter across all modes (the
//  audit doc consolidated this).
// ────────────────────────────────────────────────────────────

export const type = {
  size: {
    h1: '2.5rem', // 40px · page hero
    h2: '1.875rem', // 30px · section
    h3: '1.25rem', // 20px · card title
    h4: '1rem', // 16px · uppercase label
    body: '0.9375rem', // 15px · readable body
    caption: '0.75rem', // 12px · monospace meta
  },
  lineHeight: {
    h1: 1.1,
    h2: 1.2,
    h3: 1.3,
    h4: 1.4,
    body: 1.55,
    caption: 1.4,
  },
  letterSpacing: {
    tight: '-0.02em',
    normal: '0',
    label: '0.18em',
    mono: '0.22em',
  },
  weight: {
    regular: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
} as const;
