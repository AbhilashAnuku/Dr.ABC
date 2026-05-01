import { Button } from '@dr-abc/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'wouter';
import { AuthShell } from '../layout/auth-shell.tsx';
import { useAuth } from '../lib/auth.tsx';
import { Field } from './login.tsx';

export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const { requestPasswordReset } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const email = String(data.get('email') ?? '').trim();
    if (!email) return;
    setSubmitting(true);
    setError(null);
    try {
      await requestPasswordReset(email);
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      title={t('auth.forgotTitle')}
      subtitle={t('auth.forgotSubtitle')}
      footer={
        <Link href="/login" className="text-quantum-400 hover:text-quantum-300">
          ← {t('auth.back')}
        </Link>
      }
    >
      {error && (
        <div className="mb-4 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 font-sans text-sm text-rose-300">
          {error}
        </div>
      )}

      {sent ? (
        <div className="rounded-lg border border-bio-500/40 bg-bio-500/10 px-4 py-3 font-sans text-sm text-bio-300">
          {t('auth.checkEmail')}
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-3">
          <Field label={t('auth.email')}>
            <input
              type="email"
              name="email"
              autoComplete="email"
              required
              className="w-full rounded-lg border border-app-subtle bg-white/5 px-3 py-2.5 font-sans text-sm text-app-primary placeholder:text-app-faint focus:border-quantum-400/60 focus:outline-none focus:ring-2 focus:ring-quantum-500/20"
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
        </form>
      )}
    </AuthShell>
  );
}
