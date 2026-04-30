// ComingSoonNotice — friendly fallback for features that fail or
// aren't built yet. Used as an Error Boundary fallback AND as an
// explicit "not yet available" rendering.
//
// Centralised error and unavailable-feature handling: render a calm
// Mörbius notice instead of a broken screen when a surface errors or
// has not shipped yet.
//
// Two faces of Mörbius:
//   · `sad`  — for features that errored at runtime (something broke)
//   · `wave` — for features that aren't built yet (intentionally absent)
//
// Both surfaces carry a warm apology tone so a failed surface always
// degrades to a calm "this part is coming, here's what's next" message.

import { Card } from '@dr-abc/ui';
import { Brain, Construction, type LucideIcon, Sparkles } from 'lucide-react';

interface ComingSoonNoticeProps {
  /** Title — what the user was trying to do. */
  title?: string;
  /** What's actually happening (one short sentence). */
  message?: string;
  /** When this feature is expected · "next week", "v0.9", "after demo", etc. */
  eta?: string;
  /** Variant — sad = error fallback; wave = intentionally not built. */
  variant?: 'sad' | 'wave';
}

export function ComingSoonNotice({ title, message, eta, variant = 'wave' }: ComingSoonNoticeProps) {
  const isSad = variant === 'sad';
  const Face: LucideIcon = isSad ? Construction : Sparkles;
  const defaultTitle = isSad ? 'Something went sideways.' : 'Coming soon.';
  const defaultMessage = isSad
    ? "Mörbius hit an error trying to load this surface. Don't worry — the rest of the app is fine, and you can refresh to try again."
    : 'This part of Mörbius is in build. The architect is shipping it next; everything else is fully live.';
  return (
    <Card className="overflow-hidden p-6">
      <div className="flex flex-col items-center gap-4 text-center">
        {/* Mörbius face · stylised glyph stack */}
        <div className="relative">
          <div
            className={`relative flex h-20 w-20 items-center justify-center rounded-2xl border ${
              isSad
                ? 'border-amber-400/40 bg-amber-500/10'
                : 'border-quantum-400/40 bg-quantum-500/10'
            }`}
          >
            <Brain
              className={`h-10 w-10 ${isSad ? 'text-amber-300/70' : 'text-quantum-300'}`}
              strokeWidth={1.4}
            />
            <Face
              className={`absolute -right-2 -bottom-2 h-7 w-7 rounded-full border-2 border-app-strong p-1 ${
                isSad ? 'bg-amber-500/30 text-amber-200' : 'bg-quantum-500/30 text-quantum-200'
              }`}
            />
          </div>
        </div>
        <div className="max-w-md">
          <div
            className={`font-mono text-[10px] uppercase tracking-[0.32em] ${
              isSad ? 'text-amber-300' : 'text-quantum-300'
            }`}
          >
            {isSad ? 'mörbius · sorry, not available' : 'mörbius · in build'}
          </div>
          <h3 className="mt-1.5 font-display text-xl font-bold text-app-primary">
            {title ?? defaultTitle}
          </h3>
          <p className="mt-2 font-sans text-sm text-app-muted">{message ?? defaultMessage}</p>
          {eta && (
            <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-app-subtle bg-app-surface px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-app-secondary">
              <Sparkles className="h-3 w-3 text-quantum-300" /> eta · {eta}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

/**
 * FeatureErrorBoundary — wraps a feature panel and falls back to
 * ComingSoonNotice on uncaught render errors. The boundary catches
 * everything but surfaces errors in development for debugging; in
 * production it absorbs the error and renders the friendly notice.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface BoundaryProps {
  children: ReactNode;
  feature: string;
  eta?: string;
}

interface BoundaryState {
  error: Error | null;
}

export class FeatureErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  constructor(props: BoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Log to dev-tools but absorb in production, so users see the
    // friendly notice instead of a white-screen-of-death.
    if (typeof window !== 'undefined' && import.meta.env.DEV) {
      console.error(`[${this.props.feature}] boundary caught:`, error, info);
    }
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <ComingSoonNotice
          variant="sad"
          title={`${this.props.feature} hit a snag.`}
          message={this.state.error.message || 'Unexpected error. The rest of the app is fine.'}
          eta={this.props.eta ?? 'investigating'}
        />
      );
    }
    return this.props.children;
  }
}
