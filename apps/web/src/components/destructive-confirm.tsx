import { Button, Modal, cn } from '@dr-abc/ui';
import { Fingerprint, Lock, ShieldAlert } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import {
  isPasskeyEnrolled,
  isPasskeySupported,
  verifyPasskey,
  verifyPin,
} from '../lib/dev-lock.ts';

/**
 * DestructiveConfirm — re-auth gate for destructive actions.
 *
 * Deleting a data profile requires a password or biometric
 * confirmation before the destructive action proceeds.
 *
 * Reuses the dev-lock PIN + passkey infrastructure so there's only
 * one credential surface in the app. The user must re-prove identity
 * (PIN entry OR Touch ID / Windows Hello / Android fingerprint) before
 * the destructive `onConfirm` callback fires.
 *
 * Properties:
 *   - title       — modal title (e.g., "Delete medical record")
 *   - description — warning copy (what data is wiped)
 *   - actionLabel — confirm button text (e.g., "Delete forever")
 *   - onConfirm   — called once auth succeeds
 *   - children    — render-prop receives openConfirm to wire to triggers
 *
 * Usage:
 *   <DestructiveConfirm
 *     title="Delete medical record"
 *     description="Wipes demographics, allergies, meds, conditions,
 *                  and every saved consult. Cannot be undone."
 *     actionLabel="Delete forever"
 *     onConfirm={() => purgeRecord(user.id)}
 *   >
 *     {(open) => (
 *       <Button variant="ghost" onClick={open}>Delete account</Button>
 *     )}
 *   </DestructiveConfirm>
 */

export interface DestructiveConfirmProps {
  title: string;
  description: ReactNode;
  actionLabel: string;
  onConfirm: () => void | Promise<void>;
  children: (openConfirm: () => void) => ReactNode;
}

export function DestructiveConfirm({
  title,
  description,
  actionLabel,
  onConfirm,
  children,
}: DestructiveConfirmProps) {
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const hasPasskey = isPasskeySupported() && isPasskeyEnrolled();

  const reset = () => {
    setPin('');
    setError(null);
    setBusy(false);
  };

  const close = () => {
    setOpen(false);
    reset();
  };

  const tryPin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (busy) return;
    if (!verifyPin(pin)) {
      setError('PIN incorrect.');
      setPin('');
      return;
    }
    await runConfirm();
  };

  const tryPasskey = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const ok = await verifyPasskey();
    if (!ok) {
      setError('Passkey check failed.');
      setBusy(false);
      return;
    }
    await runConfirm();
  };

  const runConfirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {children(() => {
        reset();
        setOpen(true);
      })}
      <Modal
        open={open}
        onClose={close}
        title={title}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => void tryPin()}
              disabled={busy || pin.length < 4}
              className={cn('bg-rose-500/30 hover:bg-rose-500/40', busy && 'opacity-60')}
            >
              <Lock className="mr-1.5 h-3.5 w-3.5" /> {actionLabel}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-3 rounded-xl border border-rose-500/40 bg-rose-500/10 p-4">
            <ShieldAlert className="h-5 w-5 shrink-0 text-rose-300" aria-hidden="true" />
            <div className="space-y-1 font-sans text-sm text-rose-100/95">
              <div className="font-semibold">This cannot be undone.</div>
              <div className="text-rose-100/80">{description}</div>
            </div>
          </div>

          <form onSubmit={tryPin} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-app-muted">
                Re-enter PIN to confirm
              </span>
              <input
                // biome-ignore lint/a11y/noAutofocus: re-auth modal — focus is intentional
                autoFocus
                value={pin}
                onChange={(e) => {
                  setPin(e.target.value.replace(/\D/g, '').slice(0, 8));
                  setError(null);
                }}
                type="password"
                inputMode="numeric"
                autoComplete="off"
                maxLength={8}
                disabled={busy}
                className="w-full rounded-lg border border-app-subtle bg-black/30 px-4 py-3 text-center font-mono text-2xl tabular-nums tracking-[0.5em] text-app-primary placeholder:text-app-faint focus:border-rose-400/60 focus:outline-none"
                placeholder="••••"
              />
            </label>
            {error && (
              <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 font-mono text-[11px] text-rose-300">
                {error}
              </div>
            )}
            {hasPasskey && (
              <button
                type="button"
                onClick={() => void tryPasskey()}
                disabled={busy}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-bio-400/40 bg-bio-500/10 px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.22em] text-bio-200 transition hover:bg-bio-500/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Fingerprint className="h-3.5 w-3.5" /> use passkey instead
              </button>
            )}
          </form>
        </div>
      </Modal>
    </>
  );
}
