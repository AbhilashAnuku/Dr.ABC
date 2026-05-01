import { Button, Card, cn } from '@dr-abc/ui';
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Plus,
  ShieldOff,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { MobileShareQR } from '../components/mobile-share-qr.tsx';
import { useAuth } from '../lib/auth.tsx';
import { API_BASE } from '../lib/config.ts';

/**
 * /app/api-keys — generate + manage Mörbius API keys.
 *
 * Supports API access for external clients such as Postman. Every issued key starts
 * with `morbius_` and is validated by the Hono middleware on every
 * request — pass it as `Authorization: Bearer morbius_…` and you can
 * call /orchestrate, /research, /imaging from curl, Postman, or any
 * external client.
 *
 * Key secrets are shown ONCE at issue time + cached locally so the
 * developer can re-copy them within the session. After a refresh only
 * the prefix + label remain — same posture as GitHub PATs.
 */

interface KeyMeta {
  id: string;
  userId: string;
  label: string;
  createdAt: number;
  lastUsedAt: number | null;
  active: boolean;
  scopes: string[];
}

interface IssuedKey extends KeyMeta {
  /** Only present in-memory until the page is refreshed. */
  secret?: string;
}

const SECRET_CACHE = new Map<string, string>();

export function ApiKeysPage() {
  const { user } = useAuth();
  const [keys, setKeys] = useState<IssuedKey[]>([]);
  const [label, setLabel] = useState('postman-local');
  const [issuing, setIssuing] = useState(false);
  const [revealId, setRevealId] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      const res = await fetch(`${API_BASE}/api-keys`, {
        headers: { 'X-Dr-Abc-User': user.id },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { keys: KeyMeta[] };
      setKeys(
        json.keys.map((k) => ({
          ...k,
          secret: SECRET_CACHE.get(k.id),
        })),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    void refresh();
  }, [user, refresh]);

  const issue = async () => {
    if (!user) return;
    setIssuing(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api-keys`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'X-Dr-Abc-User': user.id },
        body: JSON.stringify({ label }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { key: string; meta: KeyMeta };
      SECRET_CACHE.set(json.meta.id, json.key);
      setRevealId(json.meta.id);
      setLabel('');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIssuing(false);
    }
  };

  const revoke = async (id: string) => {
    if (!user) return;
    try {
      const res = await fetch(`${API_BASE}/api-keys/${id}`, {
        method: 'DELETE',
        headers: { 'X-Dr-Abc-User': user.id },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      SECRET_CACHE.delete(id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const copy = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied(null), 1400);
    } catch {
      // best-effort
    }
  };

  if (!user) return null;

  return (
    <div className="space-y-6">
      {/* MobileShareQR is placed at the top of /app/api-keys so it's reachable
          without unlocking the dev-console. The same component also renders on
          the dev-console — it has two visible homes. */}
      <MobileShareQR />

      <header>
        <div className="mb-1 inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.32em] text-purple-300">
          <KeyRound className="h-3 w-3" /> · Mörbius API
        </div>
        <h1 className="font-syne text-3xl font-bold text-app-primary sm:text-4xl">
          API keys & Postman
        </h1>
        <p className="mt-2 max-w-2xl font-grotesk text-sm text-app-muted">
          Issue a key, then call any Mörbius endpoint with{' '}
          <code className="rounded bg-white/5 px-1 py-0.5 font-mono text-xs text-purple-200">
            Authorization: Bearer morbius_…
          </code>{' '}
          from Postman, curl, or your own service.
        </p>
      </header>

      {/* ISSUE A NEW KEY */}
      <Card className="p-5">
        <div className="mb-3 flex items-center gap-2">
          <Plus className="h-4 w-4 text-purple-300" />
          <span className="font-syne text-base font-semibold text-app-primary">
            Issue a new key
          </span>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="postman-local · ci · iphone-test …"
            className="flex-1 rounded-lg border border-app-subtle bg-white/5 px-3 py-2 font-grotesk text-sm text-app-primary placeholder:text-app-faint focus:border-purple-400/60 focus:outline-none"
          />
          <Button
            variant="primary"
            onClick={() => void issue()}
            disabled={issuing || !label.trim()}
            className="rounded-lg bg-gradient-to-r from-purple-600 to-blue-600 px-5 hover:from-purple-500 hover:to-blue-500"
          >
            {issuing ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="mr-1.5 h-4 w-4" />
            )}
            Generate key
          </Button>
        </div>
        {error && <p className="mt-2 font-mono text-[11px] text-rose-300">{error}</p>}
      </Card>

      {/* KEY LIST */}
      <Card className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-blue-300" />
            <span className="font-syne text-base font-semibold text-app-primary">
              Active keys ({keys.filter((k) => k.active).length})
            </span>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            className="font-mono text-[10px] uppercase tracking-[0.22em] text-app-muted hover:text-app-primary"
          >
            refresh
          </button>
        </div>
        {keys.length === 0 ? (
          <p className="font-grotesk text-sm text-app-muted">
            No keys yet. Generate one above and the secret will appear once — copy it into Postman
            before navigating away.
          </p>
        ) : (
          <ul className="space-y-3">
            {keys.map((k) => (
              <li
                key={k.id}
                className={cn(
                  'rounded-xl border bg-white/[0.025] p-4 transition',
                  k.active
                    ? 'border-app-subtle hover:border-purple-400/40'
                    : 'border-rose-500/30 bg-rose-500/5 opacity-60',
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-syne text-base font-semibold text-app-primary">
                      {k.label}
                    </div>
                    <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
                      {k.id} · created {new Date(k.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.22em]',
                        k.active
                          ? 'border-bio-500/40 bg-bio-500/10 text-bio-300'
                          : 'border-rose-500/40 bg-rose-500/10 text-rose-300',
                      )}
                    >
                      {k.active ? 'live' : 'revoked'}
                    </span>
                    {k.active && (
                      <button
                        type="button"
                        onClick={() => void revoke(k.id)}
                        className="inline-flex items-center gap-1 rounded-md border border-rose-500/40 bg-rose-500/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.22em] text-rose-300 hover:bg-rose-500/20"
                      >
                        <ShieldOff className="h-3 w-3" />
                        revoke
                      </button>
                    )}
                  </div>
                </div>

                {k.secret && (
                  <div className="mt-3 rounded-lg border border-purple-400/30 bg-purple-500/5 p-3">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-purple-300">
                        secret · copy now, won't show again after refresh
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setRevealId(revealId === k.id ? null : k.id)}
                          className="rounded-md p-1 text-app-muted hover:text-app-primary"
                          aria-label={revealId === k.id ? 'Hide secret' : 'Reveal secret'}
                        >
                          {revealId === k.id ? (
                            <EyeOff className="h-3.5 w-3.5" />
                          ) : (
                            <Eye className="h-3.5 w-3.5" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => k.secret && copy(k.secret, k.id)}
                          className="inline-flex items-center gap-1 rounded-md border border-app-subtle bg-white/5 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.22em] text-app-muted hover:text-app-primary"
                        >
                          {copied === k.id ? (
                            <>
                              <Check className="h-3 w-3 text-bio-400" /> copied
                            </>
                          ) : (
                            <>
                              <Copy className="h-3 w-3" /> copy
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                    <code className="block break-all font-mono text-xs text-purple-100">
                      {revealId === k.id
                        ? k.secret
                        : `${k.secret.slice(0, 14)}…${k.secret.slice(-4)}`}
                    </code>
                  </div>
                )}

                {k.lastUsedAt && (
                  <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
                    last used {new Date(k.lastUsedAt).toLocaleString()}
                  </div>
                )}

                <PostmanSnippet keyValue={k.secret} keyId={k.id} />

                <button
                  type="button"
                  onClick={() => SECRET_CACHE.delete(k.id) && refresh()}
                  className={cn(
                    'mt-3 inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.22em] text-rose-300 hover:text-rose-200',
                    !k.secret && 'hidden',
                  )}
                >
                  <Trash2 className="h-3 w-3" /> clear cached secret
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function PostmanSnippet({ keyValue, keyId }: { keyValue: string | undefined; keyId: string }) {
  const [tab, setTab] = useState<'curl' | 'postman' | 'fetch'>('curl');
  const [copied, setCopied] = useState(false);
  const display = keyValue ?? 'morbius_<your-secret>';

  const curl = `curl -X POST http://localhost:8787/orchestrate \\
  -H "Authorization: Bearer ${display}" \\
  -H "Content-Type: application/json" \\
  -d '{"text":"crushing chest pain radiating to left arm"}'`;

  const postman = `Method:  POST
URL:     http://localhost:8787/orchestrate
Headers:
  Authorization: Bearer ${display}
  Content-Type:  application/json
Body (raw, JSON):
  { "text": "crushing chest pain radiating to left arm" }`;

  const fetchSnippet = `await fetch('http://localhost:8787/orchestrate', {
  method: 'POST',
  headers: {
    Authorization: 'Bearer ${display}',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ text: 'crushing chest pain radiating to left arm' }),
});`;

  const text = tab === 'curl' ? curl : tab === 'postman' ? postman : fetchSnippet;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // best-effort
    }
  };

  return (
    <div className="mt-3 rounded-lg border border-app-subtle bg-black/30 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1">
          {(['curl', 'postman', 'fetch'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                'rounded-md border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.22em] transition',
                tab === t
                  ? 'border-purple-400/40 bg-purple-500/15 text-purple-200'
                  : 'border-app-subtle text-app-muted hover:text-app-primary',
              )}
            >
              {t}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => void copy()}
          className="inline-flex items-center gap-1 rounded-md border border-app-subtle bg-white/5 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.22em] text-app-muted hover:text-app-primary"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-bio-400" /> copied
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" /> copy
            </>
          )}
        </button>
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-app-secondary">
        <code>{text}</code>
      </pre>
      <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
        key id · {keyId}
      </p>
    </div>
  );
}
