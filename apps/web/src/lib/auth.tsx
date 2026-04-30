import { type ReactNode, createContext, useCallback, useContext, useEffect, useState } from 'react';
import { API_BASE } from './config.ts';
import { appendConsult } from './consult-history.ts';
import { findPersona } from './demo-personas.ts';
import { saveRecord } from './medical-record.ts';
import { writeVoicePreset } from './voice-presets.ts';

interface ApiUser {
  id: string;
  email: string;
  name: string;
  locale: string;
  role: 'demo';
  patientIdHash: string | null;
  createdAt: string;
}

interface ApiAuthResponse {
  ok: boolean;
  user?: ApiUser;
  error?: string;
}

/**
 * Shape of /auth/session/me when the user signed in via Google. The
 * server caches the userinfo response so the frontend can pre-fill
 * everything Google already returned — name, email, avatar, locale.
 */
interface SessionUser {
  id: string;
  provider?: 'google' | 'local';
  email?: string;
  emailVerified?: boolean;
  name?: string;
  givenName?: string;
  familyName?: string;
  picture?: string;
  locale?: string;
}

function apiUserToUser(api: ApiUser): User {
  return {
    id: api.id,
    email: api.email,
    name: api.name,
    avatarUrl: null,
    locale: (api.locale === 'de' || api.locale === 'hi' ? api.locale : 'en') as User['locale'],
    role: 'demo',
    createdAt: api.createdAt,
    patientIdHash: api.patientIdHash ?? undefined,
  };
}

function sessionUserToUser(s: SessionUser): User {
  const locale =
    s.locale === 'de' || s.locale?.startsWith('de')
      ? 'de'
      : s.locale === 'hi' || s.locale?.startsWith('hi')
        ? 'hi'
        : 'en';
  const name =
    s.name ??
    [s.givenName, s.familyName].filter(Boolean).join(' ').trim() ??
    s.email?.split('@')[0] ??
    'User';
  return {
    id: s.id,
    email: s.email ?? `${s.id}@unknown.local`,
    name: name || (s.email ? (s.email.split('@')[0] ?? 'User') : 'User'),
    avatarUrl: s.picture ?? null,
    locale,
    role: 'demo',
    createdAt: new Date().toISOString(),
    patientIdHash: `${s.id}-hash`,
  };
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as T | null;
  if (!res.ok || !json) {
    const err = (json as { error?: string } | null)?.error ?? `HTTP ${res.status}`;
    throw new Error(err);
  }
  return json;
}

/**
 * Mock auth provider — keeps a user in localStorage. No real backend yet.
 *
 * The shape mirrors what real providers (Supabase, Clerk, NextAuth) return,
 * so swapping the implementation later is a one-file change. The OAuth and
 * OTP entry points exist so the UI can be built against them today; they
 * resolve to the mock user when called without provider credentials.
 */

/**
 * Single-role universe (Stage 8.5). The patient/doctor split is
 * collapsed into ONE demo user — every page, every panel,
 * every developer tool is visible to whoever signs in. The `Role`
 * type stays so existing call-sites that read `user.role` keep
 * compiling, but it now has only one value: `'demo'`. Anything that
 * used to gate on role (sidebar items, dev console, Rx sign-off) just
 * always renders.
 */
export type Role = 'demo';

export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string | null;
  locale: 'en' | 'de' | 'hi';
  /** Drives sidebar visibility + page access. Defaults to "patient". */
  role: Role;
  createdAt: string;
  // Patient profile reference — links to the FHIR Patient resource
  // managed by the Profile Agent.
  patientIdHash?: string;
}

