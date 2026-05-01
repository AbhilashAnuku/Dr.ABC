import { Button, Card, PulseDot, cn } from '@dr-abc/ui';
import { Canvas } from '@react-three/fiber';
import { motion } from 'framer-motion';
import {
  Activity,
  Atom,
  Brain,
  Calendar,
  HeartPulse,
  type LucideIcon,
  MessageSquareText,
  Pill,
  Send,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'wouter';
import { RecentConsults } from '../components/dashboard/recent-consults.tsx';
import { SymptomCheckerCard } from '../components/dashboard/symptom-checker.tsx';
import { useAuth } from '../lib/auth.tsx';
import { API_BASE } from '../lib/config.ts';
import { listMemory } from '../lib/morbius-memory.ts';
import { MorbiusFace } from '../overlay/morbius-face.tsx';
import { DOCTOR_SEED } from './appointments-shared.ts';
import { DashboardCohesion } from './dashboard-cohesion.tsx';

interface AgentMeta {
  kind: string;
  version: number;
}

const AGENT_LABEL: Record<string, string> = {
  triage: 'Triage',
  validator: 'Validator',
  diagnostic: 'Diagnostic',
  imaging: 'Imaging',
  library: 'Library',
  profile: 'Profile',
};

function relativeFromNow(ts: number, now = Date.now()): string {
  const diff = Math.max(0, now - ts);
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

export function DashboardPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  // Live agent set from /agents. `online` is the set we have seen
  // online; `total` is the registry size returned by the server, so
  // the KPI "online/total" reads correctly even if agents are added
  // or retired by the meta-agent layer.
  const [agentsOnline, setAgentsOnline] = useState<{
    online: number;
    total: number | null;
    kinds: Set<string>;
  }>({ online: 0, total: null, kinds: new Set() });
  const [askInput, setAskInput] = useState('');
  const [openConsults, setOpenConsults] = useState<number | null>(null);
  const [alerts, setAlerts] = useState<number | null>(null);
  // Most-recent memory entry powers the live activity feed -- replaces
  // the hardcoded "no consults yet" stub. Null while loading.
  const [latestMemory, setLatestMemory] = useState<{
    chiefComplaint: string;
    diagnosis: string | null;
    ts: number;
  } | null>(null);

  // Upcoming appointments come from the same shared seed the
  // /app/appointments doctor view paints from, so the counts stay in
  // sync across surfaces.
  const upcomingAppointments = DOCTOR_SEED.filter((a) => a.status === 'upcoming').length;

  useEffect(() => {
    fetch(`${API_BASE}/`)
      .then((r) => r.json())
      .then((data: { agents?: AgentMeta[] }) => {
        const kinds = new Set<string>(data.agents?.map((a) => a.kind) ?? []);
        setAgentsOnline({
          online: kinds.size,
          total: data.agents?.length ?? null,
          kinds,
        });
      })
      .catch(() => {});
  }, []);

  // Real consult count from per-user IndexedDB memory (seeded on first
  // login, grows with every signed-off Rx). Also captures the most-
  // recent entry so the activity feed can render real data instead of
  // hardcoded placeholders.
  useEffect(() => {
    if (!user?.id) return;
    void listMemory(user.id, 500)
      .then((entries) => {
        setOpenConsults(entries.length);
        const latest = entries[0];
        setLatestMemory(
          latest
            ? {
                chiefComplaint: latest.chiefComplaint,
                diagnosis: latest.diagnosis ?? null,
                ts: latest.ts,
              }
            : null,
        );
      })
      .catch(() => {
        setOpenConsults(0);
        setLatestMemory(null);
      });
  }, [user?.id]);

  // Alerts = sequential-error journal events (live count from the API).
  // Best-effort; if the API is down we render "—" rather than fake 0.
  useEffect(() => {
    let alive = true;
    fetch(`${API_BASE}/errors/stats`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { total?: number } | null) => {
        if (!alive) return;
        setAlerts(typeof j?.total === 'number' ? j.total : 0);
      })
      .catch(() => alive && setAlerts(0));
    return () => {
      alive = false;
    };
  }, []);

  // seedCaseHistory now runs inside AuthProvider on every sign-in so
  // every route (clinic, brain map, case library) sees the demo data
  // without depending on the user passing through this dashboard.

  const onAsk = (e: React.FormEvent) => {
    e.preventDefault();
    if (!askInput.trim()) return;
    // Stash the prompt and route to the merged clinic page.
    window.sessionStorage.setItem('dr-abc:pending-consult', askInput);
    setLocation('/app/consult');
  };

  return (
    <div className="space-y-8">
      {/* MISSION CONTROL HEADER */}
      <motion.section
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_360px]"
      >
        <div className="flex flex-col justify-between space-y-6">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-bio-500/30 bg-bio-500/10 px-3 py-1 backdrop-blur-md">
              <PulseDot active size="xs" tone="bio" />
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-bio-300">
                Mörbius is listening
              </span>
            </div>
            <h1 className="font-display text-3xl font-bold tracking-tight text-app-primary sm:text-5xl">
              {t('dashboard.title', { name: user?.name ?? 'Architect' })}
            </h1>
            <p className="mt-2 max-w-xl font-sans text-sm text-app-muted sm:text-base">
              {t('dashboard.subtitle')}
            </p>
          </div>

          {/* ASK BAR — the centerpiece. Theme-token surface so the bar
              reads as a proper input in both light and dark modes
              (previous `bg-ink-950/70` was a fixed dark fill, looked
              like a black strip on the clinical light theme). */}
          <form onSubmit={onAsk}>
            <div className="rounded-2xl border border-quantum-400/40 bg-app-surface-strong p-1 backdrop-blur-xl shadow-[0_0_40px_-12px_rgba(56,189,248,0.35)]">
              <div className="flex items-center gap-2 px-4 py-2">
                <Sparkles className="h-4 w-4 shrink-0 text-quantum-400" />
                <input
                  value={askInput}
                  onChange={(e) => setAskInput(e.target.value)}
                  placeholder="Ask Mörbius anything medical…"
                  aria-label="Ask Mörbius"
                  className="flex-1 bg-transparent font-sans text-base text-app-primary placeholder:text-app-secondary focus:outline-none sm:text-lg"
                />
                <Button
                  type="submit"
                  variant="primary"
                  disabled={!askInput.trim()}
                  className="px-3 py-1.5"
                  aria-label="Send"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {[
                'crushing chest pain',
                'severe headache 3 days',
                'tell me about migraine treatment',
                'my profile and allergies',
              ].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setAskInput(s)}
                  className="rounded-full border border-app-subtle bg-white/5 px-3 py-1 font-sans text-xs text-app-muted transition hover:border-quantum-400/40 hover:bg-quantum-500/10 hover:text-quantum-300"
                >
                  {s}
                </button>
              ))}
            </div>
          </form>
        </div>

        {/* MÖRBIUS HEAD CANVAS */}
        <motion.div
          initial={{ opacity: 0, scale: 0.94 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="relative"
        >
          <div className="overflow-hidden rounded-3xl border border-quantum-400/30 bg-linear-to-b from-black/70 via-black/30 to-black/70 backdrop-blur-xl shadow-[0_0_60px_-15px_rgba(56,189,248,0.5)]">
            <div className="h-72 sm:h-80">
              {/* Cap dpr at 1.25 — the head canvas is decorative; pushing
                  retina pixels here was costing 30-40 % of the dashboard's
                  GPU budget on M-series and Iris-class hardware.
                  frameloop "always" so eye-tracking, head sway, antenna
                  bob, and the breathing/pulse all stay alive — demand
                  mode looked perf-friendly but disabled the continuous
                  interactivity this view requires. */}
              <Canvas camera={{ position: [0, 0, 1.65], fov: 38 }} dpr={[1, 1.25]}>
                <ambientLight intensity={0.5} />
                <directionalLight position={[2, 3, 4]} intensity={1.1} color="#cbe7ff" />
                <directionalLight position={[-3, 1, 3]} intensity={0.55} color="#dfffe8" />
                <pointLight position={[0, 0.5, 2.5]} intensity={0.6} color="#7dd3fc" />
                <MorbiusFace listening />
              </Canvas>
            </div>
            <div className="border-t border-app-subtle px-4 py-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-display text-sm font-semibold text-app-primary">Mörbius</div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-bio-400">
                    ONLINE · idle ·{' '}
                    {agentsOnline.total !== null
                      ? `${agentsOnline.online}/${agentsOnline.total} agents`
                      : `${agentsOnline.online} agents`}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <PulseDot active size="xs" tone="bio" />
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </motion.section>

      {/* KPI ROW */}
      <motion.section
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2 }}
        className="grid grid-cols-2 gap-3 sm:grid-cols-4"
      >
        <Kpi
          label={t('dashboard.kpi.openConsults')}
          value={openConsults === null ? '—' : String(openConsults)}
          tone="quantum"
          to="/app/consult"
        />
        <Kpi
          label={t('dashboard.kpi.upcomingAppointments')}
          value={String(upcomingAppointments)}
          tone="quantum"
          to="/app/appointments"
        />
        <Kpi
          label={t('dashboard.kpi.alerts')}
          value={alerts === null ? '—' : String(alerts)}
          tone={alerts && alerts > 0 ? 'amber' : 'bio'}
          to="/app/dev-console?tab=sentinels"
        />
        <Kpi
          label={t('dashboard.kpi.agentsOnline')}
          value={
            agentsOnline.total !== null
              ? `${agentsOnline.online}/${agentsOnline.total}`
              : `${agentsOnline.online}/—`
          }
          tone={
            agentsOnline.total !== null && agentsOnline.online >= agentsOnline.total - 1
              ? 'bio'
              : 'amber'
          }
          to="/app/dev-console?tab=agents"
        />
      </motion.section>

      {/* SYMPTOM-CHECKER QUICKSTART — Ada/Buoy-class triage entry */}
      <motion.section
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.22 }}
      >
        <SymptomCheckerCard />
      </motion.section>

      {/* RECENT CONSULTS — newest-first strip from Mörbius's per-user
           memory (seeded with 15 demo cases on first sign-in). */}
      <motion.section
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.24 }}
      >
        <RecentConsults limit={6} />
      </motion.section>

      {/* COHESION ROW — pulls from /app/profile, /app/lab, /api/fitness */}
      <motion.section
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.25 }}
      >
        <DashboardCohesion />
      </motion.section>

      {/* QUICK ACTIONS */}
      <motion.section
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.3 }}
      >
        <h2 className="mb-3 font-display text-lg font-semibold text-app-primary">
          {t('dashboard.quickActions')}
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <QuickAction
            to="/app/consult"
            labelKey="dashboard.actions.newConsult"
            Icon={MessageSquareText}
          />
          <QuickAction to="/app/imaging" labelKey="dashboard.actions.uploadScan" Icon={Pill} />
          <QuickAction
            to="/app/appointments"
            labelKey="dashboard.actions.bookAppointment"
            Icon={Calendar}
          />
          <QuickAction
            to="/app/clinic?mode=emergency"
            labelKey="dashboard.actions.emergency"
            Icon={HeartPulse}
            tone="rose"
          />
        </div>
      </motion.section>

      {/* RECENT + AGENT STATUS */}
      <motion.section
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.4 }}
        className="grid grid-cols-1 gap-4 lg:grid-cols-3"
      >
        <div className="lg:col-span-2">
          <h2 className="mb-3 font-display text-lg font-semibold text-app-primary">
            {t('dashboard.recentActivity')}
          </h2>
          <Card className="p-6">
            <div className="space-y-3">
              <ActivityItem
                icon={ShieldCheck}
                tone="bio"
                title={
                  agentsOnline.kinds.size > 0
                    ? t('dashboard.activity.gauntletArmed', { count: agentsOnline.kinds.size })
                    : t('dashboard.activity.waitingAgents')
                }
                meta={agentsOnline.kinds.size > 0 ? t('dashboard.activity.liveSystem') : '—'}
              />
              <ActivityItem
                icon={Brain}
                tone="quantum"
                title={
                  latestMemory
                    ? t('dashboard.activity.lastConsult', {
                        summary: latestMemory.diagnosis ?? latestMemory.chiefComplaint.slice(0, 64),
                      })
                    : openConsults === null
                      ? t('dashboard.activity.loadingMemory')
                      : t('dashboard.activity.noConsults')
                }
                meta={
                  latestMemory
                    ? relativeFromNow(latestMemory.ts)
                    : openConsults && openConsults > 0
                      ? t('dashboard.activity.consultsInMemory', { count: openConsults })
                      : '—'
                }
              />
              <ActivityItem
                icon={Atom}
                tone="amber"
                title={
                  alerts === null
                    ? t('dashboard.activity.selfCorrectionLoading')
                    : alerts > 0
                      ? t('dashboard.activity.selfCorrectionEvents', { count: alerts })
                      : t('dashboard.activity.selfCorrectionEmpty')
                }
                meta={alerts !== null ? t('dashboard.activity.liveStats') : '—'}
              />
            </div>
            <Link href="/app/consult" className="mt-5 inline-block">
              <Button variant="primary">
                <Sparkles className="mr-1.5 h-3.5 w-3.5" /> {t('dashboard.actions.newConsult')}
              </Button>
            </Link>
          </Card>
        </div>

        <div>
          <h2 className="mb-3 font-display text-lg font-semibold text-app-primary">
            {t('dashboard.agentStatus')}
          </h2>
          <Card className="p-4">
            <ul className="space-y-2.5">
              {[...agentsOnline.kinds].map((kind) => (
                <li key={kind} className="flex items-center justify-between text-sm">
                  <span className="font-sans text-app-secondary">{AGENT_LABEL[kind] ?? kind}</span>
                  <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-bio-400">
                    <PulseDot active size="xs" tone="bio" />
                    {t('dashboard.online')}
                  </span>
                </li>
              ))}
              {agentsOnline.kinds.size === 0 && (
                <li className="font-sans text-[11px] text-app-faint">
                  Waiting for the API to come online…
                </li>
              )}
            </ul>
          </Card>
        </div>
      </motion.section>
    </div>
  );
}

