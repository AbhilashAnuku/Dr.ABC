import { Button } from '@dr-abc/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { Fingerprint } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'wouter';
import { z } from 'zod';
import { AuthShell } from '../layout/auth-shell.tsx';
import { useAuth } from '../lib/auth.tsx';
import { isPasskeyEnrolled, isPasskeySupported, verifyPasskey } from '../lib/dev-lock.ts';

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

type FormData = z.infer<typeof schema>;

type Stage = 'password' | 'otp-request' | 'otp-verify';

export function LoginPage() {
  const { t } = useTranslation();
  const { signInWithPassword, signInWithGoogle, sendOtp, verifyOtp } = useAuth();
  const [hasPasskey, setHasPasskey] = useState(false);
  useEffect(() => {
    setHasPasskey(isPasskeySupported() && isPasskeyEnrolled());
  }, []);
  const [, setLocation] = useLocation();
  const [stage, setStage] = useState<Stage>('password');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [otpEmail, setOtpEmail] = useState('');
  const [otpChallenge, setOtpChallenge] = useState('');

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { email: 'abhilashanuku14@gmail.com', password: '' },
  });

  const onPasswordSubmit = async (data: FormData) => {
    setSubmitting(true);
    setError(null);
    try {
      await signInWithPassword(data.email, data.password);
      setLocation('/app');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const onGoogle = async () => {
    // Real Google OAuth flow lives on the API at /auth/google/start.
    // Hard-redirect the browser there; the API sets a signed state
    // cookie + bounces to Google's consent screen with full scopes
    // (openid + email + profile + Google Fit reads). After consent,
    // /auth/google/callback mints the Mörbius cookie session and
    // lands on /app?google=ok.
    const apiBase = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787').toString();
    const startUrl = apiBase.startsWith('http')
      ? `${apiBase.replace(/\/$/, '')}/auth/google/start`
      : 'http://localhost:8787/auth/google/start';
    window.location.href = startUrl;
    // Touch the legacy hook so unused-import lint doesn't drop it
    // (kept as offline fallback for environments without the api):
    void signInWithGoogle;
  };

  const onSendOtp = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const email = String(data.get('otpEmail') ?? '').trim();
    if (!email) return;
    setSubmitting(true);
    setError(null);
    try {
      const { challengeId } = await sendOtp(email);
      setOtpEmail(email);
      setOtpChallenge(challengeId);
      setStage('otp-verify');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const onVerifyOtp = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const code = String(data.get('otp') ?? '').trim();
    setSubmitting(true);
    setError(null);
    try {
      await verifyOtp(otpChallenge, code);
      setLocation('/app');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      title={t('auth.loginTitle')}
      subtitle={t('auth.loginSubtitle')}
      footer={
        <>
          {t('auth.noAccount')}{' '}
          <Link href="/signup" className="text-quantum-400 hover:text-quantum-300">
            {t('auth.signUp')}
          </Link>
        </>
      }
    >
      {error && (
        <div className="mb-4 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 font-sans text-sm text-rose-300">
          {error}
        </div>
      )}

      {stage === 'password' && (
        <>
          {/* Production login is a real form — passkey first, Google
              OAuth, email + password, OTP. No persona switcher
              (multi-user lives in the DB sessions table, not as a
              click-pick UI). */}
          {hasPasskey && (
            <Button
              type="button"
              variant="primary"
              className="mb-3 w-full justify-center gap-2"
              onClick={async () => {
                setSubmitting(true);
                setError(null);
                try {
                  const ok = await verifyPasskey();
                  if (ok) {
                    setLocation('/app');
                  } else {
                    setError('Passkey check failed. Try again or use email.');
                  }
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                } finally {
                  setSubmitting(false);
                }
              }}
              disabled={submitting}
            >
              <Fingerprint className="h-4 w-4" /> Continue with passkey
            </Button>
          )}

          <Button
            type="button"
            variant="secondary"
            className="w-full justify-center gap-2"
            onClick={onGoogle}
            disabled={submitting}
          >
            <GoogleIcon /> {t('auth.continueWithGoogle')}
          </Button>

          <div className="my-5 flex items-center gap-3">
            <div className="h-px flex-1 bg-app-subtle" />
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-app-faint">
              {t('auth.or')}
            </span>
            <div className="h-px flex-1 bg-app-subtle" />
          </div>

          <form onSubmit={form.handleSubmit(onPasswordSubmit)} className="space-y-3">
            <Field label={t('auth.email')} error={form.formState.errors.email?.message}>
              <input
                type="email"
                autoComplete="email"
                {...form.register('email')}
                className={INPUT_CLS}
              />
            </Field>
            <Field
              label={t('auth.password')}
              error={form.formState.errors.password?.message}
              hint={
                <Link href="/forgot-password" className="text-quantum-400 hover:text-quantum-300">
                  {t('auth.forgot')}
                </Link>
              }
            >
              <input
                type="password"
                autoComplete="current-password"
                {...form.register('password')}
                className={INPUT_CLS}
              />
            </Field>

            <Button
              type="submit"
              variant="primary"
              loading={submitting}
              className="w-full justify-center"
            >
              {t('auth.signIn')}
            </Button>
          </form>

          <button
            type="button"
            onClick={() => setStage('otp-request')}
            className="mt-3 w-full text-center font-sans text-xs text-app-muted hover:text-quantum-400"
          >
            {t('auth.sendOtp')} →
          </button>
        </>
      )}

      {stage === 'otp-request' && (
        <form onSubmit={onSendOtp} className="space-y-3">
          <Field label={t('auth.email')}>
            <input
              type="email"
              name="otpEmail"
              autoComplete="email"
              required
              className={INPUT_CLS}
            />
          </Field>
          <Button
            type="submit"
            variant="primary"
            loading={submitting}
            className="w-full justify-center"
          >
            {t('auth.sendOtp')}
          </Button>
          <button
            type="button"
            onClick={() => setStage('password')}
            className="block w-full text-center font-sans text-xs text-app-muted hover:text-quantum-400"
          >
            ← {t('auth.back')}
          </button>
        </form>
      )}

      {stage === 'otp-verify' && (
        <form onSubmit={onVerifyOtp} className="space-y-3">
          <p className="font-sans text-xs text-app-muted">
            Code sent to <strong className="text-app-primary">{otpEmail}</strong>. (V0 demo: any
            6-digit code works.)
          </p>
          <Field label={t('auth.otp')}>
            <input
              type="text"
              name="otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              pattern="[0-9]{6}"
              required
              className={`${INPUT_CLS} text-center font-mono text-2xl tracking-[0.5em]`}
              placeholder="000000"
            />
          </Field>
          <Button
            type="submit"
            variant="primary"
            loading={submitting}
            className="w-full justify-center"
          >
            {t('auth.verify')}
          </Button>
          <button
            type="button"
            onClick={() => setStage('otp-request')}
            className="block w-full text-center font-sans text-xs text-app-muted hover:text-quantum-400"
          >
            ← {t('auth.back')}
          </button>
        </form>
      )}
    </AuthShell>
  );
}

const INPUT_CLS =
  'w-full rounded-lg border border-app-subtle bg-white/5 px-3 py-2.5 font-sans text-sm text-app-primary placeholder:text-app-faint focus:border-quantum-400/60 focus:outline-none focus:ring-2 focus:ring-quantum-500/20';

interface FieldProps {
  label: string;
  error?: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}

export function Field({ label, error, hint, children }: FieldProps) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between font-sans text-xs text-app-secondary">
        <span>{label}</span>
        {hint && <span className="text-[11px]">{hint}</span>}
      </div>
      {children}
      {error && <p className="mt-1 font-sans text-xs text-rose-400">{error}</p>}
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.838.86-3.048.86-2.344 0-4.328-1.584-5.036-3.71H.957v2.332A8.997 8.997 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
      />
    </svg>
  );
}
