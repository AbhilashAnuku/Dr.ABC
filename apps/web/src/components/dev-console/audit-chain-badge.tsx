// TODO(i18n): wrap user-facing strings in t() once an `audit` namespace
// exists in en/de/hi.json.
import { Card, cn } from '@dr-abc/ui';
import { CheckCircle2, KeyRound, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { API_BASE } from '../../lib/config.ts';

/**
 * Audit-chain integrity badge for the dev-console Health tab.
 *
 * Posts a synthetic chain of 3 entries to /audit/sign + /audit/verify
 * and renders a green/amber/red pill depending on whether the chain
 * verifies. Also surfaces the `keyHint` so the operator can detect a
 * key rotation (the hint changes on rotation).
 *
 * v0.6.2 Phase B.6 from PLAN-v0.7.
 */

interface SignedEntry {
  id: string;
  ts: string;
  kind: string;
  userId: string;
  payload: Record<string, unknown>;
  hash: string;
  prevHash: string;
  signature: string;
  keyHint: string;
}

interface VerifyResult {
  ok: boolean;
  length?: number;
  brokenAt?: number;
  reason?: string;
  keyHint: string;
}

export function AuditChainBadge() {
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const probe = async () => {
      try {
        // 1. Sign 3 synthetic entries
        const entries: SignedEntry[] = [];
        for (let i = 0; i < 3; i++) {
          const r = await fetch(`${API_BASE}/audit/sign`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              id: `audit-probe-${i}`,
              ts: new Date().toISOString(),
              kind: 'admin',
              userId: 'dev-console',
              payload: { probe: i },
            }),
          });
          if (!r.ok) throw new Error(`sign HTTP ${r.status}`);
          const signed = (await r.json()) as SignedEntry;
          entries.push(signed);
        }
        // 2. Verify the chain
        const v = await fetch(`${API_BASE}/audit/verify`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ entries }),
        });
        const vj = (await v.json()) as VerifyResult;
        if (!cancelled) setResult(vj);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'audit probe failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void probe();
    const id = setInterval(probe, 90_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  let tone: 'ok' | 'warn' | 'err' = 'ok';
  let label = 'verifying…';
  let Icon = ShieldCheck;
  if (loading) {
    tone = 'warn';
    label = 'probing audit chain…';
    Icon = ShieldAlert;
  } else if (error) {
    tone = 'err';
    label = `chain unreachable · ${error}`;
    Icon = ShieldAlert;
  } else if (result?.ok) {
    tone = 'ok';
    label = `chain integrity · ✓ length ${result.length ?? 3}`;
    Icon = CheckCircle2;
  } else if (result) {
    tone = 'err';
    label = `tampered · brokenAt=${result.brokenAt} · ${result.reason ?? ''}`.slice(0, 80);
    Icon = ShieldAlert;
  }

  const toneClass =
    tone === 'ok'
      ? 'border-bio-500/40 bg-bio-500/10 text-bio-300'
      : tone === 'warn'
        ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
        : 'border-rose-500/40 bg-rose-500/10 text-rose-300';

  return (
    <Card className="p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icon
            className={cn(
              'h-4 w-4',
              toneClass.split(' ').find((c) => c.startsWith('text-')),
            )}
          />
          <span className="font-display text-sm font-semibold text-app-primary">
            HIPAA audit chain · Ed25519
          </span>
        </div>
        <span
          className={cn(
            'rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em]',
            toneClass,
          )}
        >
          {tone === 'ok' ? '● green' : tone === 'warn' ? '● amber' : '● red'}
        </span>
      </div>
      <p className="mt-1 font-sans text-xs text-app-muted">{label}</p>
      {result?.keyHint && (
        <div className="mt-2 inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-app-faint">
          <KeyRound className="h-3 w-3" />
          key-hint · {result.keyHint}
        </div>
      )}
    </Card>
  );
}