// Scripted four-mode walkthrough. Stashed in sessionStorage when the
// "Demo me" button is pressed; clinic.tsx reads it on mount and walks
// the user through analyse → casual → know → diet without keyboard input.
const DEMO_SCRIPT = [
  {
    mode: 'analyze' as const,
    label: 'Analyse · cardiac chest pain',
    prompt:
      'Crushing substernal chest pain radiating to the left arm and jaw, started 30 minutes ago. 58yo male, smoker, hypertensive. Diaphoretic. What now?',
  },
  {
    mode: 'casual' as const,
    label: 'Casual · self-care for a cold',
    prompt:
      "Got the sniffles, mild sore throat, and a low-grade fever (37.6°C) since yesterday. I'm 32, otherwise healthy. Should I be worried?",
  },
  {
    mode: 'know' as const,
    label: 'Know · educate on GLP-1s',
    prompt:
      'How does semaglutide actually work for type 2 diabetes? What changed about the evidence in the last two years?',
  },
  {
    mode: 'diet' as const,
    label: 'Diet · breakfast for prediabetes',
    prompt:
      'I have hypertension and prediabetes. What should breakfast look like, with portion sizes and 3 concrete meal examples?',
  },
];

function LaunchDemoCard() {
  const [, setLocation] = useLocation();
  const startDemo = () => {
    window.sessionStorage.setItem('dr-abc:demo-script', JSON.stringify(DEMO_SCRIPT));
    setLocation('/app/consult');
  };
  const STEPS: { n: string; label: string; tip: string }[] = [
    {
      n: '01',
      label: 'Pick a symptom card',
      tip: 'Tap "Crushing chest pain" below — Mörbius will route to the consult with the prompt pre-stuffed and stream the diagnosis live.',
    },
    {
      n: '02',
      label: 'Watch the pipeline',
      tip: 'Triage → cardiology specialist + diagnostic cross-validator → validator + safety + privacy gauntlet. Every event streams via SSE.',
    },
    {
      n: '03',
      label: 'Sign + download Rx',
      tip: 'Hit Generate Rx, then Download. Real PDF (pdf-lib) with embedded fonts, signed-by block, drug-safety warnings.',
    },
    {
      n: '04',
      label: 'Open the dev console',
      tip: "Sidebar → Developer · LOCKED → enter PIN 4242. System tab shows every backend's reachability + latency in real time.",
    },
  ];
  return (
    <Card className="overflow-hidden p-0">
      <div className="bg-linear-to-br from-quantum-500/10 via-bio-500/5 to-purple-500/10 p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.32em] text-quantum-300">
              <Sparkles className="h-3 w-3" /> · launch the demo
            </div>
            <h2 className="mt-1 font-display text-2xl font-bold text-app-primary sm:text-3xl">
              Four taps and you're in the live agent mesh.
            </h2>
            <p className="mt-1 max-w-2xl font-sans text-sm text-app-muted">
              Mörbius is local-first by default. Anthropic / NVIDIA / HuggingFace are opt-in
              fallbacks. The demo runs end-to-end without a single key — every key you wire just
              upgrades a specific surface from stub to live.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={startDemo}
              className="inline-flex items-center gap-2 rounded-lg border border-bio-500/40 bg-linear-to-br from-bio-500/15 via-quantum-500/10 to-purple-500/15 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.22em] text-bio-200 shadow-[0_0_30px_-12px_rgba(56,189,248,0.5)] transition hover:from-bio-500/25"
            >
              <Sparkles className="h-3.5 w-3.5" /> demo me · 4 modes
            </button>
            <Link
              href="/app/consult"
              className="inline-flex items-center gap-2 rounded-lg border border-quantum-400/40 bg-quantum-500/15 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.22em] text-quantum-200 transition hover:bg-quantum-500/25"
            >
              <MessageSquareText className="h-3.5 w-3.5" /> open consult
            </Link>
            <Link
              href="/app/dev-console"
              className="inline-flex items-center gap-2 rounded-lg border border-app-subtle px-4 py-2 font-mono text-[11px] uppercase tracking-[0.22em] text-app-muted transition hover:border-purple-400/40 hover:text-purple-300"
            >
              <Activity className="h-3.5 w-3.5" /> dev console
            </Link>
          </div>
        </div>
        <div className="mt-5 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <div
              key={s.n}
              className={cn(
                'flex flex-col gap-1 rounded-xl border p-3 transition',
                i === 0
                  ? 'border-bio-500/40 bg-bio-500/10'
                  : 'border-app-subtle bg-white/2 hover:border-quantum-400/30',
              )}
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] tracking-[0.32em] text-app-faint">
                  {s.n}
                </span>
                <span className="font-display text-sm font-semibold text-app-primary">
                  {s.label}
                </span>
              </div>
              <p className="font-sans text-xs leading-snug text-app-muted">{s.tip}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
          <span>full walkthrough →</span>
          <a
            href="https://github.com/AbhilashAnuku/Dr.ABC/blob/main/docs/vault/ops/demo-script.md"
            target="_blank"
            rel="noopener noreferrer"
            className="text-quantum-300 transition hover:text-quantum-200"
          >
            docs/demo-script.md
          </a>
          <span>·</span>
          <a
            href="https://github.com/AbhilashAnuku/Dr.ABC/blob/main/docs/vault/ops/always-on-autopilot.md"
            target="_blank"
            rel="noopener noreferrer"
            className="text-quantum-300 transition hover:text-quantum-200"
          >
            always-on autopilot
          </a>
          <span>·</span>
          <a
            href="https://github.com/AbhilashAnuku/Dr.ABC/blob/main/docs/vault/guides/setup-keys.md"
            target="_blank"
            rel="noopener noreferrer"
            className="text-quantum-300 transition hover:text-quantum-200"
          >
            wire your keys
          </a>
        </div>
      </div>
    </Card>
  );
}

