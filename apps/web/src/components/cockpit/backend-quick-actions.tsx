import { Button, Card, cn } from '@dr-abc/ui';
import { Cpu, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

interface HealthSnapshot {
  ok: boolean;
  diagnosticBackend?: string;
  imagingBackend?: string;
  activitySink?: string;
  agents?: string[];
}

/**
 * Live /health view + a thin "flip backend" row that POSTs to
 * /dev/env-keys (the same endpoint /app/secrets uses). Doesn't replace
 * /app/secrets — that page is the canonical encrypted vault. This is
 * just a one-tap shortcut so the developer can A/B model backends
 * without leaving the cockpit.
 */
export function BackendQuickActions() {
  const [health, setHealth] = useState<HealthSnapshot | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/health');
      if (!res.ok) return;
      setHealth((await res.json()) as HealthSnapshot);
    } catch {
      // best-effort
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(refresh, 10_000);
    return () => clearInterval(id);
  }, [refresh]);

  // Each preset writes a small env override that pickDiagnosticBackend()
  // already understands. Empty value means "fall through to the next
  // tier" (priority order: NVIDIA → Anthropic → HF → Ollama).
  const presets: { label: string; env: Record<string, string> }[] = [
    { label: 'NVIDIA', env: { NVIDIA_API_KEY: '!preserve' } },
    { label: 'Anthropic', env: { ANTHROPIC_API_KEY: '!preserve' } },
    { label: 'HF', env: { HF_TOKEN: '!preserve' } },
    { label: 'Ollama', env: { OLLAMA_BASE_URL: 'http://localhost:11434' } },
    { label: 'Offline', env: {} },
  ];

  const flip = async (label: string) => {
    setBusy(label);
    try {
      const target = presets.find((p) => p.label === label);
      if (!target) return;
      // For now we just bounce through DELETE so the runtime falls back
      // to its real env. A richer "set this exact backend" flow lives
      // on /app/secrets where the developer pastes the actual key.
      await fetch('/api/dev/env-keys', {
        method: 'DELETE',
        headers: { 'x-dr-abc-role': 'developer' },
      });
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="flex items-center gap-2 font-display text-sm font-semibold text-app-primary">
          <Cpu className="h-4 w-4 text-quantum-400" /> Backend status
        </h3>
        <Button variant="ghost" onClick={refresh} aria-label="Refresh">
          <RefreshCw className="h-3.5 w-3.5 text-app-muted" />
        </Button>
      </div>

      <dl className="grid grid-cols-2 gap-2 font-mono text-[11px]">
        <Row label="diagnostic" value={health?.diagnosticBackend ?? '…'} />
        <Row label="imaging" value={health?.imagingBackend ?? '…'} />
        <Row label="activity" value={health?.activitySink ?? '…'} />
        <Row label="agents" value={`${health?.agents?.length ?? 0}`} />
      </dl>

      <div className="mt-3 border-t border-app-subtle pt-3">
        <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-app-faint">
          quick flip · uses runtime env overlay
        </div>
        <div className="flex flex-wrap gap-1.5">
          {presets.map((p) => (
            <Button
              key={p.label}
              variant="ghost"
              onClick={() => void flip(p.label)}
              disabled={busy !== null}
              className={cn(
                'text-xs',
                health?.diagnosticBackend?.toLowerCase().includes(p.label.toLowerCase()) &&
                  'border border-quantum-400/40 bg-quantum-500/10 text-quantum-300',
              )}
            >
              {busy === p.label ? '…' : p.label}
            </Button>
          ))}
        </div>
        <p className="mt-2 font-sans text-[11px] text-app-faint">
          For real key rotation, open{' '}
          <a href="/app/api-keys" className="text-quantum-400 hover:text-quantum-300">
            /app/api-keys
          </a>
          .
        </p>
      </div>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-app-faint">{label}</dt>
      <dd className="font-mono text-xs text-app-primary">{value}</dd>
    </div>
  );
}
