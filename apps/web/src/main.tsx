import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import './lib/i18n.ts';
import { AuthProvider } from './lib/auth.tsx';
import { installHardenedMode } from './lib/hardened-mode.ts';
import { ThemeProvider } from './lib/theme.tsx';

// Strict client-side lockdown even on local runs: disables inspect,
// Ctrl+U, and right-click across devices including iOS. Opt-in via
// VITE_HARDENED_MODE=true (or ?hardened=on URL flag). Off by default
// in DEV so debugging still works.
installHardenedMode();

const root = document.getElementById('root');
if (!root) throw new Error('#root missing');

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ThemeProvider>
  </StrictMode>,
);
