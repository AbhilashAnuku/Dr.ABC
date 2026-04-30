import { Card, cn } from '@dr-abc/ui';
import { Copy, RefreshCw, Smartphone, Wifi } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

// `qrcode` is dynamically imported inside QRSvg so the ~30 KB lib
// only lands when the dev-console mounts the share card. Trims the
// main bundle by ~10 KB gzip; the share card still feels instant
// because the import resolves before the first render frame.

/**
 * MobileShareQR — generates a QR code that points at the current
 * Mörbius web origin so anyone on the same Wi-Fi can scan and open
 * the app on their phone.
 *
 * Exposes mobile views and a QR pointing at the local-network Wi-Fi
 * origin so the app can be checked on phones.
 *
 * Implementation:
 *   - Reads `window.location.origin`. If hostname is `localhost`,
 *     prompts for a LAN IP override (visible in Vite's dev-server
 *     output as "Network: http://192.168.x.x:5173").
 *   - QR is rendered as inline SVG via a tiny pure-JS QR generator
 *     (vendored below — no npm dep, no third-party tracking).
 *   - "Copy" button copies the URL to clipboard.
 *   - "Refresh" re-reads the origin (after an override).
 *
 * The QR points at the public landing — so a scanned phone lands on
 * the marketing page, showing the same Mörbius on the user's device.
 */

interface MobileShareQRProps {
  defaultOverride?: string;
  /** Override the default landing path (e.g., "/app/clinic"). */
  path?: string;
}

