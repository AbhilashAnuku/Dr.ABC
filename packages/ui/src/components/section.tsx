import type { ComponentType, HTMLAttributes, ReactNode } from 'react';
import { cn } from '../cn.ts';

/**
 * Section — page-level vertical-rhythm wrapper.
 *
 * Audit slice 6: replaces the per-route `<header>` boilerplate that
 * ships across architecture.tsx · case-library.tsx · clinic.tsx ·
 * neural-core.tsx · landing.tsx · etc. Each one rolls its own:
 *
 *   <div className="inline-flex items-center gap-2 ...">
 *     <Icon /> <span className="font-mono text-[10px] uppercase ...">label</span>
 *   </div>
 *   <h1 className="font-display text-3xl ...">Title.</h1>
 *   <p className="font-sans text-sm text-app-muted ...">Blurb.</p>
 *
 * One component, one rhythm, every page reads the same. Children
 * land in a `space-y-4` container under the header.
 *
 * Composition:
 *   <Section
 *     kicker="architecture · how Mörbius is wired"
 *     icon={Workflow}
 *     title="The actual flow."
 *     description="Every node here points at the file that implements it."
 *   >
 *     ...content...
 *   </Section>
 */

export interface SectionProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  /** Uppercase eyebrow label above the headline. Mono, tracked-out. */
  kicker?: ReactNode;
  /** Optional kicker icon. Renders before the kicker text. */
  icon?: ComponentType<{ className?: string }>;
  /** Section headline. The semantic <h1> for the page or section. */
  title: ReactNode;
  /** Body element to use for the title — defaults to h1. Use `h2`
   *  inside a page that already has an h1. */
  titleAs?: 'h1' | 'h2' | 'h3';
  /** Optional one-paragraph supporting copy under the title. */
  description?: ReactNode;
  /** Header layout — default `block` stacks the title + description.
   *  `inline` keeps everything in one row for compact pages. */
  variant?: 'block' | 'inline';
  /** Vertical-spacing between header + body. Default `lg` (24px). */
  gap?: 'md' | 'lg' | 'xl';
  /** Body content. */
  children?: ReactNode;
}

const TITLE_SIZE: Record<NonNullable<SectionProps['titleAs']>, string> = {
  h1: 'font-display text-3xl font-bold text-app-primary sm:text-4xl',
  h2: 'font-display text-2xl font-bold text-app-primary sm:text-3xl',
  h3: 'font-display text-xl font-semibold text-app-primary',
};

const GAP: Record<NonNullable<SectionProps['gap']>, string> = {
  md: 'space-y-4',
  lg: 'space-y-6',
  xl: 'space-y-8',
};

export function Section({
  kicker,
  icon: Icon,
  title,
  titleAs = 'h1',
  description,
  variant = 'block',
  gap = 'lg',
  className,
  children,
  ...rest
}: SectionProps) {
  const TitleTag = titleAs;
  return (
    <section className={cn(GAP[gap], className)} {...rest}>
      <header className={variant === 'inline' ? 'flex flex-wrap items-baseline gap-3' : ''}>
        {kicker && (
          <div className="inline-flex items-center gap-2 rounded-full border border-quantum-400/30 bg-quantum-500/10 px-3 py-1">
            {Icon && <Icon className="h-3 w-3 text-quantum-300" />}
            <span className="font-mono text-[10px] uppercase tracking-[0.32em] text-quantum-300">
              {kicker}
            </span>
          </div>
        )}
        <TitleTag className={cn(variant === 'block' && 'mt-2', TITLE_SIZE[titleAs])}>
          {title}
        </TitleTag>
        {description && (
          <p
            className={cn(
              'max-w-3xl font-sans text-sm text-app-muted sm:text-base',
              variant === 'block' && 'mt-2',
            )}
          >
            {description}
          </p>
        )}
      </header>
      {children}
    </section>
  );
}
