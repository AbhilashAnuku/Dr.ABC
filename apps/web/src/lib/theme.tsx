import { type ReactNode, createContext, useContext, useEffect, useState } from 'react';

/**
 * Mörbius runs on a single bio-luminescent theme. The user only picks
 * dark vs light. The 5-mode picker (aurora · clinical · cobalt · sage ·
 * synthwave) and the clinical-tint accent system that shipped before
 * v0.8 are gone — the bioluminescent theme plus dark/light is the
 * complete theming surface.
 *
 * The CSS in `index.css` still keys off `data-mode="aurora"` for the
 * bio-luminescent palette, so we set it once on mount + leave it pinned.
 * That keeps the existing CSS intact while the public surface is just
 * `theme = dark | light`.
 */
export type Theme = 'dark' | 'light';

interface ThemeContextValue {
  theme: Theme;
  toggle: () => void;
  set: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const THEME_STORAGE_KEY = 'dr-abc:theme';

function readInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(readInitialTheme);

  // Pin the bio-luminescent palette + clear any legacy accent tint.
  useEffect(() => {
    document.documentElement.dataset.mode = 'aurora';
    delete document.documentElement.dataset.clinicalTint;
    // Clean up legacy keys so a returning user doesn't see stale picks.
    window.localStorage.removeItem('dr-abc:mode');
    window.localStorage.removeItem('dr-abc:clinical-tint');
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  const value: ThemeContextValue = {
    theme,
    set: setTheme,
    toggle: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')),
  };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}