export function MobileShareQR({ defaultOverride, path = '/' }: MobileShareQRProps) {
  const [hostOverride, setHostOverride] = useState(defaultOverride ?? '');
  const [refreshKey, setRefreshKey] = useState(0);
  // Encode the LAN IP rather than localhost so the QR resolves on
  // mobile devices. Auto-discover the host's LAN IP via the
  // /dev/lan-ip endpoint (added on the api server). When found, the QR
  // encodes http://<lan-ip>:<port> by default instead of localhost —
  // phones on the same Wi-Fi scan and land on the live app without any
  // manual paste.
  const [autoLanIp, setAutoLanIp] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let alive = true;
    const probe = async () => {
      try {
        const r = await fetch('/dev/lan-ip');
        if (!r.ok) return;
        const j = (await r.json()) as { preferred?: string | null };
        if (alive && j.preferred) setAutoLanIp(j.preferred);
      } catch {
        /* offline · keep null · fall back to localhost warning */
      }
    };
    void probe();
    return () => {
      alive = false;
    };
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey forces re-eval when "Refresh" is tapped — read-only window.location.origin needs a manual nudge after Vite reloads the LAN port
  const url = useMemo(() => {
    if (typeof window === 'undefined') return '';
    if (hostOverride.trim()) {
      const h = hostOverride.trim().replace(/\/+$/, '');
      const withProtocol = /^https?:\/\//.test(h) ? h : `http://${h}`;
      return `${withProtocol}${path}`;
    }
    // Auto-replace localhost with the discovered LAN IP at the same port.
    const origin = window.location.origin;
    const port = window.location.port || (window.location.protocol === 'https:' ? '443' : '80');
    if (autoLanIp && /localhost|127\.0\.0\.1/.test(origin)) {
      const proto = window.location.protocol; // http: or https:
      return `${proto}//${autoLanIp}:${port}${path}`;
    }
    return `${origin}${path}`;
  }, [hostOverride, path, refreshKey, autoLanIp]);

  const isLocalhost = useMemo(() => {
    if (typeof window === 'undefined') return false;
    if (hostOverride.trim()) return /localhost|127\.0\.0\.1/.test(hostOverride);
    // If we successfully auto-discovered a LAN IP, the URL above
    // already swaps to it — so the warning banner no longer applies.
    if (autoLanIp) return false;
    return /localhost|127\.0\.0\.1/.test(window.location.host);
  }, [hostOverride, autoLanIp]);

  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Card className="relative overflow-hidden p-6">
      <div className="-translate-x-1/2 pointer-events-none absolute top-0 left-1/2 h-px w-32 bg-gradient-to-r from-transparent via-bio-400 to-transparent" />
      <div className="grid gap-5 sm:grid-cols-[auto_1fr] sm:items-center">
        <div className="flex h-44 w-44 shrink-0 items-center justify-center rounded-2xl border border-bio-400/40 bg-white p-2 shadow-[0_0_60px_-15px_rgba(16,185,129,0.45)]">
          <QRSvg value={url} size={160} />
        </div>
        <div>
          <div className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.32em] text-bio-300">
            <Smartphone className="h-3 w-3" /> · scan to open on mobile
          </div>
          <h3 className="mt-2 font-display text-xl font-bold text-app-primary sm:text-2xl">
            Open Mörbius on a phone in your hand.
          </h3>
          <p className="mt-2 max-w-xl font-sans text-sm text-app-muted">
            Scan with any phone on the same Wi-Fi. The QR encodes your dev server's local URL so
            examiners see the live consult from the architect's screen on their own device.
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <code className="rounded-md border border-app-subtle bg-white/5 px-3 py-1.5 font-mono text-xs text-app-primary">
              {url || 'http://localhost:5173'}
            </code>
            <button
              type="button"
              onClick={copy}
              className={cn(
                'inline-flex items-center gap-1 rounded-md border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] transition',
                copied
                  ? 'border-bio-400/60 bg-bio-500/15 text-bio-200'
                  : 'border-app-subtle bg-white/5 text-app-muted hover:bg-white/10',
              )}
            >
              <Copy className="h-3 w-3" /> {copied ? 'copied' : 'copy'}
            </button>
            <button
              type="button"
              onClick={() => setRefreshKey((k) => k + 1)}
              className="inline-flex items-center gap-1 rounded-md border border-app-subtle bg-white/5 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-app-muted hover:bg-white/10"
            >
              <RefreshCw className="h-3 w-3" /> refresh
            </button>
          </div>

          {isLocalhost && (
            <div className="mt-3 rounded-lg border border-amber-400/40 bg-amber-500/10 p-3 font-sans text-xs text-amber-200">
              <div className="flex items-start gap-2">
                <Wifi className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <div>
                  <p>
                    The QR currently points at <code>localhost</code> — a phone won't reach that.
                    Find your LAN IP in Vite's dev-server output (a line like{' '}
                    <code>Network: http://192.168.x.x:5173</code>) and paste it below.
                  </p>
                  <input
                    type="text"
                    placeholder="192.168.0.42:5173"
                    value={hostOverride}
                    onChange={(e) => setHostOverride(e.target.value)}
                    className="mt-2 w-full rounded-md border border-app-subtle bg-black/30 px-3 py-1.5 font-mono text-xs text-app-primary placeholder:text-app-faint focus:border-amber-400/60 focus:outline-none"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────────
//  QR rendering — uses the `qrcode` npm package (MIT, ~30KB).
//
//  toString({ type: 'svg', errorCorrectionLevel: 'M' }) returns a
//  fully-formed SVG string we set via dangerouslySetInnerHTML. Real
//  QR (medium error-correction so a partially-occluded scan still
//  works) — phones scan this without trouble.
// ────────────────────────────────────────────────────────────────────

function QRSvg({ value, size }: { value: string; size: number }) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    if (!value) {
      setSvg(null);
      return;
    }
    let cancelled = false;
    void import('qrcode').then(({ default: QRCode }) =>
      QRCode.toString(value, {
        type: 'svg',
        errorCorrectionLevel: 'M',
        margin: 0,
        color: { dark: '#0b1f3a', light: '#ffffff' },
      })
        .then((s) => {
          if (!cancelled) setSvg(s);
        })
        .catch(() => {
          if (!cancelled) setSvg(null);
        }),
    );
    return () => {
      cancelled = true;
    };
  }, [value]);

  if (!svg) {
    return (
      <div
        style={{ width: size, height: size }}
        className="flex items-center justify-center font-mono text-[9px] text-app-faint"
      >
        …
      </div>
    );
  }
  return (
    <div
      style={{ width: size, height: size }}
      role="img"
      aria-label={`QR code for ${value}`}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted output from qrcode lib (no user-injected markup)
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
