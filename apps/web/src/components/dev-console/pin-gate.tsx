import { Card, cn } from '@dr-abc/ui';
import { Fingerprint, Lock, Shield } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import {
  DEV_PIN_DEFAULT,
  isDevConsoleUnlocked,
  isPasskeyEnrolled,
  isPasskeySupported,
  lockDevConsole,
  verifyPasskey,
  verifyPin,
} from '../../lib/dev-lock.ts';

/**
 * PinGate — wraps the dev-console page. Renders a centred PIN-entry
 * card until the user enters the correct 4-8 digit PIN; then renders
 * `children` (the actual dev console).
 *
 * The fingerprint icon nods at the future WebAuthn upgrade path; today
 * it's a friendly visual for the PIN gate.
 */
export function PinGate({ children }: { children: ReactNode }) {
  const [unlocked, setUnlocked] = useState(false);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const [hasPasskey, setHasPasskey] = useState(false);

  useEffect(() => {
    setUnlocked(isDevConsoleUnlocked());
    setHasPasskey(isPasskeySupported() && isPasskeyEnrolled());
  }, []);

  const tryPasskey = async () => {
    setError(null);
    const ok = await verifyPasskey();
    if (ok) {
      setUnlocked(true);
    } else {
      setError('Passkey check failed.');
      setShake(true);
      setTimeout(() => setShake(false), 400);
    }
  };

  const tryUnlock = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const ok = verifyPin(pin);
    if (ok) {
      setUnlocked(true);
      setError(null);
    } else {
      setError('Wrong PIN.');
      setShake(true);
      setTimeout(() => setShake(false), 400);
    }
    setPin('');
  };

  if (unlocked) {
    return (
      <>
        {children}
        <button
          type="button"
          onClick={() => {
            lockDevConsole();
            setUnlocked(false);
          }}
          title="Lock dev console"
          className="fixed right-4 bottom-16 z-30 inline-flex items-center gap-1.5 rounded-full border border-app-subtle bg-black/70 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-app-muted backdrop-blur transition hover:border-rose-400/40 hover:text-rose-300"
        >
          <Lock className="h-3 w-3" /> lock dev
        </button>
      </>
    );
  }

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4">
      <Card
        className={cn(
          'relative w-full max-w-md overflow-hidden p-8 transition',
          shake && 'animate-[shake_0.4s]',
        )}
      >
        {/* Decorative bio-tick + radial */}
        <div className="-translate-x-1/2 pointer-events-none absolute top-0 left-1/2 h-32 w-32 rounded-full bg-quantum-400/15 blur-3xl" />
        <div className="-translate-x-1/2 pointer-events-none absolute top-0 left-1/2 h-px w-32 bg-gradient-to-r from-transparent via-quantum-400 to-transparent" />

        <div className="flex flex-col items-center gap-3 text-center">
          <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl border border-quantum-400/40 bg-quantum-500/10">
            <Fingerprint className="h-7 w-7 text-quantum-300" />
          </div>
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.32em] text-quantum-300">
              <Shield className="mr-1 inline h-3 w-3" /> dev console · locked
            </div>
            <h2 className="mt-1 font-display text-2xl font-bold text-app-primary">
              Enter your PIN to unlock.
            </h2>
            <p className="mt-1 font-sans text-xs text-app-muted">
              The dev console exposes runtime env editing, live system probes, and learning
              controls. PIN gate keeps the patient-facing surface clean.
            </p>
          </div>
        </div>

        <form onSubmit={tryUnlock} className="mt-6 flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-app-muted">
              PIN · 4-8 digits
            </span>
            <input
              // biome-ignore lint/a11y/noAutofocus: PIN gate is the only thing on screen — autofocus is the right call
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
              className="w-full rounded-lg border border-app-subtle bg-black/30 px-4 py-3 text-center font-mono text-2xl tabular-nums tracking-[0.5em] text-app-primary placeholder:text-app-faint focus:border-quantum-400/60 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-quantum-400/70"
              placeholder="••••"
            />
          </label>
          {error && (
            <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 font-mono text-[11px] text-rose-300">
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={pin.length < 4}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-quantum-400/40 bg-quantum-500/15 px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.22em] text-quantum-200 transition hover:bg-quantum-500/25 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Lock className="h-3.5 w-3.5" /> unlock with PIN
          </button>
          {hasPasskey && (
            <button
              type="button"
              onClick={tryPasskey}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-bio-400/40 bg-bio-500/10 px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.22em] text-bio-200 transition hover:bg-bio-500/20"
            >
              <Fingerprint className="h-3.5 w-3.5" /> unlock with passkey
            </button>
          )}
        </form>

        <p className="mt-4 border-app-subtle border-t pt-3 font-mono text-[10px] text-app-faint">
          default PIN <code className="rounded bg-white/5 px-1.5 py-0.5">{DEV_PIN_DEFAULT}</code> ·
          rotate from inside the dev console
        </p>
      </Card>
      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20%, 60% { transform: translateX(-8px); }
          40%, 80% { transform: translateX(8px); }
        }
      `}</style>
    </div>
  );
}
