import type { InputHTMLAttributes, ReactNode } from 'react';
import { useId } from 'react';
import { cn } from '../cn.ts';

/**
 * TextField — labelled text input primitive.
 *
 * Audit slice 2: kills the Tailwind-string repetition that ships
 * across multiple files (clinic, security-settings, real-case-list,
 * recents-drawer, multimodal-dropzone, …). One component, one focus
 * style, one error state, one helper-text rhythm.
 *
 * Why a separate name from the existing `ConsultInput`: that one is
 * the specialized hero-style input with pulse dot + glow ring.
 * `TextField` is the everyday labelled input.
 */

export type TextFieldSize = 'sm' | 'md';

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** Visible label above the field. */
  label?: ReactNode;
  /** Helper text under the field. Hidden when `error` is set. */
  helperText?: ReactNode;
  /** Error state. Replaces helperText, switches focus ring to rose. */
  error?: ReactNode;
  /** Visual size — sm = h-8 / md = h-10. Matches Button sizes. */
  size?: TextFieldSize;
  /** Optional icon at the start of the field. */
  leadingIcon?: ReactNode;
  /** Optional element at the end (icon button, suffix). */
  trailingSlot?: ReactNode;
}

const SIZE: Record<TextFieldSize, string> = {
  sm: 'h-8 text-xs',
  md: 'h-10 text-sm',
};

const PADDING_WITH_LEADING: Record<TextFieldSize, string> = {
  sm: 'pl-8',
  md: 'pl-10',
};

const ICON_POS: Record<TextFieldSize, string> = {
  sm: 'left-2.5 h-3.5 w-3.5',
  md: 'left-3 h-4 w-4',
};

export function TextField({
  label,
  helperText,
  error,
  size = 'md',
  leadingIcon,
  trailingSlot,
  className,
  id: idProp,
  ...rest
}: TextFieldProps) {
  const generated = useId();
  const id = idProp ?? generated;
  const helperId = `${id}-helper`;
  const errorId = `${id}-error`;

  return (
    <div className={cn('flex w-full flex-col gap-1', className)}>
      {label && (
        <label
          htmlFor={id}
          className="font-mono text-[10px] uppercase tracking-[0.22em] text-app-muted"
        >
          {label}
        </label>
      )}
      <div className="relative flex items-center">
        {leadingIcon && (
          <span
            className={cn('pointer-events-none absolute text-app-faint', ICON_POS[size])}
            aria-hidden
          >
            {leadingIcon}
          </span>
        )}
        <input
          id={id}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? errorId : helperText ? helperId : undefined}
          className={cn(
            'w-full rounded-lg border bg-black/30 px-3 font-sans text-app-primary',
            'placeholder:text-app-faint',
            'transition-[border-color,box-shadow] duration-150 ease-out',
            'focus:outline-none focus-visible:outline-none',
            SIZE[size],
            leadingIcon && PADDING_WITH_LEADING[size],
            trailingSlot && 'pr-10',
            error
              ? 'border-rose-500/50 focus-visible:border-rose-400/70 focus-visible:shadow-[0_0_0_3px_rgba(244,63,94,0.25)]'
              : 'border-app-subtle focus-visible:border-quantum-400/60 focus-visible:shadow-[0_0_0_3px_rgba(34,211,238,0.25)]',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
          {...rest}
        />
        {trailingSlot && (
          <div className="absolute right-2 inline-flex items-center">{trailingSlot}</div>
        )}
      </div>
      {error ? (
        <p id={errorId} role="alert" className="font-mono text-[10px] text-rose-300">
          {error}
        </p>
      ) : helperText ? (
        <p id={helperId} className="font-mono text-[10px] text-app-faint">
          {helperText}
        </p>
      ) : null}
    </div>
  );
}
