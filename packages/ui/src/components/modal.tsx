import { type ReactNode, useCallback, useEffect, useRef } from 'react';
import { cn } from '../cn.ts';

// Inline X glyph — keeps @dr-abc/ui free of lucide-react. The app's
// lucide imports stay where they belong: in apps/web.
function XGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

/**
 * Modal — native <dialog> primitive.
 *
 * Audit slice 2: replaces the three ad-hoc `role="dialog"` overlays
 * across the app (recents-drawer, voice-cheat-sheet, real-case-list
 * modal) — each one had its own backdrop button + Escape handler +
 * `biome-ignore` on `useSemanticElements`. Native <dialog> gives us
 * the ARIA semantics + focus trap + escape-to-close for free.
 *
 * Why showModal vs show: showModal puts the dialog into the top
 * layer, traps focus inside, and dims the rest of the page via
 * `::backdrop`. Exactly what we want for blocking interactions.
 *
 * Composition:
 *   <Modal open onClose={...} title="Recent consults">
 *     ...content...
 *     <Modal.Footer>...</Modal.Footer>  // optional
 *   </Modal>
 */

export interface ModalProps {
  /** Controls visibility. The host owns the boolean. */
  open: boolean;
  /** Called when the user dismisses (Escape, backdrop click, X). */
  onClose: () => void;
  /** Optional headline. Set null to hide the header entirely. */
  title?: ReactNode;
  /** Optional supporting line under the title. */
  subtitle?: ReactNode;
  /** Modal width — default `lg`. */
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'fit';
  /** When true, skip the close button. Use for confirm-only flows. */
  hideCloseButton?: boolean;
  /** Optional footer slot — sits flush at the bottom, outside the
   *  body's scroll area. Use for action rows or hint copy. */
  footer?: ReactNode;
  children: ReactNode;
}

const SIZE: Record<NonNullable<ModalProps['size']>, string> = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  fit: 'max-w-fit',
};

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  size = 'lg',
  hideCloseButton = false,
  footer,
  children,
}: ModalProps) {
  const ref = useRef<HTMLDialogElement | null>(null);

  // Sync open state with showModal/close. Native <dialog> drives focus
  // trap + ARIA modal semantics + Escape handling for free.
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
    } else if (!open && d.open) {
      d.close();
    }
  }, [open]);

  // Wire the dialog's `cancel` event (Escape pressed) to onClose so
  // the host's open-state stays in sync.
  const onCancel = useCallback(
    (e: React.SyntheticEvent<HTMLDialogElement>) => {
      e.preventDefault();
      onClose();
    },
    [onClose],
  );

  // Backdrop-click closes — the dialog element itself is the visual
  // card; clicks landing on it (rather than its inner content) come
  // from the ::backdrop pseudo and bubble up here.
  const onBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDialogElement>) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard dismissal lands via the dialog's `cancel` event (Escape), wired above. The onClick is BACKDROP-only — a click on the dialog content doesn't bubble here, so there's no equivalent "key" interaction to mirror.
    <dialog
      ref={ref}
      onCancel={onCancel}
      onClick={onBackdropClick}
      className={cn(
        // Reset native dialog styling so our card design takes over.
        // backdrop:* targets the ::backdrop pseudo without ::backdrop syntax.
        'rounded-xl border border-app-subtle bg-surface-strong p-0 text-app-primary backdrop:bg-black/60 backdrop:backdrop-blur-sm',
        // Open transition — fade + lift.
        'open:animate-in open:fade-in-0 open:zoom-in-95 open:duration-200',
        'w-full',
        SIZE[size],
      )}
    >
      <div className="flex max-h-[85vh] min-h-0 flex-col">
        {(title || !hideCloseButton) && (
          <header className="flex items-baseline justify-between gap-3 border-b border-app-subtle px-5 py-3">
            <div>
              {title && (
                <h3 className="font-display text-lg font-bold text-app-primary">{title}</h3>
              )}
              {subtitle && (
                <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
                  {subtitle}
                </p>
              )}
            </div>
            {!hideCloseButton && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="rounded p-1 text-app-faint transition hover:bg-white/5 hover:text-app-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-quantum-400/70"
              >
                <XGlyph className="h-4 w-4" />
              </button>
            )}
          </header>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
        {footer && (
          <div className="flex flex-wrap items-center gap-2 border-app-subtle border-t bg-black/20 px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </dialog>
  );
}

/** Modal footer — sits flush against the bottom edge. */
function ModalFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-end gap-2 border-t border-app-subtle bg-black/20 px-5 py-3',
        className,
      )}
    >
      {children}
    </div>
  );
}

Modal.Footer = ModalFooter;
