// Sentinels — Veronica (accuracy) + Aria (security).
//
// Two strict watchers continuously audit Mörbius: Veronica guards
// accuracy across memos, clinical-data reads, analysis, and
// test/train cycles, while Aria enforces end-to-end data protection
// (encryption, credential hygiene, header hardening) across every
// surface that touches real PubMed data.
//
// Two read-only watchers that don't run consults — they only audit.
// Veronica reads /errors/stats + /research/snapshot and surfaces drift +
// gauntlet pass rate. Aria reads a synthetic security-posture probe
// (ENV scan + endpoint header check) and grades the deployment's lock-
// down. Both refresh every 15 s. Zero PHI leaves the panel — all data
// is already on-device.

import { Card } from '@dr-abc/ui';
import { Lock, type LucideIcon, ScanEye, ShieldAlert, ShieldCheck, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';

type Severity = 'green' | 'amber' | 'red';

interface AccuracyReport {
  passRate: number | null;
  errorEvents: number | null;
  averageMagnitude: number | null;
  kgNodes: number | null;
  kgEdges: number | null;
  lastCycleAt: string | null;
  severity: Severity;
}

interface SecurityReport {
  envSecretsPresent: number;
  envSecretsExposed: number;
  hipaaSigningKey: 'set' | 'absent';
  oauthSplit: 'split' | 'merged' | 'unknown';
  rateLimitArmed: boolean;
  ownerHeader: 'present' | 'absent' | 'unknown';
  contentTypeOptions: 'present' | 'absent' | 'unknown';
  hsts: 'present' | 'absent' | 'unknown';
  severity: Severity;
}

const SEVERITY_TONE: Record<Severity, { dot: string; bg: string; border: string; label: string }> =
  {
    green: {
      dot: 'bg-bio-400',
      bg: 'bg-bio-500/10',
      border: 'border-bio-400/40',
      label: 'green · standing',
    },
    amber: {
      dot: 'bg-amber-400',
      bg: 'bg-amber-500/10',
      border: 'border-amber-400/40',
      label: 'amber · check',
    },
    red: {
      dot: 'bg-rose-400',
      bg: 'bg-rose-500/10',
      border: 'border-rose-400/40',
      label: 'red · escalate',
    },
  };

function fmtPct(v: number | null): string {
  if (v === null) return '--.--';
  return `${(v * 100).toFixed(1)}%`;
}

function fmtTimeAgo(iso: string | null): string {
  if (!iso) return 'never';
  const dt = Date.now() - new Date(iso).getTime();
  if (dt < 60_000) return 'just now';
  if (dt < 3_600_000) return `${Math.round(dt / 60_000)}m ago`;
  if (dt < 86_400_000) return `${Math.round(dt / 3_600_000)}h ago`;
  return `${Math.round(dt / 86_400_000)}d ago`;
}

function SentinelHeader({
  name,
  subtitle,
  icon: Icon,
  severity,
}: {
  name: string;
  subtitle: string;
  icon: LucideIcon;
  severity: Severity;
}) {
  const tone = SEVERITY_TONE[severity];
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <div className={`rounded-full border ${tone.border} ${tone.bg} p-2`}>
          <Icon className="h-4 w-4 text-app-primary" />
        </div>
        <div>
          <div className="font-display text-base font-semibold text-app-primary">{name}</div>
          <div className="font-sans text-[11px] text-app-muted">{subtitle}</div>
        </div>
      </div>
      <div className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 ${tone.border}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
        <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-app-secondary">
          {tone.label}
        </span>
      </div>
    </div>
  );
}

function StatRow({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="font-sans text-[11px] text-app-muted">{label}</span>
      <span
        className={`text-app-primary tabular-nums ${
          mono ? 'font-mono text-[11px]' : 'font-sans text-[11px]'
        }`}
      >
        {value}
      </span>
    </div>
  );
}

// ----- Veronica · accuracy guardian ---------------------------------

