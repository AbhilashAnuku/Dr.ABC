import { Button, Card, Section as PageSection, cn } from '@dr-abc/ui';
import {
  Bell,
  Brain,
  Briefcase,
  Eye,
  EyeOff,
  Globe,
  Languages,
  Lock,
  Palette,
  ShieldCheck,
} from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'wouter';
import { DestructiveConfirm } from '../components/destructive-confirm.tsx';
import { useAuth } from '../lib/auth.tsx';
import { BACKENDS, type BackendId, readBackendPin, writeBackendPin } from '../lib/backend-pin.ts';
import { readFaceMirrorPref, writeFaceMirrorPref } from '../lib/face-pose.ts';
import { SUPPORTED_LANGS } from '../lib/i18n.ts';
import { purgeUserData } from '../lib/medical-record.ts';
import {
  type ModuleSettings,
  type NotificationPrefs,
  readNotifPrefs,
  readSettings,
  writeNotifPrefs,
  writeSettings,
} from '../lib/settings.ts';
import { useTheme } from '../lib/theme.tsx';
import { readAutoTranslatePref, writeAutoTranslatePref } from '../lib/translate.ts';
import { readTapToWakeEnabled, writeTapToWakeEnabled } from '../lib/use-tap-to-wake.ts';
import {
  MORBIUS_VOICES,
  type VoiceId,
  type VoiceQuality,
  readVoiceId,
  readVoiceQuality,
  speakWithProsody,
  writeVoiceId,
  writeVoiceQuality,
} from '../lib/voice.ts';

type Tab =
  | 'modules'
  | 'backend'
  | 'appearance'
  | 'language'
  | 'notifications'
  | 'security'
  | 'billing';

const TABS = new Set<Tab>([
  'modules',
  'backend',
  'appearance',
  'language',
  'notifications',
  'security',
  'billing',
]);

function readInitialTab(): Tab {
  if (typeof window === 'undefined') return 'modules';
  const param = new URLSearchParams(window.location.search).get('tab');
  return param && TABS.has(param as Tab) ? (param as Tab) : 'modules';
}

