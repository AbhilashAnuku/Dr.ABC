import { Activity, ShieldCheck, Wifi, WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { API_BASE } from '../lib/config.ts';

/**
 * AppFooter — sticky bottom band of the unified shell.
 *
 * Shows three things at a glance, in a single 40 px strip so it never
 * eats vertical real estate:
 *   · API health (live polled · green / red dot)
 *   · build version
 *   · sovereign-by-default tag
 *
 * No interactive controls — keep the footer informational so the user
 * never has to look down to act, only to confirm.
 */
export function AppFooter() {
  const [apiOk, setApiOk] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    const ping = () => {
      fetch(`${API_BASE}/health`, { cache: 'no-store' })
        .then((r) => alive && setApiOk(r.ok))
        .catch(() => alive && setApiOk(false));
    };
    ping();
    const id = window.setInterval(ping, 15_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  return (
    <footer
      aria-label="System status"
      className="flex items-center justify-between gap-3 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint sm:px-6"
    >
      <div className="flex items-center gap-3">
        <span className="inline-flex items-center gap-1.5">
          {apiOk === false ? (
            <WifiOff className="h-3 w-3 text-rose-400" />
          ) : (
            <Wifi className={apiOk ? 'h-3 w-3 text-bio-400' : 'h-3 w-3 text-app-muted'} />
          )}
          <span className={apiOk === false ? 'text-rose-300' : ''}>
            {apiOk === null ? 'checking' : apiOk ? 'api online' : 'api offline'}
          </span>
        </span>
        <span className="hidden h-3 w-px bg-app-subtle sm:inline-block" />
        <span className="hidden items-center gap-1.5 sm:inline-flex">
          <ShieldCheck className="h-3 w-3 text-bio-400" />
          sovereign · local-first
        </span>
      </div>
      <div className="flex items-center gap-3">
        <span className="hidden sm:inline">DR·ABC · MÖRBIUS · BETA · v0.8</span>
        <span className="inline-flex items-center gap-1.5">
          <Activity className="h-3 w-3 text-bio-400" />
          live
        </span>
      </div>
    </footer>
  );
}