function VeronicaCard() {
  const [report, setReport] = useState<AccuracyReport>({
    passRate: null,
    errorEvents: null,
    averageMagnitude: null,
    kgNodes: null,
    kgEdges: null,
    lastCycleAt: null,
    severity: 'amber',
  });

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      let pass: number | null = null;
      let total: number | null = null;
      let avgMag: number | null = null;
      let nodes: number | null = null;
      let edges: number | null = null;
      let lastAt: string | null = null;
      try {
        const r = await fetch('/errors/stats');
        if (r.ok) {
          const j = (await r.json()) as {
            total?: number;
            pass_rate?: number;
            average_magnitude?: number;
          };
          pass = typeof j.pass_rate === 'number' ? j.pass_rate : null;
          total = typeof j.total === 'number' ? j.total : null;
          avgMag = typeof j.average_magnitude === 'number' ? j.average_magnitude : null;
        }
      } catch {
        /* ignore */
      }
      try {
        const r = await fetch('/research/snapshot');
        if (r.ok) {
          const j = (await r.json()) as {
            graph?: { nodes?: number; edges?: number };
            last_cycle_at?: string;
          };
          nodes = j.graph?.nodes ?? null;
          edges = j.graph?.edges ?? null;
          lastAt = j.last_cycle_at ?? null;
        }
      } catch {
        /* ignore */
      }
      // Severity model · pass-rate is the headline.
      let severity: Severity = 'amber';
      if (pass !== null) {
        if (pass >= 0.8) severity = 'green';
        else if (pass < 0.6) severity = 'red';
      }
      if (alive) {
        setReport({
          passRate: pass,
          errorEvents: total,
          averageMagnitude: avgMag,
          kgNodes: nodes,
          kgEdges: edges,
          lastCycleAt: lastAt,
          severity,
        });
      }
    };
    tick();
    const id = window.setInterval(tick, 15_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  return (
    <Card className="flex flex-col gap-3 p-4">
      <SentinelHeader
        name="Veronica"
        subtitle="accuracy guardian · gauntlet · Second Brain · drift"
        icon={Sparkles}
        severity={report.severity}
      />
      <div className="flex flex-col divide-y divide-app-subtle">
        <StatRow label="Secure-Pass rate" value={fmtPct(report.passRate)} />
        <StatRow
          label="boosting journal · events"
          value={report.errorEvents === null ? '----' : report.errorEvents.toString()}
        />
        <StatRow
          label="avg residual magnitude"
          value={report.averageMagnitude === null ? '----' : report.averageMagnitude.toFixed(3)}
        />
        <StatRow
          label="second-brain nodes / edges"
          value={`${report.kgNodes ?? '---'} / ${report.kgEdges ?? '---'}`}
        />
        <StatRow label="last research cycle" value={fmtTimeAgo(report.lastCycleAt)} mono={false} />
      </div>
      <p className="font-sans text-[11px] text-app-muted">
        Veronica reads `/errors/stats` and `/research/snapshot` every 15 s. She does NOT speak to
        the model — read-only audit. If the pass-rate drops below 80 %, she escalates the next
        commit to amber.
      </p>
    </Card>
  );
}

// ----- Aria · security guardian -------------------------------------

