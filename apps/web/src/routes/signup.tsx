import { Button } from '@dr-abc/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'wouter';
import { z } from 'zod';
import { AuthShell } from '../layout/auth-shell.tsx';
import { useAuth } from '../lib/auth.tsx';
import { Field } from './login.tsx';

const schema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8, 'Min 8 characters'),
});

type FormData = z.infer<typeof schema>;

export function SignupPage() {
  const { t } = useTranslation();
  const { signUpWithPassword, signInWithGoogle } = useAuth();
  const [, setLocation] = useLocation();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', email: '', password: '' },
  });

  const onSubmit = async (data: FormData) => {
    setSubmitting(true);
    setError(null);
    try {
      await signUpWithPassword(data.email, data.password, data.name);
      setLocation('/app');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const onGoogle = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await signInWithGoogle();
      setLocation('/app');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      title={t('auth.signupTitle')}
      subtitle={t('auth.signupSubtitle')}
      footer={
        <>
          {t('auth.haveAccount')}{' '}
          <Link href="/login" className="text-quantum-400 hover:text-quantum-300">
            {t('auth.signIn')}
          </Link>
        </>
      }
    >
      {error && (
        <div className="mb-4 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 font-sans text-sm text-rose-300">
          {error}
        </div>
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

      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
        <Field label={t('auth.name')} error={form.formState.errors.name?.message}>
          <input type="text" autoComplete="name" {...form.register('name')} className={INPUT_CLS} />
        </Field>
        <Field label={t('auth.email')} error={form.formState.errors.email?.message}>
          <input
            type="email"
            autoComplete="email"
            {...form.register('email')}
            className={INPUT_CLS}
          />
        </Field>
        <Field label={t('auth.password')} error={form.formState.errors.password?.message}>
          <input
            type="password"
            autoComplete="new-password"
            {...form.register('password')}
            className={INPUT_CLS}
          />
        </Field>

        <p className="font-sans text-[11px] text-app-faint">{t('auth.termsHint')}</p>

        <Button
          type="submit"
          variant="primary"
          loading={submitting}
          className="w-full justify-center"
        >
          {t('auth.signUp')}
        </Button>
      </form>
    </AuthShell>
  );
}

const INPUT_CLS =
  'w-full rounded-lg border border-app-subtle bg-white/5 px-3 py-2.5 font-sans text-sm text-app-primary placeholder:text-app-faint focus:border-quantum-400/60 focus:outline-none focus:ring-2 focus:ring-quantum-500/20';

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
