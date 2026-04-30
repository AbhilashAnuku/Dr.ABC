// App-wide recents drawer — slides in from the right on any page.
//
// Opens via:
//   - voice command: "Mörbius show recents" / "Mörbius open recents"
//     (global-voice-listener dispatches `dr-abc:recents:open`)
//   - keyboard: ⌘ + ;  /  Ctrl + ;
//   - the small floating "recents" button in the top-bar
//
// Renders the same MemoryEntry list the dashboard widget uses, so a
// click resumes the actual consult via /app/clinic?id=<consultId>.
//
// v0.7 audit slice 5 — migrated to <Modal> primitive: kills the
// `role="dialog"` biome-ignore + the manual backdrop-button + the
// hand-rolled Escape handler. Native <dialog> via showModal() does
// the focus trap + ARIA modal semantics + Escape-to-close for free.
// Only the consult-list body and the voice/keyboard footer are
// custom; the chrome (header / close / backdrop) comes from <Modal>.

import { Modal, Pill, cn } from '@dr-abc/ui';
import { Brain, Clock, History, Stethoscope } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'wouter';
import { useAuth } from '../lib/auth.tsx';
import { type MemoryEntry, listMemory } from '../lib/morbius-memory.ts';

const SESSION_KEY = 'dr-abc:recents-open';

function relativeTime(ts: number, now = Date.now()): string {
  const diff = Math.max(0, now - ts);
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

export function RecentsDrawer() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<MemoryEntry[] | null>(null);

  const reload = useCallback(() => {
    if (!user?.id) return;
    void listMemory(user.id, 25)
      .then((rows) => setEntries(rows))
      .catch(() => setEntries([]));
  }, [user?.id]);

  // Open via custom event (voice command) or session flag (programmatic).
  useEffect(() => {
    const onOpen = () => {
      setOpen(true);
      reload();
    };
    window.addEventListener('dr-abc:recents:open', onOpen);
    if (typeof window !== 'undefined' && window.sessionStorage.getItem(SESSION_KEY) === '1') {
      window.sessionStorage.removeItem(SESSION_KEY);
      onOpen();
    }
    return () => window.removeEventListener('dr-abc:recents:open', onOpen);
  }, [reload]);

  // ⌘ + ;  /  Ctrl + ;  — Cmd+R is browser reload, Cmd+Shift+R is
  // hard reload, so neither reaches our handler. The semicolon key is
  // rarely bound by browsers or extensions and sits next to the home
  // row for one-handed reach. Escape-to-close is now handled by
  // <Modal>'s native cancel event.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ';' && !e.altKey) {
        e.preventDefault();
        setOpen((o) => {
          if (!o) reload();
          return !o;
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [reload]);

  const close = useCallback(() => setOpen(false), []);

  return (
    <Modal
      open={open}
      onClose={close}
      title={t('recents.title')}
      subtitle={
        <span className="inline-flex items-center gap-1.5">
          <History className="h-3 w-3" /> · {t('recents.kicker')}
        </span>
      }
      size="md"
      footer={
        <>
          <span className="flex-1 text-left font-mono text-[10px] text-app-faint">
            <Brain className="mr-1 inline h-3 w-3 text-quantum-300" />
            {t('recents.voiceHint')}{' '}
            <code className="rounded bg-white/5 px-1.5 py-0.5">Mörbius resume</code>
          </span>
          <span className="font-mono text-[10px] text-app-faint opacity-70">
            {t('recents.keyboardHint')} ⌘ ; · Ctrl ; · {t('recents.esc')}
          </span>
        </>
      }
    >
      <div>
        {entries === null && (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders
                key={i}
                className="h-16 animate-pulse rounded-lg border border-app-subtle bg-white/2"
              />
            ))}
          </div>
        )}
        {entries !== null && entries.length === 0 && (
          <div className="rounded-lg border border-dashed border-app-subtle p-4 text-app-muted">
            <p className="font-sans text-sm">{t('recents.empty')}</p>
          </div>
        )}
        {entries !== null && entries.length > 0 && (
          <ul className="space-y-2">
            {entries.map((e) => (
              <li key={e.id}>
                <Link
                  href={e.consultId ? `/app/clinic?id=${e.consultId}` : '/app/clinic'}
                  onClick={() => {
                    if (!e.consultId) {
                      window.sessionStorage.setItem('dr-abc:pending-consult', e.chiefComplaint);
                    }
                    close();
                  }}
                  className={cn(
                    'block rounded-lg border border-app-subtle bg-white/2 p-3 transition hover:-translate-y-0.5 hover:bg-white/5',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 font-display text-sm font-semibold text-app-primary">
                      <Stethoscope className="h-3.5 w-3.5 text-app-faint" />
                      {e.diagnosis ?? t('recents.openConsult')}
                    </span>
                    {e.consultId && (
                      <Pill tone="success" size="xs">
                        {t('recents.resumable')}
                      </Pill>
                    )}
                  </div>
                  <p className="mt-1 line-clamp-2 font-sans text-xs text-app-muted">
                    {e.chiefComplaint}
                  </p>
                  <div className="mt-2 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" /> {relativeTime(e.ts)}
                    </span>
                    {e.specialty && <span>{e.specialty}</span>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