function AriaCard() {
  const [report, setReport] = useState<SecurityReport>({
    envSecretsPresent: 0,
    envSecretsExposed: 0,
    hipaaSigningKey: 'absent',
    oauthSplit: 'unknown',
    rateLimitArmed: false,
    ownerHeader: 'unknown',
    contentTypeOptions: 'unknown',
    hsts: 'unknown',
    severity: 'amber',
  });

  useEffect(() => {
    let alive = true;
    const probe = async () => {
      // Setter-callback form so we don't depend on the closure's `report`.
      let envPresent: number | undefined;
      let envExposed: number | undefined;
      let hipaaKey: 'set' | 'absent' | undefined;
      let oauthMode: 'split' | 'merged' | 'unknown' | undefined;
      let rateLimit: boolean | undefined;
      let owner: 'present' | 'absent' | 'unknown' | undefined;
      let cto: 'present' | 'absent' | 'unknown' | undefined;
      let hstsState: 'present' | 'absent' | 'unknown' | undefined;
      try {
        const r = await fetch('/security/posture');
        if (r.ok) {
          const j = (await r.json()) as {
            env_secrets_present?: number;
            env_secrets_exposed?: number;
            hipaa_signing_key?: 'set' | 'absent';
            oauth_split?: 'split' | 'merged';
            rate_limit_armed?: boolean;
          };
          envPresent = j.env_secrets_present ?? 0;
          envExposed = j.env_secrets_exposed ?? 0;
          hipaaKey = j.hipaa_signing_key ?? 'absent';
          oauthMode = j.oauth_split ?? 'unknown';
          rateLimit = j.rate_limit_armed === true;
        }
      } catch {
        /* offline · keep prior */
      }
      try {
        const r = await fetch('/health/full', { method: 'HEAD' });
        owner = r.headers.get('x-owner') ? 'present' : 'absent';
        cto = r.headers.get('x-content-type-options') ? 'present' : 'absent';
        hstsState = r.headers.get('strict-transport-security') ? 'present' : 'absent';
      } catch {
        /* offline */
      }
      if (!alive) return;
      setReport((prev) => {
        const merged: SecurityReport = {
          envSecretsPresent: envPresent ?? prev.envSecretsPresent,
          envSecretsExposed: envExposed ?? prev.envSecretsExposed,
          hipaaSigningKey: hipaaKey ?? prev.hipaaSigningKey,
          oauthSplit: oauthMode ?? prev.oauthSplit,
          rateLimitArmed: rateLimit ?? prev.rateLimitArmed,
          ownerHeader: owner ?? prev.ownerHeader,
          contentTypeOptions: cto ?? prev.contentTypeOptions,
          hsts: hstsState ?? prev.hsts,
          severity: 'green',
        };
        if (merged.envSecretsExposed > 0) merged.severity = 'red';
        else if (
          merged.hipaaSigningKey === 'absent' ||
          !merged.rateLimitArmed ||
          merged.contentTypeOptions === 'absent'
        ) {
          merged.severity = 'amber';
        }
        return merged;
      });
    };
    probe();
    const id = window.setInterval(probe, 15_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  const tone = SEVERITY_TONE[report.severity];

  return (
    <Card className="flex flex-col gap-3 p-4">
      <SentinelHeader
        name="Aria"
        subtitle="security guardian · encryption · OWASP · keys"
        icon={ShieldCheck}
        severity={report.severity}
      />
      <div className="flex flex-col divide-y divide-app-subtle">
        <StatRow
          label="env secrets · loaded · exposed"
          value={`${report.envSecretsPresent} · ${report.envSecretsExposed}`}
        />
        <StatRow label="HIPAA signing key" value={report.hipaaSigningKey} mono={false} />
        <StatRow label="OAuth scope split" value={report.oauthSplit} mono={false} />
        <StatRow
          label="rate-limit armed"
          value={report.rateLimitArmed ? 'yes' : 'no'}
          mono={false}
        />
        <StatRow label="X-Content-Type-Options" value={report.contentTypeOptions} mono={false} />
        <StatRow label="HSTS" value={report.hsts} mono={false} />
        <StatRow label="X-Owner header" value={report.ownerHeader} mono={false} />
      </div>
      <div
        className={`flex items-center gap-2 rounded-md border px-3 py-2 ${tone.border} ${tone.bg}`}
      >
        {report.severity === 'red' ? (
          <ShieldAlert className="h-4 w-4 text-rose-300" />
        ) : (
          <Lock className="h-4 w-4 text-quantum-300" />
        )}
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-app-secondary">
          {report.severity === 'red'
            ? 'fix exposed secrets before demo'
            : report.severity === 'amber'
              ? 'tighten before production'
              : 'core tight · locks engaged'}
        </span>
      </div>
      <p className="font-sans text-[11px] text-app-muted">
        Aria reads `/security/posture` and probes the API headers every 15 s. Like Veronica she's
        read-only — she audits and reports, never mutates. End-to-end principles: HMAC-signed
        cookies · OAuth scope split · token-bucket rate-limit · OWASP headers · activity-sink
        pseudonymous IDs · Ed25519-signed audit chain (when key is set).
      </p>
    </Card>
  );
}

// ----- Panel root ---------------------------------------------------

export function SentinelsPanel() {
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <ScanEye className="h-4 w-4 text-quantum-300" />
        <span className="font-mono text-[10px] uppercase tracking-[0.32em] text-quantum-300">
          sentinels · 15 s poll · read-only
        </span>
      </div>
      <p className="max-w-2xl font-sans text-[12px] text-app-muted">
        Two strict watchers — Veronica audits Mörbius's accuracy stack (Secure-Pass rate, Second
        Brain drift, residual magnitude); Aria audits the security posture (env secrets, OAuth scope
        split, rate-limit, OWASP headers). Both feed dev-console only — they do not run consults
        themselves.
      </p>
      <div className="grid gap-3 lg:grid-cols-2">
        <VeronicaCard />
        <AriaCard />
      </div>
    </div>
  );
}
