import { cn } from '@dr-abc/ui';
import { Globe, History, Keyboard, LogOut, Menu, Moon, ScanFace, Sun } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'wouter';
import { useAuth } from '../lib/auth.tsx';
import { SUPPORTED_LANGS } from '../lib/i18n.ts';
import { useTheme } from '../lib/theme.tsx';
import { BackendChip } from './backend-chip.tsx';
import { GlobalVoicePicker } from './global-voice-picker.tsx';
import { VoiceCommandsCheatSheet } from './voice-commands-cheatsheet.tsx';

interface TopBarProps {
  onMenuClick: () => void;
  /** Current page title shown next to the menu icon on lg+ screens.
   *  AppShell derives this from the wouter route. */
  pageTitle?: string;
}

export function TopBar({ onMenuClick, pageTitle }: TopBarProps) {
  const { t, i18n } = useTranslation();
  const { theme, toggle: toggleTheme } = useTheme();
  const { user, signOut } = useAuth();
  const [, setLocation] = useLocation();
  const [cheatOpen, setCheatOpen] = useState(false);

  const openRecents = () => {
    window.dispatchEvent(new CustomEvent('dr-abc:recents:open'));
  };

  const handleSignOut = async () => {
    await signOut();
    setLocation('/');
  };

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 lg:px-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label="Open menu"
          onClick={onMenuClick}
          className="rounded-lg p-2 text-app-secondary transition-colors hover:bg-white/5 hover:text-app-primary lg:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>

        {/* Dr.ABC brand + user identity · fixed in the top header,
            not the sidebar. Pulled out of the sidebar so it appears
            once globally. */}
        <Link
          href="/app"
          className="flex items-center gap-3 rounded-md px-1 py-0.5 transition hover:bg-white/4"
        >
          <span className="pulse-glow relative flex h-9 w-9 items-center justify-center rounded-full border border-quantum-400/40 bg-quantum-500/10">
            <ScanFace className="h-5 w-5 text-quantum-300" />
          </span>
          <span className="hidden sm:block">
            <span className="block font-display text-base font-bold leading-tight tracking-tight text-app-primary">
              Dr<span className="text-bio-500">·</span>ABC
            </span>
            <span className="block font-mono text-[9px] tracking-[0.32em] text-app-faint">
              POWERED BY MÖRBIUS
            </span>
          </span>
        </Link>

        {user && (
          <span className="hidden items-center gap-2 rounded-full border border-app-subtle bg-white/2 px-2.5 py-1 sm:inline-flex">
            <span className="inline-block h-2 w-2 rounded-full bg-bio-400" />
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-app-secondary">
              {user.name}
            </span>
          </span>
        )}
      </div>

      <div className="flex flex-1 items-center justify-end gap-2">
        {/* Language switcher — collapses to a single icon button on
            phones; the language pills only show from sm: up. */}
        <div className="hidden items-center gap-1 rounded-full border border-app-subtle px-1 py-0.5 sm:flex">
          <Globe className="ml-1.5 h-3.5 w-3.5 text-app-muted" />
          {SUPPORTED_LANGS.map((lang) => (
            <button
              key={lang.code}
              type="button"
              onClick={() => void i18n.changeLanguage(lang.code)}
              title={lang.label}
              className={cn(
                'rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] transition-colors',
                i18n.resolvedLanguage === lang.code
                  ? 'bg-quantum-500/20 text-quantum-300'
                  : 'text-app-muted hover:text-app-primary',
              )}
            >
              {lang.code}
            </button>
          ))}
        </div>

        <BackendChip />

        <GlobalVoicePicker />

        {/* Mörbius cluster — recents (history) + voice cheat sheet.
            Always visible (continuity is core), grouped in one bordered
            pill so it reads as one tool. */}
        <div className="flex items-center gap-1 rounded-full border border-app-subtle px-1 py-0.5">
          <button
            type="button"
            onClick={openRecents}
            aria-label={t('recents.topbarLabel')}
            title={t('recents.topbarTitle')}
            className="rounded-full p-1.5 text-app-secondary transition-colors hover:bg-white/5 hover:text-quantum-400"
          >
            <History className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setCheatOpen(true)}
            aria-label={t('voiceCheatSheet.topbarLabel')}
            title={t('voiceCheatSheet.topbarTitle')}
            className="rounded-full p-1.5 text-app-secondary transition-colors hover:bg-white/5 hover:text-quantum-400"
          >
            <Keyboard className="h-4 w-4" />
          </button>
        </div>
        {cheatOpen && <VoiceCommandsCheatSheet onClose={() => setCheatOpen(false)} />}

        <button
          type="button"
          onClick={toggleTheme}
          aria-label="Toggle theme"
          title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
          className="rounded-lg border border-app-subtle p-2 text-app-secondary transition-colors hover:border-quantum-400/40 hover:text-quantum-400"
        >
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>

        {user && (
          <div className="flex items-center gap-3 border-l border-app-subtle pl-3">
            <div className="hidden text-right sm:block">
              <div className="font-sans text-xs font-medium text-app-primary">{user.name}</div>
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-app-muted">
                {user.email}
              </div>
            </div>
            <div
              role="img"
              aria-label={user.name}
              title={user.name}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-linear-to-br from-quantum-400 to-bio-500 font-display text-sm font-bold text-ink-950"
            >
              {user.name.charAt(0).toUpperCase()}
            </div>
            <button
              type="button"
              onClick={handleSignOut}
              aria-label={t('nav.signOut')}
              title={t('nav.signOut')}
              className="rounded-lg p-2 text-app-muted transition-colors hover:bg-rose-500/10 hover:text-rose-400"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
