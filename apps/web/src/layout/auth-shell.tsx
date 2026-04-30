import { Globe, Moon, Sun } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Redirect } from 'wouter';
import { useAuth } from '../lib/auth.tsx';
import { SUPPORTED_LANGS } from '../lib/i18n.ts';
import { useTheme } from '../lib/theme.tsx';

interface AuthShellProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  /** Footer slot for "no account?" / "back to login" style cross-links. */
  footer?: ReactNode;
}

export function AuthShell({ title, subtitle, children, footer }: AuthShellProps) {
  const { status } = useAuth();
  const { i18n } = useTranslation();
  const { theme, toggle } = useTheme();

  if (status === 'signed-in') return <Redirect to="/app" />;

  return (
    <div className="relative z-10 flex min-h-screen flex-col">
      <div className="flex items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-3">
          <div className="pulse-glow relative flex h-9 w-9 items-center justify-center rounded-full border border-quantum-400/40 bg-quantum-500/10 font-display text-lg font-bold text-quantum-400">
            M
          </div>
          <div className="hidden sm:block">
            <div className="font-display text-base font-bold tracking-tight text-app-primary">
              Dr<span className="text-bio-500">·</span>ABC
            </div>
            <div className="font-mono text-[10px] tracking-[0.32em] text-app-faint">
              POWERED BY MÖRBIUS
            </div>
          </div>
        </Link>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-full border border-app-subtle px-1 py-0.5">
            <Globe className="ml-1.5 h-3.5 w-3.5 text-app-muted" />
            {SUPPORTED_LANGS.map((lang) => (
              <button
                key={lang.code}
                type="button"
                onClick={() => void i18n.changeLanguage(lang.code)}
                title={lang.label}
                className={`rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] transition-colors ${
                  i18n.resolvedLanguage === lang.code
                    ? 'bg-quantum-500/20 text-quantum-300'
                    : 'text-app-muted hover:text-app-primary'
                }`}
              >
                {lang.code}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={toggle}
            aria-label="Toggle theme"
            className="rounded-lg border border-app-subtle p-2 text-app-secondary transition-colors hover:border-quantum-400/40 hover:text-quantum-400"
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center px-6 pb-12">
        <div className="w-full max-w-md">
          <div className="mb-6 text-center">
            <h1 className="font-display text-3xl font-bold tracking-tight text-app-primary">
              {title}
            </h1>
            {subtitle && <p className="mt-2 font-sans text-sm text-app-muted">{subtitle}</p>}
          </div>
          <div className="rounded-2xl surface-strong border border-app-subtle p-6 sm:p-8">
            {children}
          </div>
          {footer && (
            <div className="mt-4 text-center font-sans text-sm text-app-muted">{footer}</div>
          )}
        </div>
      </div>
    </div>
  );
}
