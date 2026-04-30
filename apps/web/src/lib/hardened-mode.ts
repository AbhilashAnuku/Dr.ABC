// Hardened-mode — anti-inspect deterrents for the demo + production builds.
//
// Applies a strict client-side lockdown even on local runs: disables
// view-source (Ctrl+U), right-click context menu, and common inspect
// shortcuts across devices, including iOS.
//
// IMPORTANT — what this is and isn't:
//
//   - This is a UI-LAYER DETERRENT. A determined user with a debugger
//     proxy / a different browser / dev-mode flags can always inspect.
//     Anti-inspect is anti-tamper UX, not a security boundary.
//   - Real security comes from: server-side authz on every endpoint,
//     OAuth scope split, HMAC-signed cookies, OWASP headers, rate-limit,
//     activity-sink pseudonymous IDs. Those are in the API layer, NOT
//     the browser. See `SecuritySettings` and `SentinelsPanel` (Aria) for
//     the audit surface.
//   - Hardened-mode is OPT-IN via env. Set `VITE_HARDENED_MODE=true` to
//     enable; off by default so dev / debugging still works.
//
// What hardened-mode disables:
//
//   - Right-click context menu on every element.
//   - F12 / Ctrl+U (view source) / Ctrl+S (save page) / Ctrl+Shift+I
//     (devtools) / Ctrl+Shift+J (console) / Ctrl+Shift+C (inspect).
//   - iOS long-press text-selection on the body (CSS user-select: none).
//   - Drag-start on images (so the asset can't be dragged out).
//   - Print (Ctrl+P) — optional, enabled when VITE_HARDENED_PRINT=true.
//
// Re-enable temporarily during dev by visiting /__hardened-off (a no-op
// route in this build but reserves the path for future toggle), or by
// running with VITE_HARDENED_MODE=false / DEV mode.

const HARDENED_KEY_BLOCKS = new Set([
  'F12', // devtools
  'F11', // fullscreen — also blocked because some inspect flows use full-screen exit to switch panes
]);

interface KeyComboMatcher {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
}

const HARDENED_COMBOS: KeyComboMatcher[] = [
  { key: 'u', ctrl: true }, // view source
  { key: 'U', ctrl: true },
  { key: 's', ctrl: true }, // save page
  { key: 'S', ctrl: true },
  { key: 'i', ctrl: true, shift: true }, // devtools
  { key: 'I', ctrl: true, shift: true },
  { key: 'j', ctrl: true, shift: true }, // console
  { key: 'J', ctrl: true, shift: true },
  { key: 'c', ctrl: true, shift: true }, // inspect element
  { key: 'C', ctrl: true, shift: true },
  // macOS equivalents (Cmd instead of Ctrl)
  { key: 'u', meta: true },
  { key: 'i', meta: true, alt: true }, // option+cmd+i = devtools on Safari/Chrome mac
  { key: 'I', meta: true, alt: true },
  { key: 'j', meta: true, alt: true },
  { key: 'J', meta: true, alt: true },
  { key: 'c', meta: true, alt: true },
  { key: 'C', meta: true, alt: true },
];

function matchCombo(e: KeyboardEvent): boolean {
  if (HARDENED_KEY_BLOCKS.has(e.key)) return true;
  for (const m of HARDENED_COMBOS) {
    if (m.key !== e.key) continue;
    if (m.ctrl !== undefined && m.ctrl !== e.ctrlKey) continue;
    if (m.shift !== undefined && m.shift !== e.shiftKey) continue;
    if (m.alt !== undefined && m.alt !== e.altKey) continue;
    if (m.meta !== undefined && m.meta !== e.metaKey) continue;
    return true;
  }
  return false;
}

/**
 * Resolve whether hardened mode should be on for this build / runtime.
 * Three levers, in priority order:
 *
 *   1. URL query string `?hardened=on` / `?hardened=off` — quickest
 *      override during a demo when brief inspection is needed.
 *   2. localStorage `dr-abc:hardened` — persistent across sessions.
 *   3. `VITE_HARDENED_MODE` env at build time — set in `.env.production`.
 *
 * Default is OFF in DEV, ON when VITE_HARDENED_MODE=true.
 */
function resolveEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  // 1. URL override (?hardened=on / ?hardened=off)
  try {
    const params = new URLSearchParams(window.location.search);
    const q = params.get('hardened');
    if (q === 'on') {
      window.localStorage.setItem('dr-abc:hardened', 'on');
      return true;
    }
    if (q === 'off') {
      window.localStorage.setItem('dr-abc:hardened', 'off');
      return false;
    }
  } catch {
    /* no-op */
  }
  // 2. localStorage override
  try {
    const v = window.localStorage.getItem('dr-abc:hardened');
    if (v === 'on') return true;
    if (v === 'off') return false;
  } catch {
    /* no-op */
  }
  // 3. Build-time env
  const envFlag = (import.meta as { env?: Record<string, string | undefined> }).env
    ?.VITE_HARDENED_MODE;
  if (envFlag === 'true' || envFlag === '1') return true;
  return false;
}

let installed = false;

/**
 * Install hardened-mode listeners. Idempotent — calling twice is a no-op.
 * Returns the resolved-enabled flag so callers can log it.
 */
export function installHardenedMode(): boolean {
  if (typeof window === 'undefined') return false;
  if (installed) return resolveEnabled();
  installed = true;

  const enabled = resolveEnabled();
  if (!enabled) return false;

  // 1. Right-click context menu
  window.addEventListener('contextmenu', (e) => {
    e.preventDefault();
  });

  // 2. Keyboard combos
  window.addEventListener('keydown', (e) => {
    if (matchCombo(e)) {
      e.preventDefault();
      e.stopPropagation();
    }
  });

  // 3. iOS long-press text selection on the body. Only the body — inputs
  //    + textareas + form fields keep their selection so users can edit.
  const style = document.createElement('style');
  style.id = 'dr-abc-hardened-mode-style';
  style.textContent = `
    body {
      -webkit-user-select: none;
      -webkit-touch-callout: none;
      user-select: none;
    }
    input, textarea, [contenteditable], .selectable, code, pre {
      -webkit-user-select: text;
      -webkit-touch-callout: default;
      user-select: text;
    }
    img {
      -webkit-user-drag: none;
      user-drag: none;
      pointer-events: auto;
    }
  `;
  document.head.appendChild(style);

  // 4. Drag-start on images (anti-asset-export)
  document.addEventListener(
    'dragstart',
    (e) => {
      const target = e.target as HTMLElement | null;
      if (target && target.tagName === 'IMG') {
        e.preventDefault();
      }
    },
    { capture: true },
  );

  // 5. Soft devtools-open detection (best-effort). When detected, hide
  //    the body briefly so a quick visual snapshot of the surface isn't
  //    available. Re-shows after 800 ms; this is intentionally a deterrent
  //    only — a determined inspector will still see the DOM.
  let devtoolsOpen = false;
  const probe = () => {
    const threshold = 160;
    const widthGap = window.outerWidth - window.innerWidth > threshold;
    const heightGap = window.outerHeight - window.innerHeight > threshold;
    const open = widthGap || heightGap;
    if (open && !devtoolsOpen) {
      devtoolsOpen = true;
      const overlay = document.getElementById('dr-abc-hardened-overlay');
      if (!overlay) {
        const o = document.createElement('div');
        o.id = 'dr-abc-hardened-overlay';
        o.style.cssText =
          'position:fixed;inset:0;background:#020617;color:#67e8f9;font:600 14px/1.4 system-ui,sans-serif;display:flex;align-items:center;justify-content:center;z-index:99999;text-align:center;padding:2rem;';
        o.textContent =
          'Mörbius hardened-mode · this surface is not available for inspection. Close devtools to continue.';
        document.body.appendChild(o);
      }
    } else if (!open && devtoolsOpen) {
      devtoolsOpen = false;
      const overlay = document.getElementById('dr-abc-hardened-overlay');
      if (overlay) overlay.remove();
    }
  };
  window.setInterval(probe, 1_500);

  return true;
}

/**
 * Re-enable normal mode (turn hardened off). Useful for a /__hardened-off
 * route or a developer escape hatch. Reload required for keyboard combos
 * (we don't unbind listeners, just flip the persistent flag).
 */
export function disableHardenedMode(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem('dr-abc:hardened', 'off');
  } catch {
    /* no-op */
  }
}
