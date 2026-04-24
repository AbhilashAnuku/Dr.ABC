import { type ElementType, type ReactNode, createElement } from 'react';
import { cn } from '../cn.ts';

/**
 * Typography primitives — vertical-rhythm scale per the audit.
 *
 * Replaces the per-route drift across the app:
 *   `text-3xl sm:text-4xl`  (landing hero)
 *   `text-3xl sm:text-5xl`  (neural-core hero)
 *   `text-2xl sm:text-3xl`  (some sections)
 *   `text-xl`               (cards)
 *   …
 *
 * One scale, one set of components, every route reads the same. Each
 * primitive accepts an `as` prop so you can keep the semantic HTML
 * (h1 inside hero, h2 inside section, etc.) without losing the
 * styling.
 *
 * Sizes mirror the type token bundle in tokens.ts:
 *   H1 → 2.5rem (40px) · -0.02em · 1.1
 *   H2 → 1.875rem (30px) · -0.015em · 1.2
 *   H3 → 1.25rem (20px) · normal · 1.3
 *   H4 → 1rem (16px) · 0.18em · 1.4 · uppercase  ← labels/kickers
 *   Body → 0.9375rem (15px) · normal · 1.55
 *   Caption → 0.75rem (12px) · 0.22em · 1.4 · monospace
 *
 * font-display is the per-mode swap variable from index.css (Cormorant
 * for clinical, Syne for synthwave/cobalt, Playfair for aurora).
 */

interface TypographyProps {
  as?: ElementType;
  children: ReactNode;
  className?: string;
  // biome-ignore lint/suspicious/noExplicitAny: ElementType branches HTMLElement, SVGElement, …; passing extra HTML attributes is the whole point.
  [key: string]: any;
}

/**
 * Render a typography primitive via createElement so the polymorphic
 * `as` prop doesn't run into TypeScript's narrowed children type
 * (which goes to `never` for void elements). One pattern, six exports.
 */
function tag(
  defaultTag: ElementType,
  twClasses: string,
  { as = defaultTag, className, children, ...rest }: TypographyProps,
) {
  return createElement(as, { className: cn(twClasses, className), ...rest }, children);
}

export function H1(props: TypographyProps) {
  return tag(
    'h1',
    'font-display font-bold leading-[1.1] tracking-[-0.02em] text-app-primary text-[2.5rem]',
    props,
  );
}

export function H2(props: TypographyProps) {
  return tag(
    'h2',
    'font-display font-semibold leading-[1.2] tracking-[-0.015em] text-app-primary text-[1.875rem]',
    props,
  );
}

export function H3(props: TypographyProps) {
  return tag(
    'h3',
    'font-display font-semibold leading-[1.3] text-app-primary text-[1.25rem]',
    props,
  );
}

/**
 * H4 — uppercase eyebrow / kicker label. Use for the "<Sparkles> ·
 * label" rows above section headlines.
 */
export function H4(props: TypographyProps) {
  return tag(
    'h4',
    'font-mono text-[10px] font-medium uppercase tracking-[0.18em] leading-[1.4] text-app-muted',
    props,
  );
}

/**
 * Body — readable paragraph text. 15px / 1.55 line-height. Use for
 * everything that's neither a heading nor a metadata caption.
 */
export function Body(props: TypographyProps) {
  return tag('p', 'font-sans text-[0.9375rem] leading-[1.55] text-app-secondary', props);
}

/**
 * Caption — monospaced metadata: timestamps, IDs, source labels,
 * confidence pills, anything that wants the tabular feel.
 */
export function Caption(props: TypographyProps) {
  return tag(
    'span',
    'font-mono text-[0.75rem] uppercase tracking-[0.22em] leading-[1.4] text-app-faint',
    props,
  );
}