interface AuthContextValue {
  user: User | null;
  status: 'loading' | 'signed-in' | 'signed-out';
  signInWithPassword: (email: string, password: string) => Promise<void>;
  signUpWithPassword: (email: string, password: string, name: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  sendOtp: (email: string) => Promise<{ challengeId: string }>;
  verifyOtp: (challengeId: string, code: string) => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  signInAsDemo: (role: Role) => Promise<void>;
  /** Sign in as one of the seeded demo personas (T2DM · PCOS · etc).
   *  Pre-seeds the medical record + recent consults so the dashboard
   *  reads as a long-term Mörbius user, not an empty new account. */
  signInAsPersona: (personaId: string) => Promise<void>;
  signOut: () => Promise<void>;
}

/**
 * Single demo identity. Sign-in / sign-up flows that previously asked
 * the user to pick a role now just provision this one entity.
 */
export const DEMO_USERS: Record<Role, { email: string; name: string }> = {
  demo: { email: 'demo@dr-abc.local', name: 'Demo Architect' },
};

const AuthContext = createContext<AuthContextValue | null>(null);

const STORAGE_KEY = 'dr-abc:auth-user';

const VALID_ROLES: ReadonlySet<Role> = new Set(['demo']);

function readUser(): User | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<User>;
    if (!parsed || typeof parsed !== 'object' || !parsed.id || !parsed.email) return null;
    // Migrate: users persisted before the `role` field existed (or with a
    // value the current code no longer recognises) get bumped to "patient".
    // Without this guard, `routesForRole(user.role)` crashes on first
    // render for anyone who signed in on an older build.
    // Migration: any prior role ('patient' / 'doctor') collapses to 'demo'
    // since the role surface no longer exists.
    const role: Role = parsed.role && VALID_ROLES.has(parsed.role) ? parsed.role : 'demo';
    return {
      id: parsed.id,
      email: parsed.email,
      name: parsed.name ?? parsed.email.split('@')[0] ?? 'User',
      avatarUrl: parsed.avatarUrl ?? null,
      locale: parsed.locale ?? 'en',
      role,
      createdAt: parsed.createdAt ?? new Date().toISOString(),
      patientIdHash: parsed.patientIdHash,
    };
  } catch {
    return null;
  }
}

function writeUser(u: User | null) {
  if (typeof window === 'undefined') return;
  if (u) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(u));
  else window.localStorage.removeItem(STORAGE_KEY);
}

