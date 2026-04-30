import { useEffect, useState } from 'react';
import { API_BASE } from './config.ts';

export type DiagnosticBackend = 'anthropic' | 'nvidia' | 'huggingface' | 'ollama' | 'offline';

interface BackendStatus {
  ok: boolean;
  backend: DiagnosticBackend;
  /** True while the first probe is in flight — UI should hide the banner. */
  loading: boolean;
}

/**
 * Probes /health on mount + every 30 s so the UI knows whether the
 * reasoning model is actually reachable. Returns 'offline' silently if
 * the API itself is unreachable — the banner copy will say so.
 */
export function useBackendStatus(): BackendStatus {
  const [state, setState] = useState<BackendStatus>({
    ok: false,
    backend: 'offline',
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;
    const probe = async () => {
      try {
        const res = await fetch(`${API_BASE}/health`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { diagnosticBackend?: DiagnosticBackend };
        if (cancelled) return;
        setState({
          ok: true,
          backend: json.diagnosticBackend ?? 'offline',
          loading: false,
        });
      } catch {
        if (cancelled) return;
        setState({ ok: false, backend: 'offline', loading: false });
      }
    };
    void probe();
    const id = window.setInterval(probe, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return state;
}
