import type { FormHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { cn } from '../cn.ts';
import { PulseDot } from './pulse-dot.tsx';

export interface ConsultInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'children' | 'onSubmit'> {
  /** Whether the orchestrator is currently streaming (drives the pulse + lock state). */
  streaming?: boolean;
  /** Slot rendered to the right of the input — typically a Button. */
  rightSlot?: ReactNode;
  /** Form-level submit handler — keeps the consumer simple. */
  onSubmit?: FormHTMLAttributes<HTMLFormElement>['onSubmit'];
}

/**
 * The signature consult-input bar from the Mörbius hero — a glowing
 * cyan-ringed input with a pulse dot and a primary submit button.
 *
 * Composition:
 *   <ConsultInput streaming={...} value={...} onChange={...} rightSlot={<Button .../>}>
 */
export function ConsultInput({
  streaming = false,
  rightSlot,
  onSubmit,
  className,
  disabled,
  ...inputProps
}: ConsultInputProps) {
  return (
    <form onSubmit={onSubmit} className={cn('group relative', className)}>
      <div
        className={cn(
          'pointer-events-none absolute -inset-px rounded-2xl opacity-60 blur-md transition',
          'bg-linear-to-r from-quantum-500/40 via-bio-500/20 to-quantum-500/40',
          'group-focus-within:opacity-100',
        )}
      />
      <div className="relative flex items-center gap-3 rounded-2xl border border-white/10 bg-ink-950/80 px-5 py-4 backdrop-blur-xl">
        <PulseDot active={streaming} />
        <input
          type="text"
          disabled={disabled || streaming}
          className={cn(
            'flex-1 bg-transparent font-sans text-base text-slate-100 placeholder:text-slate-500',
            'focus:outline-none disabled:cursor-not-allowed',
          )}
          {...inputProps}
        />
        {rightSlot}
      </div>
    </form>
  );
}
