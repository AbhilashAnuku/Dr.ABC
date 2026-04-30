import { Card, TextField, cn } from '@dr-abc/ui';
import { Check, Fingerprint, KeyRound, ShieldCheck, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DEV_PIN_DEFAULT,
  enrollPasskey,
  isPasskeyEnrolled,
  isPasskeySupported,
  setDevPin,
  unenrollPasskey,
} from '../../lib/dev-lock.ts';

/**
 * SecuritySettings — PIN rotation + WebAuthn passkey enrolment for the
 * dev console. Lives inside the dev console (only renders past the PIN
 * gate) so a stranger can't change the PIN without already knowing it.
 *
 * The WebAuthn flow uses a platform authenticator (Touch ID / Windows
 * Hello / Android fingerprint) to unlock the dev console with a
 * fingerprint instead of typing the PIN.
 */

type Status = { kind: 'idle' } | { kind: 'ok'; msg: string } | { kind: 'err'; msg: string };

export function SecuritySettings() {
  const { t } = useTranslation();
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [supported, setSupported] = useState(false);
  const [enrolled, setEnrolled] = useState(false);

  useEffect(() => {
    setSupported(isPasskeySupported());
    setEnrolled(isPasskeyEnrolled());
  }, []);

  const rotatePin = (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== confirm) {
      setStatus({ kind: 'err', msg: t('security.errorMismatch') });
      return;
    }
    if (!/^\d{4,8}$/.test(next)) {
      setStatus({ kind: 'err', msg: t('security.errorFormat') });
      return;
    }
    try {
      setDevPin(next);
      setStatus({ kind: 'ok', msg: t('security.okRotated') });
      setNext('');
      setConfirm('');
    } catch (err) {
      setStatus({ kind: 'err', msg: err instanceof Error ? err.message : t('common.error') });
    }
  };

  const resetPinToDefault = () => {
    setDevPin('');
    setStatus({ kind: 'ok', msg: t('security.okReset', { pin: DEV_PIN_DEFAULT }) });
  };

  const onEnrollPasskey = async () => {
    setStatus({ kind: 'idle' });
    try {
      await enrollPasskey();
      setEnrolled(true);
      setStatus({ kind: 'ok', msg: t('security.okEnrolled') });
    } catch (err) {
      setStatus({
        kind: 'err',
        msg: err instanceof Error ? err.message : t('security.errEnrolled'),
      });
    }
  };

  const onRemovePasskey = () => {
    unenrollPasskey();
    setEnrolled(false);
    setStatus({ kind: 'ok', msg: t('security.okRemoved') });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="p-5">
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <div>
            <div className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.32em] text-quantum-300">
              <KeyRound className="h-3 w-3" /> · {t('security.kickerPin')}
            </div>
            <h3 className="mt-1 font-display text-lg font-semibold text-app-primary">
              {t('security.titlePin')}
            </h3>
            <p className="mt-1 font-sans text-xs text-app-muted">{t('security.blurbPin')}</p>
          </div>
        </div>

        <form onSubmit={rotatePin} className="flex flex-col gap-3">
          {/* v0.7 audit slice 5 — migrated to <TextField>. The PIN-specific
              center-aligned tabular spacing is layered via className so
              the underlying Input contract stays generic. */}
          <TextField
            label={t('security.newPin')}
            value={next}
            onChange={(e) => setNext(e.target.value.replace(/\D/g, '').slice(0, 8))}
            type="password"
            inputMode="numeric"
            maxLength={8}
            placeholder="••••"
            className="[&_input]:text-center [&_input]:font-mono [&_input]:text-lg [&_input]:tabular-nums [&_input]:tracking-[0.4em]"
          />
          <TextField
            label={t('security.confirmPin')}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value.replace(/\D/g, '').slice(0, 8))}
            type="password"
            inputMode="numeric"
            maxLength={8}
            placeholder="••••"
            error={
              confirm.length >= 4 && confirm !== next ? t('security.errorMismatch') : undefined
            }
            className="[&_input]:text-center [&_input]:font-mono [&_input]:text-lg [&_input]:tabular-nums [&_input]:tracking-[0.4em]"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={next.length < 4}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-quantum-400/40 bg-quantum-500/15 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.22em] text-quantum-200 transition hover:bg-quantum-500/25 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Check className="h-3.5 w-3.5" /> {t('security.rotate')}
            </button>
            <button
              type="button"
              onClick={resetPinToDefault}
              className="inline-flex items-center gap-2 rounded-lg border border-app-subtle px-4 py-2 font-mono text-[11px] uppercase tracking-[0.22em] text-app-muted transition hover:border-rose-400/40 hover:text-rose-300"
            >
              <Trash2 className="h-3.5 w-3.5" /> {t('security.resetDefault')}
            </button>
          </div>
        </form>
      </Card>

      <Card className="p-5">
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <div>
            <div className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.32em] text-bio-300">
              <Fingerprint className="h-3 w-3" /> · {t('security.kickerPasskey')}
            </div>
            <h3 className="mt-1 font-display text-lg font-semibold text-app-primary">
              {t('security.titlePasskey')}
            </h3>
            <p className="mt-1 font-sans text-xs text-app-muted">
              {supported
                ? enrolled
                  ? t('security.blurbPasskeyEnrolled')
                  : t('security.blurbPasskeyAvailable')
                : t('security.blurbPasskeyMissing')}
            </p>
          </div>
          {enrolled && (
            <span className="inline-flex items-center gap-1 rounded-full border border-bio-400/40 bg-bio-500/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.22em] text-bio-200">
              <ShieldCheck className="h-3 w-3" /> {t('security.active')}
            </span>
          )}
        </div>

        <div className="flex gap-2">
          {!enrolled && (
            <button
              type="button"
              disabled={!supported}
              onClick={onEnrollPasskey}
              className={cn(
                'inline-flex flex-1 items-center justify-center gap-2 rounded-lg border px-4 py-2 font-mono text-[11px] uppercase tracking-[0.22em] transition',
                supported
                  ? 'border-bio-400/40 bg-bio-500/10 text-bio-200 hover:bg-bio-500/20'
                  : 'cursor-not-allowed border-app-subtle text-app-faint opacity-60',
              )}
            >
              <Fingerprint className="h-3.5 w-3.5" /> {t('security.enroll')}
            </button>
          )}
          {enrolled && (
            <button
              type="button"
              onClick={onRemovePasskey}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-app-subtle px-4 py-2 font-mono text-[11px] uppercase tracking-[0.22em] text-app-muted transition hover:border-rose-400/40 hover:text-rose-300"
            >
              <Trash2 className="h-3.5 w-3.5" /> {t('security.removePasskey')}
            </button>
          )}
        </div>

        <p className="mt-4 border-app-subtle border-t pt-3 font-mono text-[10px] text-app-faint">
          {t('security.scopeNote')}
        </p>
      </Card>

      {status.kind !== 'idle' && (
        <div
          className={cn(
            'rounded-lg border px-3 py-2 font-mono text-[11px] lg:col-span-2',
            status.kind === 'ok'
              ? 'border-bio-400/40 bg-bio-500/10 text-bio-200'
              : 'border-rose-500/40 bg-rose-500/10 text-rose-200',
          )}
        >
          {status.msg}
        </div>
      )}
    </div>
  );
}
