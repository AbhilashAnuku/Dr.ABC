import { Card, cn } from '@dr-abc/ui';
import {
  Activity,
  Bluetooth,
  Footprints,
  HeartPulse,
  Mail,
  Moon,
  type Phone,
  Smartphone,
  Watch,
  Wifi,
} from 'lucide-react';
import { useEffect, useState } from 'react';

/**
 * Device-connect — multi-device sync panel for the profile page.
 *
 * Each card represents a real integration target. The connect-state is
 * persisted per-user in localStorage (key `dr-abc:devices:<userId>`)
 * and the API endpoints used to actually exchange data live alongside:
 *
 *   · Apple Health   — HealthKit via the Capacitor wrapper (mobile)
 *   · Google Fit     — OAuth2 → /fitness/sync (already wired in apps/api)
 *   · Fitbit         — OAuth2 → fitbit.com/oauth2 (placeholder URL)
 *   · Samsung Health — Samsung Health SDK (Android, deep-link out)
 *   · Mail / contacts— Google People API (read-only consent flow)
 *
 * "Connect" toggles a placeholder OAuth handoff — the real key
 * exchange ships with the Capacitor build. The web shell stores the
 * intent so the consult flow can read live device data when present.
 *
 * Sleep + steps + heart-rate metrics are seeded from a deterministic
 * mock (so demos look alive) until a connected device replaces them.
 */

type DeviceId = 'apple-health' | 'google-fit' | 'fitbit' | 'samsung-health' | 'mail' | 'phone';

interface Device {
  id: DeviceId;
  label: string;
  vendor: string;
  icon: typeof Watch;
  body: string;
  /** External handoff URL — opens in a new tab on Connect. */
  authUrl?: string;
  /** Local data the sync would surface (live in the demo, mocked here). */
  metrics?: { label: string; value: string; tone: 'bio' | 'purple' | 'blue' | 'amber' }[];
}

/**
 * Device registry — metrics arrays are intentionally empty. No
 * placeholder data is shown anywhere in this panel: a card only
 * renders numbers when a real device has actually pushed data through
 * one of the live endpoints. Until then the card shows the connection
 * status and the body copy that explains what would arrive.
 */
const DEVICES: Device[] = [
  {
    id: 'apple-health',
    label: 'Apple Health',
    vendor: 'HealthKit',
    icon: Watch,
    body: 'iPhone + Apple Watch sleep, HR, ECG, steps, blood-O2. Authorise via the Capacitor build on iOS — read-only.',
  },
  {
    id: 'google-fit',
    label: 'Google Fit',
    vendor: 'Fit REST API',
    icon: Footprints,
    body: 'Daily steps + active minutes + heart-rate zones via OAuth. Fitness scopes are currently disabled server-side; reconnect lands here once the GCP OAuth consent screen is cleaned up.',
  },
  {
    id: 'fitbit',
    label: 'Fitbit',
    vendor: 'Fitbit Web API',
    icon: HeartPulse,
    body: 'HRV, SpO2 trend, sleep stages. OAuth2 client_id required — set FITBIT_CLIENT_ID in /dev/env-keys, then the connect flow opens fitbit.com/oauth2/authorize.',
  },
  {
    id: 'samsung-health',
    label: 'Samsung Health',
    vendor: 'Samsung Health SDK',
    icon: Activity,
    body: 'Sleep + activity + stress score. Android-only — deep-links to the Samsung Health app for the consent grant.',
  },
  {
    id: 'phone',
    label: 'Phone sensors',
    vendor: 'On-device',
    icon: Smartphone,
    body: 'Camera-based PPG pulse + accelerometer-driven gait + microphone-driven respiratory rate. All on-device — no upload.',
  },
  {
    id: 'mail',
    label: 'Mail & contacts',
    vendor: 'Google People',
    icon: Mail,
    body: 'Reads emergency-contact + next-of-kin into the patient record. Read-only OAuth scope, no message access.',
  },
];

interface DeviceState {
  connectedAt: number | null;
}

function loadState(userId: string): Record<DeviceId, DeviceState> {
  try {
    const raw = localStorage.getItem(`dr-abc:devices:${userId}`);
    if (!raw) return EMPTY_STATE;
    const parsed = JSON.parse(raw) as Record<DeviceId, DeviceState>;
    return { ...EMPTY_STATE, ...parsed };
  } catch {
    return EMPTY_STATE;
  }
}

function saveState(userId: string, state: Record<DeviceId, DeviceState>) {
  try {
    localStorage.setItem(`dr-abc:devices:${userId}`, JSON.stringify(state));
  } catch {
    /* quota — ignore */
  }
}

const EMPTY_STATE: Record<DeviceId, DeviceState> = {
  'apple-health': { connectedAt: null },
  'google-fit': { connectedAt: null },
  fitbit: { connectedAt: null },
  'samsung-health': { connectedAt: null },
  phone: { connectedAt: null },
  mail: { connectedAt: null },
};