function makeMockUser(email: string, name?: string, _role: Role = 'demo'): User {
  return {
    id: `usr_${crypto.randomUUID()}`,
    email,
    name: name ?? email.split('@')[0] ?? 'Architect',
    avatarUrl: null,
    locale: 'en',
    role: 'demo',
    createdAt: new Date().toISOString(),
    patientIdHash: 'demo-hash-architect',
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthContextValue['status']>('loading');

  useEffect(() => {
    // 1. Hydrate immediately from localStorage so navigation feels
    //    instant on refresh.
    const local = readUser();
    if (local) {
      setUser(local);
      setStatus('signed-in');
    }
    // 2. Then validate the session cookie against the API. Try the
    //    new /auth/session/me first (returns the Google profile if
    //    the user signed in via OAuth) and fall back to the legacy
    //    /auth/me for the password-auth path. If the server returns
    //    a fresh profile, that wins over the localStorage copy.
    (async () => {
      try {
        const sessionRes = await fetch(`${API_BASE}/auth/session/me`, {
          credentials: 'include',
        });
        if (sessionRes.ok) {
          const j = (await sessionRes.json()) as { user: SessionUser | null };
          if (j.user && (j.user.email || j.user.name)) {
            const u = sessionUserToUser(j.user);
            writeUser(u);
            setUser(u);
            setStatus('signed-in');
            return;
          }
        }
      } catch {
        // session endpoint unreachable — fall through to legacy /auth/me
      }

      try {
        const r = await fetch(`${API_BASE}/auth/me`, { credentials: 'include' });
        if (r.ok) {
          const j = (await r.json()) as ApiAuthResponse;
          if (j.user) {
            const u = apiUserToUser(j.user);
            writeUser(u);
            setUser(u);
            setStatus('signed-in');
            return;
          }
        }
      } catch {
        // legacy endpoint unreachable too — keep local mirror if any
      }

      if (!local) setStatus('signed-out');
    })();
  }, []);

  const persist = useCallback((u: User | null) => {
    writeUser(u);
    setUser(u);
    setStatus(u ? 'signed-in' : 'signed-out');
  }, []);

  // Memory starts empty and grows from real consults. The 15-case
  // canned seed no longer fires on sign-in — Mörbius begins with no
  // seeded memory and accumulates patterns from real consults. The
  // Reset Memory button on the consult page wipes any leftover seed
  // from prior sessions.

  const value: AuthContextValue = {
    user,
    status,
    signInWithPassword: async (email, password) => {
      const j = await postJson<ApiAuthResponse>('/auth/signin', { email, password });
      if (!j.user) throw new Error(j.error ?? 'sign in failed');
      persist(apiUserToUser(j.user));
    },
    signUpWithPassword: async (email, password, name) => {
      const j = await postJson<ApiAuthResponse>('/auth/signup', { email, password, name });
      if (!j.user) throw new Error(j.error ?? 'sign up failed');
      persist(apiUserToUser(j.user));
    },
    signInWithGoogle: async () => {
      // Real Google OAuth redirect — the API server's /auth/google/start
      // builds the consent URL and 302s the browser to accounts.google.com.
      // After the user consents, Google bounces back to
      // /auth/google/callback, which mints a Mörbius session cookie and
      // redirects to /app?google=ok. The AuthProvider's hydration on
      // /app then pulls the cached Google profile from /auth/session/me
      // and pre-fills name + email + avatar + locale.
      if (typeof window === 'undefined') return;
      window.location.assign(`${API_BASE}/auth/google/start`);
    },
    sendOtp: async (email) => {
      await new Promise((r) => setTimeout(r, 200));
      // Mock: return a challenge id; UI shows the next-step OTP input.
      // Real impl: POST to /api/auth/otp/start with email + magic-link or SMS gateway.
      const challengeId = `chg_${crypto.randomUUID()}`;
      window.localStorage.setItem(`dr-abc:otp:${challengeId}`, email);
      return { challengeId };
    },
    verifyOtp: async (challengeId, code) => {
      await new Promise((r) => setTimeout(r, 200));
      // Mock: any 6-digit code passes. Real impl: POST /api/auth/otp/verify.
      if (!/^\d{6}$/.test(code)) {
        throw new Error('OTP must be 6 digits');
      }
      const email = window.localStorage.getItem(`dr-abc:otp:${challengeId}`);
      if (!email) throw new Error('OTP challenge not found');
      window.localStorage.removeItem(`dr-abc:otp:${challengeId}`);
      persist(makeMockUser(email));
    },
    requestPasswordReset: async (_email) => {
      await new Promise((r) => setTimeout(r, 250));
      // Mock: always succeeds. UI shows a "check your email" notice.
    },
    signInAsDemo: async (role) => {
      await new Promise((r) => setTimeout(r, 100));
      const d = DEMO_USERS[role];
      persist(makeMockUser(d.email, d.name, role));
    },
    signInAsPersona: async (personaId) => {
      // Note: these were previously dynamic imports for code-splitting,
      // but every consumer (/login, /sidebar, /clinic, /scribe, etc.)
      // already imports them statically — Vite couldn't move them into
      // a separate chunk and warned on every build. Static is honest.
      const p = findPersona(personaId);
      if (!p) throw new Error(`Unknown persona: ${personaId}`);
      // Stable user id keyed off the persona so re-login as the same
      // persona shows the same persisted record + consult history.
      const uid = `usr_demo_${p.id}`;
      const u: User = {
        id: uid,
        email: p.email,
        name: p.record.preferredName ?? p.record.fullName,
        avatarUrl: null,
        locale: 'en',
        role: 'demo',
        createdAt: new Date().toISOString(),
        patientIdHash: `demo-${p.id}-hash`,
      };
      // Save the medical record under the persona's user id (idempotent
      // overwrite — re-login refreshes the seeded data).
      saveRecord({ ...p.record, userId: uid, updatedAt: Date.now() });
      // Auto-pick the persona's recommended voice preset so the
      // first thing the reviewer hears matches the patient's profile
      // (Felix → Daniel calm baritone, Zoe → Nova bright encouraging).
      // The user can override anytime via the global voice picker.
      if (p.recommendedVoicePreset) {
        try {
          writeVoicePreset(p.recommendedVoicePreset);
        } catch {
          // localStorage failure — non-fatal.
        }
      }
      // Persist the seeded vitals + chief complaint in a side-channel
      // localStorage key so /app/clinic + /app/scribe can pre-fill the
      // left-panel form on first mount. Demo patients arrive in the
      // room WITH vitals already taken, not as an empty form to type
      // into.
      try {
        window.localStorage.setItem(
          `dr-abc:persona-seed:${uid}`,
          JSON.stringify({
            vitals: p.seededVitals,
            chiefComplaint: p.seededChiefComplaint,
            personaId: p.id,
            seededAt: Date.now(),
          }),
        );
      } catch {
        // Quota or serialisation error — non-fatal.
      }
      // Seed the recent-consults history with the canned entries.
      const now = Date.now();
      for (const c of p.seededConsults) {
        appendConsult(uid, {
          id: c.id,
          startedAt: now - c.daysAgo * 24 * 60 * 60 * 1000,
          complaint: c.complaint,
          topCondition: c.topCondition,
          topProb: c.topProb,
          specialty: c.specialty,
          modelUsed: c.modelUsed,
          prescriptionIssued: c.prescriptionIssued,
          elapsedSec: c.elapsedSec,
        });
      }
      persist(u);
    },
    signOut: async () => {
      // Tell the server first so the cookie / DB session both clear.
      // Local mirror clears regardless of network outcome.
      await fetch(`${API_BASE}/auth/signout`, {
        method: 'POST',
        credentials: 'include',
      }).catch(() => {
        /* offline · still drop the local mirror */
      });
      persist(null);
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
