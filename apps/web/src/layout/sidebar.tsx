import { cn } from '@dr-abc/ui';
import {
  Activity,
  Calendar,
  Fingerprint,
  HeartPulse,
  Home,
  KeyRound,
  Library,
  Lock,
  type LucideIcon,
  Microscope,
  Settings,
  ShieldCheck,
  Stethoscope,
  Terminal,
  User,
  Workflow,
} from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { useAuth } from '../lib/auth.tsx';
import { isPatientPersona } from '../lib/demo-personas.ts';
import { isDevConsoleUnlocked } from '../lib/dev-lock.ts';

interface SidebarProps {
  open: boolean;
  onClose: () => void;
  /** 'docked' renders inside the AppShell grid cell on lg+ screens
   *  (no fixed/sticky positioning · no backdrop). 'drawer' renders the
   *  mobile slide-in overlay with backdrop. Default 'drawer' for back-
   *  compat. The two variants are mounted simultaneously on lg+; the
   *  drawer is hidden via lg:hidden so only the docked one paints. */
  variant?: 'docked' | 'drawer';
}

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Optional gate icon (lock / fingerprint) shown next to the label. */
  gate?: 'lock' | 'fingerprint';
}

interface NavSection {
  /** Short uppercase label (e.g. "consult"). Empty string = no header. */
  label: string;
  items: NavItem[];
}

/**
 * Sidebar — the single nav surface for the demo identity. Categorised
 * into four sections so the demo flow reads naturally:
 *
 *   1. Home          — Dashboard
 *   2. Consult       — Consultation (hosts Imaging) · Case library · AI Scribe
 *   3. Tools         — API keys · Records + Wellness · Schedule
 *   4. Settings      — Settings
 *   5. Developer     — Dev console (PIN-locked, lives at the end)
 *
 * Dev console is intentionally last + gated by a PIN-lock to keep the
 * patient-facing surface uncluttered. When locked, the lock icon shows
 * next to the label; clicking the link still navigates but the route
 * itself prompts for the PIN before rendering its tabs.
 */
// Navigation ordering:
//   - Dashboard at the very top (separate).
//   - Consultation + Case library = consult section.
//   - "me" splits into Records, Wellness, Schedule, Insurance —
//     four distinct sidebar entries with TS-typed routes.
//   - Settings + API keys grouped under preferences.
//   - Architecture / Agents room / Dev console under developer · locked.
const SECTIONS: NavSection[] = [
  {
    label: '',
    items: [{ to: '/app', label: 'Dashboard', icon: Home }],
  },
  {
    label: 'consult',
    items: [
      { to: '/app/consult', label: 'Consultation', icon: Stethoscope },
      { to: '/app/case-library', label: 'Case library', icon: Library },
    ],
  },
  {
    label: 'me',
    items: [
      { to: '/app/profile', label: 'Records', icon: User },
      { to: '/app/wellness', label: 'Wellness', icon: HeartPulse },
      { to: '/app/appointments', label: 'Schedule', icon: Calendar },
      { to: '/app/insurance', label: 'Insurance', icon: ShieldCheck },
    ],
  },
  {
    label: 'preferences',
    items: [
      { to: '/app/settings', label: 'Settings', icon: Settings },
      { to: '/app/api-keys', label: 'API keys', icon: KeyRound },
    ],
  },
  {
    label: 'developer · locked',
    items: [
      { to: '/app/architecture', label: 'Architecture', icon: Workflow },
      { to: '/app/agents-room', label: 'Agents room', icon: Microscope },
      { to: '/app/dev-console', label: 'Dev console', icon: Terminal, gate: 'fingerprint' },
    ],
  },
];

export function Sidebar({ open, onClose, variant = 'drawer' }: SidebarProps) {
  const [location] = useLocation();
  const { user } = useAuth();

  const isActive = (to: string) => (to === '/app' ? location === '/app' : location.startsWith(to));
  const devUnlocked = isDevConsoleUnlocked();
  // Patient-persona demos (T2DM · PCOS · cancer · post-MI · healthy)
  // see only patient-facing surfaces. Sign-up identities and the demo
  // operator identity see everything. Examiners can scan a persona icon
  // and land in a clean patient view, with no dev tooling exposed.
  const PATIENT_HIDE = new Set([
    '/app/api-keys',
    '/app/neural-core',
    '/app/architecture',
    '/app/dev-console',
  ]);
  const sections = isPatientPersona(user?.id)
    ? SECTIONS.map((s) => ({
        ...s,
        items: s.items.filter((i) => !PATIENT_HIDE.has(i.to)),
      })).filter((s) => s.items.length > 0)
    : SECTIONS;

  // Inner content extracted so both variants render the same nav.
  // The Dr.ABC brand and user identity are fixed at the top in TopBar,
  // not the sidebar. Both blocks lifted to TopBar; sidebar starts
  // straight into the nav so the surface reads as one piece, not
  // stitched cards.
  const content = (
    <>
      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto pt-2">
        {sections.map((section, sIdx) => (
          <div key={section.label || `section-${sIdx}`} className="flex flex-col gap-0.5">
            {section.label && (
              <div className="mt-3 mb-0.5 px-3 font-mono text-[9px] uppercase tracking-[0.32em] text-app-faint">
                {section.label}
              </div>
            )}
            {section.items.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.to);
              const showLock = item.gate === 'fingerprint' && !devUnlocked;
              return (
                <Link
                  key={item.to}
                  href={item.to}
                  onClick={onClose}
                  data-narrator-target={item.to.replace('/app/', '').replace('/app', 'dashboard')}
                  className={cn(
                    'narrator-target flex items-center gap-3 rounded-lg px-3 py-2 font-sans text-sm transition-colors',
                    active
                      ? 'bg-quantum-500/15 text-quantum-300'
                      : 'text-app-secondary hover:bg-white/5 hover:text-app-primary',
                  )}
                >
                  <Icon className={cn('h-4 w-4', active ? 'text-quantum-400' : 'text-app-muted')} />
                  <span className="flex-1">{item.label}</span>
                  {showLock && (
                    <span
                      title="PIN-locked — click to unlock"
                      className="inline-flex items-center gap-1 text-amber-400"
                    >
                      {item.gate === 'fingerprint' ? (
                        <Fingerprint className="h-3.5 w-3.5" />
                      ) : (
                        <Lock className="h-3.5 w-3.5" />
                      )}
                    </span>
                  )}
                  {active && !showLock && (
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-bio-400" />
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="mt-4 flex items-center justify-between rounded-lg border border-app-subtle px-3 py-2">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-bio-400" />
          <span className="font-mono text-[10px] tracking-[0.18em] uppercase text-app-muted">
            v0.8.0-beta · Mörbius
          </span>
        </div>
        <Microscope className="h-3.5 w-3.5 text-app-faint" />
      </div>
    </>
  );

  // Docked variant — fits the AppShell grid cell, no fixed/sticky.
  if (variant === 'docked') {
    return <div className="flex h-full min-h-0 w-full flex-col px-3 py-4">{content}</div>;
  }

  // Drawer variant — mobile slide-in with backdrop.
  return (
    <>
      <button
        type="button"
        aria-label="Close menu"
        onClick={onClose}
        className={cn(
          'fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden',
          open ? 'block' : 'hidden',
        )}
      />
      <aside
        aria-label="Primary navigation"
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-64 flex-col surface-strong border-r border-app-subtle px-3 py-4',
          'transition-transform duration-200 lg:hidden',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {content}
      </aside>
    </>
  );
}