export function DeviceConnect({ userId }: { userId: string }) {
  const [state, setState] = useState<Record<DeviceId, DeviceState>>(EMPTY_STATE);

  useEffect(() => {
    setState(loadState(userId));
  }, [userId]);

  const toggle = (id: DeviceId, authUrl?: string) => {
    setState((prev) => {
      const next: Record<DeviceId, DeviceState> = {
        ...prev,
        [id]: { connectedAt: prev[id].connectedAt ? null : Date.now() },
      };
      saveState(userId, next);
      return next;
    });
    if (authUrl && !state[id].connectedAt) {
      // Mörbius-owned OAuth endpoints (e.g. /auth/google/start?fit=1)
      // need the cookie + redirect chain to round-trip in the SAME tab,
      // otherwise the consent grant lands in a stranded popup. Generic
      // third-party authz URLs (Fitbit, Samsung) still open in a new
      // tab so we don't blow away the consult the user is on.
      const isMorbiusOauth = authUrl.includes('/auth/google/start');
      if (isMorbiusOauth) {
        window.location.href = authUrl;
      } else {
        window.open(authUrl, '_blank', 'noopener,noreferrer');
      }
    }
  };

  const connectedCount = Object.values(state).filter((s) => s.connectedAt).length;

  return (
    <Card className="p-6">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <div className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.32em] text-purple-300">
            <Bluetooth className="h-3 w-3" /> · multi-device sync
          </div>
          <h2 className="mt-1 font-syne text-xl font-bold text-app-primary">
            Connected devices · {connectedCount} live
          </h2>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
          {connectedCount} / {DEVICES.length} connected
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {DEVICES.map((d) => {
          const live = state[d.id].connectedAt !== null;
          const Icon = d.icon;
          return (
            <div
              key={d.id}
              className={cn(
                'rounded-xl border bg-white/[0.025] p-4 backdrop-blur-md transition',
                live
                  ? 'border-bio-500/40 shadow-[0_0_50px_-25px_rgba(16,185,129,0.55)]'
                  : 'border-app-subtle hover:border-purple-400/40',
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2">
                  <div
                    className={cn(
                      'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border',
                      live
                        ? 'border-bio-500/40 bg-bio-500/10 text-bio-300'
                        : 'border-app-subtle bg-white/5 text-app-muted',
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="font-syne text-sm font-semibold text-app-primary">
                      {d.label}
                    </div>
                    <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-app-faint">
                      {d.vendor}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => toggle(d.id, d.authUrl)}
                  className={cn(
                    'rounded-full border px-3 py-0.5 font-mono text-[9px] uppercase tracking-[0.22em] transition',
                    live
                      ? 'border-rose-500/40 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20'
                      : 'border-purple-400/40 bg-purple-500/10 text-purple-200 hover:bg-purple-500/20',
                  )}
                >
                  {live ? 'disconnect' : 'connect'}
                </button>
              </div>
              <p className="mt-3 font-grotesk text-xs leading-relaxed text-app-muted">{d.body}</p>
              {live && (
                <div className="mt-3 flex items-center gap-2 rounded-md border border-bio-500/30 bg-bio-500/8 px-3 py-2">
                  <Wifi className="h-3.5 w-3.5 text-bio-300" />
                  <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-bio-200">
                    Awaiting first sync · no data yet
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-4 inline-flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.22em] text-app-faint">
        <Wifi className="h-3 w-3" /> Live data only — when a connected device actually pushes a
        sync. No mock numbers.
      </p>
    </Card>
  );
}

function DeviceMetric({
  label,
  value,
  tone,
}: { label: string; value: string; tone: 'bio' | 'purple' | 'blue' | 'amber' }) {
  const toneCls = {
    bio: 'text-bio-300',
    purple: 'text-purple-300',
    blue: 'text-blue-300',
    amber: 'text-amber-300',
  } as const;
  return (
    <div className="rounded-md border border-app-subtle bg-white/[0.02] px-2 py-1.5">
      <div className={cn('font-syne text-base font-bold tabular-nums', toneCls[tone])}>{value}</div>
      <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-app-faint">{label}</div>
    </div>
  );
}

function SleepRow({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Phone;
  label: string;
  value: string;
  tone: 'bio' | 'purple' | 'blue' | 'amber';
}) {
  const toneCls = {
    bio: 'text-bio-300 border-bio-500/30 bg-bio-500/10',
    purple: 'text-purple-300 border-purple-400/30 bg-purple-500/10',
    blue: 'text-blue-300 border-blue-400/30 bg-blue-500/10',
    amber: 'text-amber-300 border-amber-500/30 bg-amber-500/10',
  } as const;
  return (
    <div className="flex items-center gap-3">
      <div
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border',
          toneCls[tone],
        )}
      >
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <div className="font-syne text-sm font-semibold text-app-primary">{value}</div>
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
          {label}
        </div>
      </div>
    </div>
  );
}