export function SettingsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>(() => readInitialTab());

  const tabs: Array<{ id: Tab; label: string; icon: typeof Languages }> = [
    { id: 'modules', label: t('settings.tabs.modules'), icon: Briefcase },
    { id: 'backend', label: 'Backend', icon: Brain },
    { id: 'appearance', label: t('settings.tabs.appearance'), icon: Palette },
    { id: 'language', label: t('settings.tabs.language'), icon: Languages },
    { id: 'notifications', label: t('settings.tabs.notifications'), icon: Bell },
    { id: 'security', label: t('settings.tabs.security'), icon: ShieldCheck },
    { id: 'billing', label: t('settings.tabs.billing'), icon: Globe },
  ];

  return (
    <div className="space-y-6">
      <PageSection title={t('settings.title')} description={t('settings.subtitle')} />

      <div className="flex flex-col gap-6 lg:flex-row">
        <nav className="lg:w-56">
          <ul className="flex flex-row gap-1 overflow-x-auto lg:flex-col">
            {tabs.map((tt) => {
              const Icon = tt.icon;
              const active = tab === tt.id;
              return (
                <li key={tt.id}>
                  <button
                    type="button"
                    onClick={() => setTab(tt.id)}
                    className={cn(
                      'flex items-center gap-2 rounded-lg px-3 py-2 font-sans text-sm transition-colors whitespace-nowrap',
                      active
                        ? 'bg-quantum-500/15 text-quantum-300'
                        : 'text-app-secondary hover:bg-white/5 hover:text-app-primary',
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {tt.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="min-w-0 flex-1">
          {tab === 'modules' && <ModulesTab />}
          {tab === 'backend' && <BackendTab />}
          {tab === 'appearance' && <AppearanceTab />}
          {tab === 'language' && <LanguageTab />}
          {tab === 'notifications' && <NotificationsTab />}
          {tab === 'security' && <SecurityTab />}
          {tab === 'billing' && <BillingTab />}
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <Card className="p-6">
      <h2 className="font-display text-xl font-semibold text-app-primary">{title}</h2>
      {subtitle && <p className="mt-1 font-sans text-sm text-app-muted">{subtitle}</p>}
      <div className="mt-5">{children}</div>
    </Card>
  );
}

/**
 * Modules tab — single view in Stage 8 (no developer split). Anyone
 * signed in can see the connected-services list, but write surfaces
 * (Anthropic key edit) used to be developer-only and have been moved
 * to Stage-8's embedded dev-console drawer (Wave W). For now, render
 * the read-only summary.
 */
function ModulesTab() {
  const { t } = useTranslation();
  const [s, setS] = useState<ModuleSettings>(() => readSettings());
  const [showKey, setShowKey] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const onSave = () => {
    writeSettings(s);
    setSavedAt(Date.now());
    setTimeout(() => setSavedAt(null), 2500);
  };

  const modules = [
    {
      key: 'diagnostic',
      label: t('settings.modules.diagnostic'),
      provider: 'Anthropic',
      online: !!s.anthropicApiKey,
    },
    {
      key: 'imaging',
      label: t('settings.modules.imaging'),
      provider: 'Anthropic Vision',
      online: !!s.anthropicApiKey,
    },
    {
      key: 'library',
      label: t('settings.modules.library'),
      provider: 'Local (BM25)',
      online: true,
    },
    {
      key: 'profile',
      label: t('settings.modules.profile'),
      provider: 'Local (in-memory)',
      online: true,
    },
    { key: 'voice', label: t('settings.modules.voice'), provider: 'Browser', online: true },
  ];

  return (
    <Section title={t('settings.modules.title')} subtitle={t('settings.modules.subtitle')}>
      <div className="space-y-3">
        {modules.map((m) => (
          <div
            key={m.key}
            className="flex items-center justify-between rounded-lg border border-app-subtle bg-white/3 px-4 py-3"
          >
            <div>
              <div className="font-sans text-sm font-medium text-app-primary">{m.label}</div>
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-app-faint">
                {m.provider}
              </div>
            </div>
            <span
              className={cn(
                'font-mono text-[10px] uppercase tracking-[0.18em]',
                m.online ? 'text-bio-400' : 'text-app-faint',
              )}
            >
              {m.online ? t('dashboard.online') : t('dashboard.offline')}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-6 space-y-4 border-t border-app-subtle pt-6">
        <div>
          <label htmlFor="anthropic-key" className="font-sans text-xs text-app-secondary">
            {t('settings.modules.anthropicKey')}
          </label>
          <div className="mt-1 flex gap-2">
            <input
              id="anthropic-key"
              type={showKey ? 'text' : 'password'}
              autoComplete="off"
              value={s.anthropicApiKey}
              onChange={(e) => setS({ ...s, anthropicApiKey: e.target.value })}
              placeholder="sk-ant-…"
              className="flex-1 rounded-lg border border-app-subtle bg-white/5 px-3 py-2 font-mono text-sm text-app-primary placeholder:text-app-faint focus:border-quantum-400/60 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              aria-label={showKey ? 'Hide' : 'Show'}
              className="rounded-lg border border-app-subtle px-3 text-app-muted hover:text-quantum-400"
            >
              {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <p className="mt-1 flex items-center gap-1.5 font-sans text-[11px] text-app-faint">
            <Lock className="h-3 w-3" /> {t('settings.modules.redacted')}
          </p>
        </div>

        <div>
          <label htmlFor="anthropic-model" className="font-sans text-xs text-app-secondary">
            {t('settings.modules.anthropicModel')}
          </label>
          <select
            id="anthropic-model"
            value={s.anthropicModel}
            onChange={(e) => setS({ ...s, anthropicModel: e.target.value })}
            className="mt-1 w-full rounded-lg border border-app-subtle bg-app-surface-strong px-3 py-2 font-mono text-sm text-app-primary focus:border-quantum-400/60 focus:outline-none"
            style={{ colorScheme: 'dark light' }}
          >
            <option
              value="mörbius-core-balanced"
              style={{ background: '#0e1f36', color: '#e6f0ff' }}
            >
              Mörbius Core · Balanced
            </option>
            <option value="mörbius-core-fast" style={{ background: '#0e1f36', color: '#e6f0ff' }}>
              Mörbius Core · Fast
            </option>
            <option value="mörbius-core-deep" style={{ background: '#0e1f36', color: '#e6f0ff' }}>
              Mörbius Core · Deep Reasoning
            </option>
          </select>
        </div>

        <div className="flex items-center gap-3">
          <Button variant="primary" onClick={onSave}>
            {t('settings.modules.save')}
          </Button>
          {savedAt && (
            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-bio-400">
              ✓ {t('settings.modules.saved')}
            </span>
          )}
        </div>
      </div>

      <PersonaProfilePanel />
    </Section>
  );
}

interface PersonaSnapshot {
  ranAt: string;
  perPersona: Array<{
    id: string;
    name?: string;
    role?: string;
    caseCount?: number;
    weightedScore: number;
    topConditionRate: number;
    gauntletPassRate: number;
    p50LatencyMs?: number;
  }>;
}

function PersonaProfilePanel() {
  const [data, setData] = useState<PersonaSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    const base = (import.meta.env.VITE_API_BASE_URL ?? '/api').toString();
    fetch(`${base}/personas/live`, { signal: ac.signal })
      .then(async (r) => {
        if (!r.ok) {
          const j = (await r.json().catch(() => ({}))) as { message?: string };
          throw new Error(j.message ?? `HTTP ${r.status}`);
        }
        return r.json() as Promise<{ snapshot: PersonaSnapshot }>;
      })
      .then((j) => setData(j.snapshot))
      .catch((e) => setError(e instanceof Error ? e.message : 'persona summary unavailable'))
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, []);

  return (
    <div className="mt-8 border-t border-app-subtle pt-6">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <div>
          <div className="font-display text-lg font-semibold text-app-primary">
            Mörbius persona benchmark
          </div>
          <p className="font-sans text-xs text-app-muted">
            Latest weighted scores from the persona harness — three identities, 25 cases, run by{' '}
            <code className="font-mono text-[11px] text-app-secondary">
              bun run scripts/persona-harness.ts
            </code>
            .
          </p>
        </div>
        {data && (
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-app-faint">
            run · {new Date(data.ranAt).toISOString().slice(0, 16).replace('T', ' ')} UTC
          </span>
        )}
      </div>
      {loading && (
        <div className="rounded-lg border border-app-subtle bg-white/3 px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] text-app-faint">
          loading persona snapshot…
        </div>
      )}
      {error && !data && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 font-sans text-xs text-amber-200">
          {error}. Run{' '}
          <code className="font-mono text-[11px] text-amber-100">
            bun run scripts/persona-harness.ts
          </code>{' '}
          to generate a snapshot.
        </div>
      )}
      {data && (
        <div className="grid gap-3 sm:grid-cols-3">
          {data.perPersona.map((p) => {
            const pct = Math.round(p.weightedScore * 100);
            const tone =
              p.weightedScore >= 0.7
                ? 'border-bio-500/40 bg-bio-500/10 text-bio-300'
                : p.weightedScore >= 0.5
                  ? 'border-quantum-400/40 bg-quantum-500/10 text-quantum-300'
                  : 'border-amber-500/40 bg-amber-500/10 text-amber-300';
            return (
              <div key={p.id} className={cn('rounded-xl border p-3', tone)} title={p.name ?? p.id}>
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] opacity-70">
                  {p.id} · {p.role ?? 'role'}
                </div>
                <div className="mt-1 flex items-baseline gap-1">
                  <span className="font-mono text-3xl font-bold tabular-nums">{pct}</span>
                  <span className="font-mono text-[11px] uppercase tracking-[0.18em] opacity-70">
                    %
                  </span>
                </div>
                <div className="mt-1 truncate font-sans text-xs opacity-80">{p.name ?? '—'}</div>
                <div className="mt-2 grid grid-cols-2 gap-1 font-mono text-[10px] opacity-80">
                  <span>top · {Math.round(p.topConditionRate * 100)}%</span>
                  <span>gauntlet · {Math.round(p.gauntletPassRate * 100)}%</span>
                  <span>cases · {p.caseCount ?? 0}</span>
                  {p.p50LatencyMs !== undefined && (
                    <span>p50 · {Math.round(p.p50LatencyMs / 100) / 10}s</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AppearanceTab() {
  const { t } = useTranslation();
  const { theme, set } = useTheme();
  const [tapToWake, setTapToWake] = useState<boolean>(() => readTapToWakeEnabled());
  const [voiceQuality, setVoiceQualityState] = useState<VoiceQuality>(() => readVoiceQuality());
  const [voiceId, setVoiceIdState] = useState<VoiceId>(() => readVoiceId());
  const [autoTranslate, setAutoTranslate] = useState<boolean>(() => readAutoTranslatePref());
  const [faceMirror, setFaceMirror] = useState<boolean>(() => readFaceMirrorPref());
  const themeOpts: Array<{ id: 'dark' | 'light'; label: string }> = [
    { id: 'dark', label: t('settings.appearance.themeDark') },
    { id: 'light', label: t('settings.appearance.themeLight') },
  ];

  return (
    <Section title={t('settings.appearance.title')}>
      <div className="space-y-6">
        <div>
          <div className="font-sans text-xs text-app-secondary">
            {t('settings.appearance.theme')}
          </div>
          <p className="mt-1 font-sans text-xs text-app-muted">
            Mörbius runs on a single bioluminescent theme. Pick dark or light below — that's it.
          </p>
          <div className="mt-3 inline-flex gap-1 rounded-lg border border-app-subtle p-1">
            {themeOpts.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => set(o.id)}
                className={cn(
                  'rounded-md px-4 py-1.5 font-sans text-sm transition-colors',
                  theme === o.id
                    ? 'bg-quantum-500/20 text-quantum-300'
                    : 'text-app-muted hover:text-app-primary',
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between gap-4 rounded-lg border border-app-subtle p-4">
            <div>
              <div className="font-display text-sm text-app-primary">
                {t('settings.appearance.tapToWake')}
              </div>
              <p className="mt-1 font-sans text-xs text-app-muted">
                {t('settings.appearance.tapToWakeDesc')}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={tapToWake}
              onClick={() => {
                const next = !tapToWake;
                setTapToWake(next);
                writeTapToWakeEnabled(next);
              }}
              className={cn(
                'relative h-6 w-11 rounded-full border transition-colors',
                tapToWake ? 'border-bio-500/60 bg-bio-500/30' : 'border-app-subtle bg-white/5',
              )}
            >
              <span
                className={cn(
                  'absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-app-primary transition-transform',
                  tapToWake && 'translate-x-5',
                )}
              />
            </button>
          </div>
          {tapToWake && (
            <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-amber-300/80">
              {t('settings.appearance.tapToWakeMicWarning')}
            </p>
          )}
        </div>

        <VoiceIdentityBlock
          voiceId={voiceId}
          onChange={(id) => {
            setVoiceIdState(id);
            writeVoiceId(id);
          }}
        />

        <div>
          <div className="flex items-center justify-between gap-4 rounded-lg border border-app-subtle p-4">
            <div>
              <div className="font-display text-sm text-app-primary">
                Mirror my head movement (camera)
              </div>
              <p className="mt-1 font-sans text-xs text-app-muted">
                Mörbius's avatar mirrors your head turn / tilt instead of following the cursor. Uses
                MediaPipe FaceLandmarker on-device — no frame ever leaves your browser. Falls back
                to cursor-tracking if you turn it off or step out of frame.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={faceMirror}
              onClick={() => {
                const next = !faceMirror;
                setFaceMirror(next);
                writeFaceMirrorPref(next);
              }}
              className={cn(
                'relative h-6 w-11 rounded-full border transition-colors',
                faceMirror ? 'border-bio-500/60 bg-bio-500/30' : 'border-app-subtle bg-white/5',
              )}
            >
              <span
                className={cn(
                  'absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-app-primary transition-transform',
                  faceMirror && 'translate-x-5',
                )}
              />
            </button>
          </div>
          {faceMirror && (
            <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-amber-300/80">
              ⚠ camera permission required · the floating chip in the top-right shows live status
            </p>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between gap-4 rounded-lg border border-app-subtle p-4">
            <div>
              <div className="font-display text-sm text-app-primary">
                Auto-translate Mörbius replies
              </div>
              <p className="mt-1 font-sans text-xs text-app-muted">
                When your locale isn't English, route Mörbius's chat replies through the py-svc
                MarianMT pipeline. On-prem, no API keys, falls back silently if the model isn't
                loaded.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={autoTranslate}
              onClick={() => {
                const next = !autoTranslate;
                setAutoTranslate(next);
                writeAutoTranslatePref(next);
              }}
              className={cn(
                'relative h-6 w-11 rounded-full border transition-colors',
                autoTranslate ? 'border-bio-500/60 bg-bio-500/30' : 'border-app-subtle bg-white/5',
              )}
            >
              <span
                className={cn(
                  'absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-app-primary transition-transform',
                  autoTranslate && 'translate-x-5',
                )}
              />
            </button>
          </div>
        </div>

        <NarratorReplayBlock />
      </div>
    </Section>
  );
}

/**
 * ModePreviewCard — live thumbnail of what each theme mode looks like.
 *
 * Renders a tiny mock surface in the mode's actual palette: gradient
 * background, sample headline in the mode's display font, two sample
 * pills, and an accent swatch. Every card uses the same DOM but
 * swaps colours via inline styles, so the gallery scales when a new
 * mode is added (just append to modeOpts).
 */
function ModePreviewCard({
  id,
  label,
  desc,
  accent,
  active,
  onPick,
}: {
  id: 'clinical' | 'aurora' | 'cobalt' | 'sage' | 'synthwave';
  label: string;
  desc: string;
  accent: string;
  active: boolean;
  onPick: () => void;
}) {
  // Per-mode preview palette. These are visual cues, not the live
  // theme tokens — intentionally rendered inline so the preview reads
  // identically regardless of what theme the rest of the page is in.
  const swatch: Record<typeof id, { bg: string; ink: string; chip: string; font: string }> = {
    aurora: {
      bg: 'linear-gradient(135deg, #050b18, #082f49 60%, #0a1628)',
      ink: '#ecfeff',
      chip: 'rgba(56, 189, 248, 0.20)',
      font: '"Playfair Display", Georgia, serif',
    },
    clinical: {
      bg: 'linear-gradient(135deg, #fafaf7, #f3eee2 70%)',
      ink: '#0b1f3a',
      chip: 'rgba(122, 31, 42, 0.10)',
      font: '"Cormorant Garamond", Georgia, serif',
    },
    cobalt: {
      bg: 'linear-gradient(135deg, #050a1a, #0b1530 50%, #1d4ed8)',
      ink: '#f8faff',
      chip: 'rgba(96, 165, 250, 0.22)',
      font: '"Syne", "Playfair Display", sans-serif',
    },
    sage: {
      bg: 'linear-gradient(135deg, #eaf4ec, #d8ead9 70%)',
      ink: '#122a1c',
      chip: 'rgba(16, 185, 129, 0.18)',
      font: '"Cormorant Garamond", Georgia, serif',
    },
    synthwave: {
      bg: 'linear-gradient(135deg, #0a0118, #2d0b3a 50%, #5b1768)',
      ink: '#fef2ff',
      chip: 'rgba(236, 72, 153, 0.25)',
      font: '"Syne", "Playfair Display", sans-serif',
    },
  };
  const s = swatch[id];
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={active}
      className={cn(
        'group flex flex-col gap-3 rounded-xl border p-3 text-left transition-all',
        active
          ? 'border-app-strong shadow-[0_0_40px_-15px_rgba(56,189,248,0.5)]'
          : 'border-app-subtle hover:-translate-y-0.5 hover:border-app-strong/60',
      )}
    >
      <div className="relative h-24 w-full overflow-hidden rounded-lg" style={{ background: s.bg }}>
        <div className="absolute inset-2 flex flex-col justify-between">
          <div
            className="font-bold text-sm leading-tight"
            style={{ color: s.ink, fontFamily: s.font }}
          >
            Mörbius
          </div>
          <div className="flex items-center gap-1.5">
            <span
              className="rounded-full px-1.5 py-0.5 text-[8px] font-mono uppercase tracking-[0.18em]"
              style={{ background: s.chip, color: s.ink }}
            >
              consult
            </span>
            <span
              className="rounded-full px-1.5 py-0.5 text-[8px] font-mono uppercase tracking-[0.18em]"
              style={{ background: s.chip, color: s.ink }}
            >
              brain
            </span>
          </div>
        </div>
        <span
          className="absolute right-2 top-2 inline-block h-3 w-3 rounded-full ring-2 ring-white/30"
          style={{ background: accent }}
        />
      </div>
      <div className="flex items-baseline justify-between">
        <span className="font-display text-base text-app-primary">{label}</span>
        {active && (
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-bio-400">
            active
          </span>
        )}
      </div>
      <p className="font-sans text-xs leading-relaxed text-app-muted">{desc}</p>
    </button>
  );
}

/**
 * VoiceIdentityBlock — picks Mörbius's voice identity (3 male · 3
 * female · 2 robotic · system default). Tone-grouped layout. Each
 * option has a small `test` button so the architect can preview
 * before committing. The major-bug fix: writing the choice clears the
 * pinned-voice cache in lib/voice.ts so the very next utterance uses
 * the new identity instead of waiting for a page refresh.
 */
function VoiceIdentityBlock({
  voiceId,
  onChange,
}: { voiceId: VoiceId; onChange: (id: VoiceId) => void }) {
  const groups: Array<{ tone: 'neutral' | 'male' | 'female' | 'robotic'; label: string }> = [
    { tone: 'neutral', label: 'System default' },
    { tone: 'male', label: 'Male voices' },
    { tone: 'female', label: 'Female voices' },
    { tone: 'robotic', label: 'Robotic voices' },
  ];
  return (
    <div className="rounded-lg border border-app-subtle p-4">
      <div className="mb-3">
        <div className="font-display text-sm text-app-primary">Mörbius identity</div>
        <p className="mt-1 max-w-2xl font-sans text-xs text-app-muted">
          One voice across every surface — chat, consult, landing, dev console. Picking here pins
          the identity for the rest of the session. Default is the system-best voice for your OS +
          locale; the others let you choose between three male, three female, and two deliberately
          robotic options. No audio leaves the device.
        </p>
      </div>
      {groups.map((g) => {
        const opts = MORBIUS_VOICES.filter((v) => v.tone === g.tone);
        if (opts.length === 0) return null;
        return (
          <div key={g.tone} className="mb-3 last:mb-0">
            <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
              {g.label}
            </div>
            <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {opts.map((o) => (
                <div
                  key={o.id}
                  className={cn(
                    'flex flex-col gap-1 rounded-md border px-3 py-2 transition-colors',
                    voiceId === o.id
                      ? 'border-quantum-400/50 bg-quantum-500/10'
                      : 'border-app-subtle hover:bg-white/5',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => {
                      onChange(o.id);
                      // KISS — selecting the voice fires a brief sample so
                      // the user hears the change without a second click.
                      speakWithProsody(
                        `Mörbius reporting in. Voice ${o.label.replace(/^Mörbius · /, '')}.`,
                        { identity: o.id, lang: 'en-US' },
                      );
                    }}
                    className="block w-full text-left"
                  >
                    <div className="font-display text-sm text-app-primary">{o.label}</div>
                    <p className="mt-0.5 font-sans text-[11px] text-app-muted">{o.hint}</p>
                  </button>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function VoiceQualityBlock({
  quality,
  onChange,
}: { quality: VoiceQuality; onChange: (q: VoiceQuality) => void }) {
  const opts: Array<{ id: VoiceQuality; label: string; desc: string }> = [
    {
      id: 'tuned',
      label: 'Tuned (recommended)',
      desc: 'Best per-OS voice + clause-by-clause cadence with calmer rate and pitch.',
    },
    {
      id: 'system',
      label: 'System default',
      desc: 'Browser default voice + single-utterance speech. Faster, less considered.',
    },
    {
      id: 'off',
      label: 'Off',
      desc: 'Silent Mörbius. Captions and overlays still render.',
    },
  ];
  return (
    <div>
      <div className="rounded-lg border border-app-subtle p-4">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <div className="font-display text-sm text-app-primary">Mörbius voice</div>
            <p className="mt-1 font-sans text-xs text-app-muted">
              How Mörbius sounds when speaking. Pure browser SpeechSynthesis — no audio leaves the
              device.
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              speakWithProsody('Voice check. Mörbius reporting in. The signal is clear.', {
                quality,
                lang: 'en-US',
              })
            }
            className="rounded-md border border-quantum-400/40 bg-quantum-500/10 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-quantum-300 hover:bg-quantum-500/20"
          >
            test
          </button>
        </div>
        <div className="mt-3 space-y-1.5">
          {opts.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => onChange(o.id)}
              className={cn(
                'flex w-full items-start gap-3 rounded-md border px-3 py-2 text-left transition-colors',
                quality === o.id
                  ? 'border-quantum-400/50 bg-quantum-500/10'
                  : 'border-app-subtle hover:bg-white/5',
              )}
            >
              <span className="mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full bg-quantum-300" />
              <span>
                <span className="block font-display text-sm text-app-primary">{o.label}</span>
                <span className="block font-sans text-xs text-app-muted">{o.desc}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function NarratorReplayBlock() {
  const { user } = useAuth();
  const replay = () => {
    if (!user) return;
    window.localStorage.removeItem(`dr-abc:narrator-seen:${user.id}`);
    // Hard reload so the narrator's auto-open useEffect runs again on
    // next /app paint without needing extra wiring through context.
    window.location.assign('/app');
  };
  return (
    <div>
      <div className="mb-1 font-sans text-xs text-app-secondary">Onboarding tour</div>
      <p className="font-sans text-[11px] leading-relaxed text-app-muted">
        Replay the first-run Mörbius narrator that walks through every page in your role. The
        narrator persists "seen" per-user so it only fires once automatically — this button forces
        another run.
      </p>
      <Button variant="ghost" onClick={replay} className="mt-2">
        Replay tour
      </Button>
    </div>
  );
}

function BackendTab() {
  const [pin, setPin] = useState<BackendId>(() => readBackendPin());
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [serverBackend, setServerBackend] = useState<string | null>(null);

  const pick = (id: BackendId) => {
    setPin(id);
    setError(null);
    void writeBackendPin(id).then((res) => {
      if (res.ok) {
        setSavedAt(Date.now());
        if (res.diagnosticBackend) setServerBackend(res.diagnosticBackend);
        setTimeout(() => setSavedAt(null), 2500);
      } else {
        setError(res.error ?? 'failed to apply');
      }
    });
  };

  const freeBadge = (v: 'yes' | 'no' | 'after-pagefile') =>
    v === 'yes' ? 'free' : v === 'no' ? 'paid' : 'free · after F: page-file';
  const freeTone = (v: 'yes' | 'no' | 'after-pagefile') =>
    v === 'yes'
      ? 'border-bio-500/40 bg-bio-500/10 text-bio-300'
      : v === 'no'
        ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
        : 'border-quantum-500/40 bg-quantum-500/10 text-quantum-300';

  return (
    <Section
      title="Diagnostic backend"
      subtitle="Pick which model fires for your consults. Cascade (recommended) tries every backend in priority order and falls through on failure — no single point of failure. Pinning a specific backend overrides the order for your traffic only; the project-wide .env stays untouched."
    >
      <div className="grid gap-3">
        {BACKENDS.map((b) => {
          const active = pin === b.id;
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => pick(b.id)}
              className={cn(
                'flex flex-col items-start gap-2 rounded-xl border px-4 py-3 text-left transition-colors',
                active
                  ? 'border-quantum-400/60 bg-quantum-500/10'
                  : 'border-app-subtle bg-white/3 hover:bg-white/5',
              )}
            >
              <div className="flex w-full items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-display text-base font-semibold text-app-primary">
                    {b.label}
                  </span>
                  {active && (
                    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-quantum-400">
                      · active
                    </span>
                  )}
                </div>
                <span
                  className={cn(
                    'rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em]',
                    freeTone(b.free),
                  )}
                >
                  {freeBadge(b.free)}
                </span>
              </div>
              <p className="font-sans text-xs text-app-muted">{b.detail}</p>
              <div className="grid w-full grid-cols-1 gap-x-4 gap-y-1 font-mono text-[10px] text-app-faint sm:grid-cols-2">
                <span>
                  <span className="text-app-muted">model:</span> {b.model}
                </span>
                <span>
                  <span className="text-app-muted">latency:</span> {b.latency}
                </span>
                <span>
                  <span className="text-app-muted">MedQA:</span> {b.medqa}
                </span>
                <span>
                  <span className="text-app-muted">best for:</span> {b.bestFor}
                </span>
              </div>
            </button>
          );
        })}
      </div>
      {savedAt !== null && (
        <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.22em] text-bio-300">
          saved · server rebuilt diagnostic agent
          {serverBackend ? ` · now: ${serverBackend}` : ''}
        </p>
      )}
      {error !== null && (
        <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.22em] text-rose-300">
          server rejected: {error} · localStorage updated, but the API didn't accept the override
        </p>
      )}
      <p className="mt-4 font-sans text-[11px] text-app-faint">
        The pin POSTs{' '}
        <code className="rounded bg-white/5 px-1.5 py-0.5 text-app-secondary">MORBIUS_BACKEND</code>{' '}
        to <code>/dev/env-keys</code>, which rebuilds the diagnostic agent on the spot. The next{' '}
        <code>/orchestrate</code> call uses your pinned backend; cascade fallback still fires on
        provider failure. Switching is instant — no .env edit, no restart.
      </p>
    </Section>
  );
}

function LanguageTab() {
  const { t, i18n } = useTranslation();
  return (
    <Section title={t('settings.language.title')} subtitle={t('settings.language.subtitle')}>
      <div className="space-y-2">
        {SUPPORTED_LANGS.map((lang) => {
          const active = i18n.resolvedLanguage === lang.code;
          return (
            <button
              key={lang.code}
              type="button"
              onClick={() => void i18n.changeLanguage(lang.code)}
              className={cn(
                'flex w-full items-center justify-between rounded-lg border px-4 py-3 transition-colors',
                active
                  ? 'border-quantum-400/40 bg-quantum-500/10'
                  : 'border-app-subtle bg-white/3 hover:bg-white/5',
              )}
            >
              <div>
                <div className="font-sans text-sm font-medium text-app-primary">{lang.native}</div>
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-app-faint">
                  {lang.label} · {lang.code.toUpperCase()}
                </div>
              </div>
              {active && (
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-quantum-400">
                  active
                </span>
              )}
            </button>
          );
        })}
      </div>
    </Section>
  );
}

function NotificationsTab() {
  const { t } = useTranslation();
  const [prefs, setPrefs] = useState<NotificationPrefs>(() => readNotifPrefs());

  useEffect(() => {
    writeNotifPrefs(prefs);
  }, [prefs]);

  const rows: Array<{ id: keyof NotificationPrefs; label: string }> = [
    { id: 'appointment', label: t('settings.notifications.appointment') },
    { id: 'consult', label: t('settings.notifications.consult') },
    { id: 'marketing', label: t('settings.notifications.marketing') },
  ];
  const channels: Array<{ id: 'email' | 'push' | 'sms'; label: string }> = [
    { id: 'email', label: t('settings.notifications.channelEmail') },
    { id: 'push', label: t('settings.notifications.channelPush') },
    { id: 'sms', label: t('settings.notifications.channelSms') },
  ];

  return (
    <Section title={t('settings.notifications.title')}>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-app-subtle">
              <th className="py-2 text-left font-mono text-[10px] uppercase tracking-[0.18em] text-app-faint">
                Type
              </th>
              {channels.map((c) => (
                <th
                  key={c.id}
                  className="py-2 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-app-faint"
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-app-subtle/50">
                <td className="py-3 font-sans text-app-primary">{row.label}</td>
                {channels.map((c) => (
                  <td key={c.id} className="py-3 text-center">
                    <input
                      type="checkbox"
                      checked={prefs[row.id][c.id]}
                      onChange={(e) =>
                        setPrefs({
                          ...prefs,
                          [row.id]: { ...prefs[row.id], [c.id]: e.target.checked },
                        })
                      }
                      className="h-4 w-4 cursor-pointer accent-quantum-500"
                    />
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <td className="py-3 font-sans text-app-muted">
                {t('settings.notifications.alerts')}
              </td>
              {channels.map((c) => (
                <td key={c.id} className="py-3 text-center font-mono text-[10px] text-bio-400">
                  ON
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function SecurityTab() {
  const { t } = useTranslation();
  const { user, signOut } = useAuth();
  return (
    <Section title={t('settings.security.title')}>
      <div className="space-y-3">
        <Row
          label={t('settings.security.twoFactor')}
          right={
            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-amber-400">
              {t('settings.security.twoFactorDisabled')}
            </span>
          }
        />
        <Row
          label={t('settings.security.manageDevices')}
          right={<Button variant="ghost">→</Button>}
        />
        <Row label={t('settings.security.exportData')} right={<Button variant="ghost">→</Button>} />
        <Row
          label={t('settings.security.deleteAccount')}
          right={
            <DestructiveConfirm
              title="Delete medical record + every consult"
              description="Wipes your demographics, allergies, medications, conditions, family history, every saved consult transcript, every per-consult patient snapshot, and the narrator-seen marker. The auth session signs out automatically. This cannot be undone."
              actionLabel="Delete forever"
              onConfirm={async () => {
                if (!user) return;
                purgeUserData(user.id);
                await signOut();
              }}
            >
              {(open) => (
                <Button
                  variant="ghost"
                  onClick={open}
                  className="text-rose-400 hover:bg-rose-500/10"
                >
                  Delete →
                </Button>
              )}
            </DestructiveConfirm>
          }
        />
      </div>

      {/* Mörbius capability ladder: read, write, analysis help, and
          change-password permissions. Every permission is off by
          default and toggled by the architect role. The toggles persist
          to localStorage; agents read the flags before acting. */}
      <div className="mt-6">
        <MorbiusPermissionsPanel />
      </div>
    </Section>
  );
}

interface MorbiusCapability {
  key: string;
  label: string;
  body: string;
  defaultOn: boolean;
  tier: 'safe' | 'review' | 'sensitive';
}

const MORBIUS_CAPS: MorbiusCapability[] = [
  {
    key: 'read',
    label: 'Read · medical record + consult history',
    body: "Mörbius reads the architect's FHIR record + saved consults to ground answers in real history. Never sends data off-device.",
    defaultOn: true,
    tier: 'safe',
  },
  {
    key: 'speak',
    label: 'Speak · narrate every analysis',
    body: 'Voice the impression / differential / scribe summary on every result. On-device speechSynthesis only, no audio leaves the browser.',
    defaultOn: true,
    tier: 'safe',
  },
  {
    key: 'help-analysis',
    label: 'Help · proactive analysis hints',
    body: 'Surface follow-up tests, ICD codes, drug interactions inline as Mörbius reads. Always advisory; the architect signs every Rx.',
    defaultOn: true,
    tier: 'safe',
  },
  {
    key: 'write',
    label: 'Write · auto-save consult drafts to local IndexedDB',
    body: 'Persist every turn + Rx draft to IndexedDB so resume works across reloads. Local-only · gitignored from Mörbius repo.',
    defaultOn: true,
    tier: 'safe',
  },
  {
    key: 'change-password',
    label: 'Change application password (operator-confirmed)',
    body: 'Mörbius can rotate the dev-console PIN + (when wired) the auth password — only after a one-shot confirm prompt. Off until enabled.',
    defaultOn: false,
    tier: 'review',
  },
  {
    key: 'outbound-tune',
    label: 'Outbound · post tune proposals to /dev/calibrate',
    body: 'Operator-approved tunes ship to the validator + safety thresholds. Off by default — flip after the first tune review.',
    defaultOn: false,
    tier: 'review',
  },
  {
    key: 'web-fetch',
    label: 'Web · live PubMed / arXiv lookup',
    body: 'Mörbius can call PubMed E-utilities + arXiv (anonymous, free) to ground replies in fresh literature. Off if you want strict offline mode.',
    defaultOn: true,
    tier: 'safe',
  },
  {
    key: 'system-shell',
    label: 'System shell (sensitive · disabled)',
    body: 'Mörbius does NOT have shell access. The agent stack runs in-process JS only. Permanently off in this build.',
    defaultOn: false,
    tier: 'sensitive',
  },
];

function MorbiusPermissionsPanel() {
  const [perms, setPerms] = useState<Record<string, boolean>>(() => {
    if (typeof window === 'undefined')
      return Object.fromEntries(MORBIUS_CAPS.map((c) => [c.key, c.defaultOn]));
    try {
      const raw = window.localStorage.getItem('dr-abc:morbius-perms');
      if (raw) return JSON.parse(raw);
    } catch {
      /* ignore */
    }
    return Object.fromEntries(MORBIUS_CAPS.map((c) => [c.key, c.defaultOn]));
  });

  const toggle = (key: string) => {
    setPerms((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try {
        window.localStorage.setItem('dr-abc:morbius-perms', JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  return (
    <div className="rounded-xl border border-quantum-400/30 bg-quantum-500/5 p-5">
      <div className="font-mono text-[10px] uppercase tracking-[0.32em] text-quantum-300">
        · Mörbius permissions
      </div>
      <h3 className="mt-1 font-display text-xl font-bold text-app-primary">
        What Mörbius is allowed to do for you.
      </h3>
      <p className="mt-2 max-w-2xl font-sans text-sm text-app-muted">
        Every permission is local-first and architect-controlled. Sensitive tiers (change password,
        outbound tune) are off by default and need an explicit flip. Saved to your browser; revoke
        any time.
      </p>
      <div className="mt-5 space-y-2">
        {MORBIUS_CAPS.map((cap) => {
          const on = perms[cap.key] ?? cap.defaultOn;
          const isSensitive = cap.tier === 'sensitive';
          return (
            <div
              key={cap.key}
              className={cn(
                'flex items-start justify-between gap-3 rounded-lg border px-4 py-3',
                isSensitive
                  ? 'border-rose-500/30 bg-rose-500/5'
                  : cap.tier === 'review'
                    ? 'border-amber-400/30 bg-amber-500/5'
                    : 'border-app-subtle bg-white/3',
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="font-sans text-sm font-medium text-app-primary">
                    {cap.label}
                  </span>
                  <span
                    className={cn(
                      'font-mono text-[9px] uppercase tracking-[0.22em]',
                      cap.tier === 'safe'
                        ? 'text-bio-300'
                        : cap.tier === 'review'
                          ? 'text-amber-300'
                          : 'text-rose-300',
                    )}
                  >
                    · {cap.tier}
                  </span>
                </div>
                <p className="mt-1 font-sans text-xs text-app-muted">{cap.body}</p>
              </div>
              <button
                type="button"
                onClick={() => !isSensitive && toggle(cap.key)}
                disabled={isSensitive}
                aria-pressed={on}
                className={cn(
                  'inline-flex h-6 w-12 shrink-0 items-center rounded-full border px-0.5 transition',
                  on
                    ? 'justify-end border-bio-400/60 bg-bio-500/30'
                    : 'justify-start border-app-subtle bg-white/5',
                  isSensitive && 'cursor-not-allowed opacity-60',
                )}
              >
                <span
                  className={cn(
                    'h-5 w-5 rounded-full transition',
                    on ? 'bg-bio-300' : 'bg-app-muted',
                  )}
                />
              </button>
            </div>
          );
        })}
      </div>
      <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
        Stored locally · key <code className="text-quantum-200">dr-abc:morbius-perms</code>
      </p>
    </div>
  );
}

function Row({ label, right }: { label: string; right: ReactNode }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-app-subtle bg-white/3 px-4 py-3">
      <span className="font-sans text-sm text-app-primary">{label}</span>
      {right}
    </div>
  );
}

function BillingTab() {
  const { t } = useTranslation();
  return (
    <Section title={t('settings.billing.title')}>
      <div className="rounded-lg border border-quantum-400/30 bg-quantum-500/5 p-5">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-quantum-400">
          {t('settings.billing.plan')}
        </div>
        <div className="mt-1 font-display text-2xl font-bold text-app-primary">
          {t('settings.billing.free')}
        </div>
        <p className="mt-3 font-sans text-sm text-app-secondary">
          {t('settings.billing.upgradeBody')}
        </p>
        <Button variant="primary" className="mt-4">
          {t('settings.billing.upgradeCta')}
        </Button>
      </div>
    </Section>
  );
}
