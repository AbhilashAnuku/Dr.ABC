import { Card, cn } from '@dr-abc/ui';
import { Eye, EyeOff, Loader2, RotateCcw, Save, Wand2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { API_BASE } from '../../lib/config.ts';

/**
 * EnvEditor — live editor for the API's runtime env overlay.
 *
 * Reads:    GET    /dev/env-keys     → currently-overridden keys (redacted)
 * Patches:  POST   /dev/env-keys     → in-memory overlay, no restart
 * Persists: POST   /dev/env-persist  → writes to the on-disk .env AND
 *                                       applies to the in-memory overlay
 *
 * The "developer" header is always sent (single-demo identity, mock auth).
 *
 * Used in the dev console to rotate keys / change model ids / point at
 * a different py-svc URL without leaving the browser. Persist toggle
 * decides whether the change survives a dev-server restart (writes to
 * repo-root .env with .env.bak.<ts> backup).
 */

const FIELDS: { key: string; label: string; placeholder: string; secret: boolean }[] = [
  { key: 'ANTHROPIC_API_KEY', label: 'Anthropic key', placeholder: 'sk-ant-…', secret: true },
  {
    key: 'ANTHROPIC_MODEL',
    label: 'Anthropic model',
    placeholder: 'claude-sonnet-4-6',
    secret: false,
  },
  {
    key: 'ANTHROPIC_VISION_MODEL',
    label: 'Anthropic vision model',
    placeholder: 'claude-sonnet-4-6',
    secret: false,
  },
  { key: 'NVIDIA_API_KEY', label: 'NVIDIA key', placeholder: 'nvapi-…', secret: true },
  {
    key: 'NVIDIA_MODEL',
    label: 'NVIDIA model',
    placeholder: 'meta/llama-3.3-70b-instruct',
    secret: false,
  },
  { key: 'HF_API_TOKEN', label: 'HuggingFace token', placeholder: 'hf_…', secret: true },
  {
    key: 'HF_MODEL',
    label: 'HuggingFace model',
    placeholder: 'aaditya/Llama3-OpenBioLLM-8B',
    secret: false,
  },
  {
    key: 'OLLAMA_BASE_URL',
    label: 'Ollama URL',
    placeholder: 'http://localhost:11434',
    secret: false,
  },
  {
    key: 'OLLAMA_MODEL',
    label: 'Ollama model',
    placeholder: 'llama3.1:8b',
    secret: false,
  },
  { key: 'PY_SVC_URL', label: 'py-svc URL', placeholder: 'http://localhost:8000', secret: false },
  { key: 'PY_SVC_TIMEOUT_MS', label: 'py-svc timeout (ms)', placeholder: '30000', secret: false },
  { key: 'GOOGLE_FIT_TOKEN', label: 'Google Fit token', placeholder: 'ya29.…', secret: true },
  {
    key: 'MORBIUS_BACKEND',
    label: 'Pin backend',
    placeholder: 'anthropic | nvidia | huggingface | ollama',
    secret: false,
  },
  {
    key: 'BACKEND_PRIORITY',
    label: 'Backend priority',
    placeholder: 'anthropic,nvidia,ollama',
    secret: false,
  },
];

interface OverrideRow {
  key: string;
  redacted: string;
}

export function EnvEditor() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [reveal, setReveal] = useState<Record<string, boolean>>({});
  const [overrides, setOverrides] = useState<OverrideRow[]>([]);
  const [persist, setPersist] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const fetchOverrides = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/dev/env-keys`, {
        headers: { 'X-Dr-Abc-Role': 'developer' },
      });
      if (!r.ok) return;
      const j = (await r.json()) as { overrides?: OverrideRow[] };
      setOverrides(j.overrides ?? []);
    } catch {
      // best-effort
    }
  }, []);

  useEffect(() => {
    void fetchOverrides();
  }, [fetchOverrides]);

  const dirtyKeys = useMemo(() => Object.keys(values).filter((k) => values[k] !== ''), [values]);

  const submit = async () => {
    if (dirtyKeys.length === 0) return;
    const payload = dirtyKeys.reduce<Record<string, string>>((acc, k) => {
      acc[k] = values[k] ?? '';
      return acc;
    }, {});
    setBusy(true);
    setStatus(null);
    try {
      const url = persist ? `${API_BASE}/dev/env-persist` : `${API_BASE}/dev/env-keys`;
      const body = persist ? { values: payload } : payload;
      const r = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Dr-Abc-Role': 'developer',
        },
        body: JSON.stringify(body),
      });
      const j = (await r.json().catch(() => ({}))) as {
        ok?: boolean;
        applied?: number;
        rejected?: string[];
        diagnosticBackend?: string;
        imagingBackend?: string;
        persistedTo?: string;
      };
      if (!r.ok || !j.ok) {
        setStatus({ kind: 'err', text: `failed (${r.status})` });
      } else {
        setStatus({
          kind: 'ok',
          text: `applied ${j.applied ?? dirtyKeys.length} key${(j.applied ?? 1) === 1 ? '' : 's'}${
            persist ? ' + saved to .env' : ' (in-memory only)'
          } · diagnostic→${j.diagnosticBackend ?? '?'} · imaging→${j.imagingBackend ?? '?'}`,
        });
        setValues({});
        await fetchOverrides();
      }
    } catch (e) {
      setStatus({ kind: 'err', text: e instanceof Error ? e.message : 'submit failed' });
    } finally {
      setBusy(false);
    }
  };

  const clearAll = async () => {
    if (!confirm('Clear every runtime override? This drops back to .env values.')) return;
    setBusy(true);
    setStatus(null);
    try {
      const r = await fetch(`${API_BASE}/dev/env-keys`, {
        method: 'DELETE',
        headers: { 'X-Dr-Abc-Role': 'developer' },
      });
      const j = (await r.json().catch(() => ({}))) as {
        ok?: boolean;
        diagnosticBackend?: string;
        imagingBackend?: string;
      };
      setStatus({
        kind: j.ok ? 'ok' : 'err',
        text: j.ok
          ? `overrides cleared · diagnostic→${j.diagnosticBackend} · imaging→${j.imagingBackend}`
          : 'clear failed',
      });
      await fetchOverrides();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.32em] text-quantum-300">
              <Wand2 className="h-3 w-3" /> · env editor · hot-reload
            </div>
            <h2 className="mt-1 font-display text-xl font-bold text-app-primary">
              Rotate keys without leaving the browser.
            </h2>
            <p className="mt-1 max-w-2xl font-sans text-xs text-app-muted">
              Edit any field below and click <span className="font-mono">save</span>. With{' '}
              <span className="font-mono">persist</span> on (default), the value is written into the
              repo-root <code>.env</code> (previous file backed up to{' '}
              <code>.env.bak.&lt;ts&gt;</code>) and the in-memory overlay is rebuilt — no dev-server
              restart needed. With persist off, the change is in-memory only and survives until the
              next restart.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-app-subtle px-3 py-1 font-mono text-[10px] uppercase tracking-[0.22em] text-app-muted">
              <input
                type="checkbox"
                checked={persist}
                onChange={(e) => setPersist(e.target.checked)}
                className="accent-quantum-400"
              />
              persist to .env
            </label>
            <button
              type="button"
              onClick={clearAll}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-md border border-app-subtle px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-app-muted transition hover:border-rose-400/40 hover:text-rose-300 disabled:opacity-50"
            >
              <RotateCcw className="h-3 w-3" /> clear overrides
            </button>
          </div>
        </div>
      </Card>

      <Card className="p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FIELDS.map((f) => {
            const current = values[f.key] ?? '';
            const isSecret = f.secret;
            const revealed = reveal[f.key];
            const overlayHit = overrides.find((o) => o.key === f.key);
            return (
              <label key={f.key} className="flex flex-col gap-1">
                <span className="inline-flex items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-app-muted">
                  <span>{f.label}</span>
                  {overlayHit && (
                    <span className="rounded-full bg-bio-500/15 px-2 py-0.5 text-[9px] text-bio-300">
                      live: {overlayHit.redacted || '··'}
                    </span>
                  )}
                </span>
                <div className="relative flex items-center">
                  <input
                    value={current}
                    onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
                    type={isSecret && !revealed ? 'password' : 'text'}
                    placeholder={f.placeholder}
                    spellCheck={false}
                    autoComplete="off"
                    className="w-full rounded-lg border border-app-subtle bg-black/20 py-1.5 pr-9 pl-3 font-mono text-xs text-app-primary placeholder:text-app-faint focus:border-quantum-400/50 focus:outline-none"
                  />
                  {isSecret && (
                    <button
                      type="button"
                      onClick={() => setReveal((p) => ({ ...p, [f.key]: !p[f.key] }))}
                      aria-label={revealed ? 'Hide' : 'Reveal'}
                      className="absolute right-2 rounded p-1 text-app-faint transition hover:text-app-primary"
                    >
                      {revealed ? (
                        <EyeOff className="h-3.5 w-3.5" />
                      ) : (
                        <Eye className="h-3.5 w-3.5" />
                      )}
                    </button>
                  )}
                </div>
              </label>
            );
          })}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-app-subtle pt-4">
          <div
            className={cn(
              'font-mono text-[11px]',
              dirtyKeys.length > 0 ? 'text-bio-300' : 'text-app-faint',
            )}
          >
            {dirtyKeys.length === 0
              ? 'no edits queued'
              : `${dirtyKeys.length} key${dirtyKeys.length === 1 ? '' : 's'} ready: ${dirtyKeys.join(', ')}`}
          </div>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || dirtyKeys.length === 0}
            className="inline-flex items-center gap-1.5 rounded-md border border-quantum-400/40 bg-quantum-500/15 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.22em] text-quantum-200 transition hover:bg-quantum-500/25 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
            {persist ? 'save + persist' : 'save (memory)'}
          </button>
        </div>

        {status && (
          <div
            className={cn(
              'mt-3 rounded-lg border px-3 py-2 font-mono text-[11px]',
              status.kind === 'ok'
                ? 'border-bio-500/40 bg-bio-500/10 text-bio-300'
                : 'border-rose-500/40 bg-rose-500/10 text-rose-300',
            )}
          >
            {status.text}
          </div>
        )}
      </Card>
    </div>
  );
}
