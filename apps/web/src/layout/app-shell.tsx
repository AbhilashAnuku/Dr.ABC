import { type ReactNode, useEffect, useState } from 'react';
import { Redirect, useLocation } from 'wouter';
import { useAuth } from '../lib/auth.tsx';
import { AppFooter } from './app-footer.tsx';
import { RecentsDrawer } from './recents-drawer.tsx';
import { Sidebar } from './sidebar.tsx';
import { TopBar } from './top-bar.tsx';

/**
 * Authenticated app shell — single-container grid layout.
 *
 * The sidebar nav is fixed; only the panel layout inside the container
 * scrolls. The header, footer, and sidebar are merged into a single
 * container, with each region clearly named.
 *
 * Grid template:
 *
 *   ┌───────────────────────────────────────────┐
 *   │ HEADER (col-span 2 · sticky · 56 px)      │
 *   ├──────────┬────────────────────────────────┤
 *   │ SIDEBAR  │ MAIN (the only scroll area)    │
 *   │ (sticky  │                                │
 *   │  · 280)  │                                │
 *   ├──────────┴────────────────────────────────┤
 *   │ FOOTER (col-span 2 · sticky · 40 px)      │
 *   └───────────────────────────────────────────┘
 *
 * Body never scrolls — the grid is `h-screen` with `overflow-hidden`
 * outside the main cell. Header / sidebar / footer stay frozen; main
 * scrolls independently. Mobile: sidebar slides over main, grid
 * collapses to single-column.
 */

interface PageMeta {
  title: string;
  kicker: string;
}

const ROUTE_META: Record<string, PageMeta> = {
  '/app': { kicker: 'home', title: 'Dashboard' },
  '/app/consult': { kicker: 'consult', title: 'Consultation' },
  '/app/clinic': { kicker: 'consult', title: 'Consultation + Imaging' },
  '/app/case-library': { kicker: 'consult', title: 'Case library' },
  '/app/brain': { kicker: 'tools', title: 'Neural core' },
  '/app/neural-core': { kicker: 'tools', title: 'Neural core' },
  '/app/api-keys': { kicker: 'tools', title: 'API keys' },
  '/app/profile': { kicker: 'tools', title: 'Records + Wellness' },
  '/app/appointments': { kicker: 'tools', title: 'Schedule' },
  '/app/settings': { kicker: 'preferences', title: 'Settings' },
  '/app/architecture': { kicker: 'developer', title: 'Architecture' },
  '/app/agents-room': { kicker: 'developer', title: 'Agents room' },
  '/app/dev-console': { kicker: 'developer · locked', title: 'Dev console' },
};

function pageMeta(loc: string): PageMeta {
  const exact = ROUTE_META[loc];
  if (exact) return exact;
  // Best-effort prefix match for nested routes
  const match = Object.keys(ROUTE_META)
    .filter((k) => k !== '/app' && loc.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  const matched = match ? ROUTE_META[match] : undefined;
  return matched ?? { kicker: 'app', title: 'Mörbius' };
}

export function AppShell({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const [location] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const meta = pageMeta(location);

  useEffect(() => {
    const close = () => setSidebarOpen(false);
    window.addEventListener('popstate', close);
    return () => window.removeEventListener('popstate', close);
  }, []);

  // Close mobile drawer on route change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: location is the trigger
  useEffect(() => {
    setSidebarOpen(false);
  }, [location]);

  if (status === 'loading') {
    return (
      <div className="relative z-10 flex h-screen items-center justify-center px-6 text-center">
        <div className="font-mono text-xs uppercase tracking-[0.32em] text-app-muted">
          Loading session…
        </div>
      </div>
    );
  }

  if (status === 'signed-out') {
    return <Redirect to="/login" />;
  }

  return (
    <div
      className="relative z-10 grid h-screen w-screen overflow-hidden surface"
      style={{
        gridTemplateColumns: 'minmax(0, 1fr)',
        gridTemplateRows: 'auto minmax(0, 1fr) auto',
        gridTemplateAreas: `"header" "body" "footer"`,
      }}
    >
      {/* HEADER — flush band, single hairline divider beneath */}
      <div style={{ gridArea: 'header' }} className="border-app-subtle/40 border-b">
        <TopBar onMenuClick={() => setSidebarOpen((o) => !o)} pageTitle={meta.title} />
      </div>

      {/* BODY — sidebar + main share one continuous surface, divided by a
          single faint vertical hairline (not a chunky border). Both
          cells use the same background so the layout reads as one
          uninterrupted plane. */}
      <div
        style={{ gridArea: 'body' }}
        className="grid min-h-0 w-full overflow-hidden lg:grid-cols-[260px_minmax(0,1fr)]"
      >
        <aside
          aria-label="Primary navigation"
          className="hidden min-h-0 overflow-hidden border-app-subtle/40 border-r lg:block"
        >
          <Sidebar open={false} onClose={() => setSidebarOpen(false)} variant="docked" />
        </aside>

        {/* MAIN — full-bleed, the only scroll area. No inner page-title
            block: the global header carries `meta.title` (a single
            title is enough). Routes paint straight into the cell so the
            shell reads as one piece, not stitched cards. */}
        <main aria-label={meta.title} className="relative flex min-h-0 flex-col overflow-y-auto">
          <div className="flex flex-1 flex-col gap-6 px-6 py-6 lg:px-8">{children}</div>
        </main>

        {/* Mobile drawer — overlays main when open */}
        <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} variant="drawer" />
      </div>

      {/* FOOTER — single hairline divider above */}
      <div style={{ gridArea: 'footer' }} className="border-app-subtle/40 border-t">
        <AppFooter />
      </div>

      <RecentsDrawer />
    </div>
  );
}