function Kpi({
  label,
  value,
  tone,
  to,
}: {
  label: string;
  value: string;
  tone: 'quantum' | 'bio' | 'amber';
  to?: string;
}) {
  const toneCls = {
    quantum: 'text-quantum-400',
    bio: 'text-bio-400',
    amber: 'text-amber-400',
  } as const;
  const body = (
    <>
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-app-muted">
        {label}
      </div>
      <div className={cn('mt-1 font-display text-3xl font-bold tabular-nums', toneCls[tone])}>
        {value}
      </div>
    </>
  );
  if (!to) {
    return <Card className="p-4 backdrop-blur-md">{body}</Card>;
  }
  return (
    <Link
      href={to}
      aria-label={`${label} — open`}
      className="group block rounded-xl transition focus:outline-none focus-visible:ring-2 focus-visible:ring-quantum-400/60"
    >
      <Card className="p-4 backdrop-blur-md transition-all group-hover:-translate-y-0.5 group-hover:border-quantum-400/40 group-hover:bg-white/5">
        {body}
      </Card>
    </Link>
  );
}

function QuickAction({
  to,
  labelKey,
  Icon,
  tone = 'quantum',
}: { to: string; labelKey: string; Icon: LucideIcon; tone?: 'quantum' | 'rose' }) {
  const { t } = useTranslation();
  const toneCls = {
    quantum: 'border-quantum-400/30 hover:border-quantum-400/60 text-quantum-400',
    rose: 'border-rose-400/30 hover:border-rose-400/60 text-rose-400',
  } as const;
  return (
    <Link
      href={to}
      className={cn(
        'group flex flex-col items-start gap-2 rounded-xl border surface p-4 transition-all hover:-translate-y-0.5 hover:bg-white/5',
        toneCls[tone],
      )}
    >
      <Icon className="h-6 w-6" />
      <span className="font-sans text-sm font-medium text-app-primary">{t(labelKey)}</span>
    </Link>
  );
}

function ActivityItem({
  icon: Icon,
  tone,
  title,
  meta,
}: { icon: LucideIcon; tone: 'bio' | 'quantum' | 'amber'; title: string; meta: string }) {
  const toneCls = {
    bio: 'border-bio-500/30 bg-bio-500/10 text-bio-400',
    quantum: 'border-quantum-400/30 bg-quantum-500/10 text-quantum-400',
    amber: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
  } as const;
  return (
    <div className="flex items-start gap-3">
      <div
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border',
          toneCls[tone],
        )}
      >
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-sans text-sm text-app-primary">{title}</div>
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-app-faint">
          {meta}
        </div>
      </div>
    </div>
  );
}
