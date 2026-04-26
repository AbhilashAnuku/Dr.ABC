/**
 * Auth routes — sign-up · sign-in · sign-out · me.
 *
 * Hono sub-router mounted at `/auth`. Uses:
 *   - Argon2id via `Bun.password` for password hashing.
 *   - Opaque crypto-random 32-byte session tokens.
 *   - HTTP-only, SameSite=Lax cookies (Secure flag in production).
 *   - 30-day session lifetime, refreshed on each authenticated request.
 *
 * On sign-up + sign-in the response sets the session cookie AND echoes
 * the user as JSON (so the web client can hydrate without a follow-up
 * GET /auth/me round-trip).
 *
 * Brute-force defense: every failed sign-in incurs the argon2id verify
 * cost (~50 ms), which already throttles credential stuffing. Rate-
 * limit middleware can be added at the Hono `app.use('/auth/*', ...)`
 * layer if we ever see spikes.
 */

import { type Context, Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { type AuthStore, pickAuthStore } from './auth-store.ts';
import { canonEmail, hashPassword, newSessionToken, verifyPassword } from './password.ts';

const SESSION_COOKIE = 'dr_abc_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const IS_PROD = process.env.NODE_ENV === 'production';

interface SignupBody {
  email?: unknown;
  password?: unknown;
  name?: unknown;
  locale?: unknown;
}

interface SigninBody {
  email?: unknown;
  password?: unknown;
}

function badRequest(msg: string) {
  return Response.json({ ok: false, error: msg }, { status: 400 });
}

function unauthorized(msg = 'unauthorized') {
  return Response.json({ ok: false, error: msg }, { status: 401 });
}

function isValidEmail(s: unknown): s is string {
  return (
    typeof s === 'string' &&
    s.length > 3 &&
    s.length < 255 &&
    // Tight enough to reject obvious garbage, loose enough not to
    // re-fight RFC 5322 over a sign-up form.
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)
  );
}

function isValidName(s: unknown): s is string {
  return typeof s === 'string' && s.trim().length > 0 && s.trim().length < 100;
}

function userToJson(u: {
  id: string;
  email: string;
  displayName: string;
  locale: string;
  patientIdHash?: string;
  createdAt: number;
}) {
  return {
    id: u.id,
    email: u.email,
    name: u.displayName,
    locale: u.locale,
    role: 'demo' as const,
    patientIdHash: u.patientIdHash ?? null,
    createdAt: new Date(u.createdAt).toISOString(),
  };
}

export function createAuthRouter(): { router: Hono; store: AuthStore } {
  const store = pickAuthStore();
  console.log(`✓ Auth store: ${store.name}`);
  const router = new Hono();

  function setSessionCookie(c: Context, token: string) {
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      secure: IS_PROD,
      sameSite: 'Lax',
      path: '/',
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
    });
  }

  router.post('/signup', async (c) => {
    const body = (await c.req.json().catch(() => null)) as SignupBody | null;
    if (!body) return badRequest('invalid JSON');
    if (!isValidEmail(body.email)) return badRequest('invalid email');
    if (typeof body.password !== 'string') return badRequest('password required');
    if (body.password.length < 8) return badRequest('password must be at least 8 characters');
    if (!isValidName(body.name)) return badRequest('name required');
    const email = canonEmail(body.email);
    const name = (body.name as string).trim();
    const locale = typeof body.locale === 'string' ? body.locale.slice(0, 8) : 'en';

    let user: Awaited<ReturnType<typeof store.createUser>>;
    try {
      const hash = await hashPassword(body.password);
      user = await store.createUser({
        id: `usr_${crypto.randomUUID()}`,
        email,
        passwordHash: hash,
        displayName: name,
        locale,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'signup failed';
      if (/already registered/i.test(msg)) {
        return Response.json({ ok: false, error: 'email already registered' }, { status: 409 });
      }
      return badRequest(msg);
    }

    const token = newSessionToken();
    const now = Date.now();
    await store.createSession({
      token,
      userId: user.id,
      createdAt: now,
      expiresAt: now + SESSION_TTL_MS,
    });
    setSessionCookie(c, token);
    return c.json({ ok: true, user: userToJson(user) });
  });

  router.post('/signin', async (c) => {
    const body = (await c.req.json().catch(() => null)) as SigninBody | null;
    if (!body) return badRequest('invalid JSON');
    if (!isValidEmail(body.email)) return badRequest('invalid email');
    if (typeof body.password !== 'string' || body.password.length === 0) {
      return badRequest('password required');
    }
    const email = canonEmail(body.email);
    const row = await store.getUserByEmailWithHash(email);
    // Run verifyPassword even when the email is unknown so the
    // response timing doesn't reveal which emails exist (a small but
    // free defense against user-enumeration).
    const known = row !== null;
    const ok = await verifyPassword(
      body.password,
      row?.passwordHash ?? '$argon2id$v=19$m=19456,t=2,p=1$dummysalt$dummyhash',
    );
    if (!known || !ok) return unauthorized('invalid email or password');

    const token = newSessionToken();
    const now = Date.now();
    await store.createSession({
      token,
      userId: row.user.id,
      createdAt: now,
      expiresAt: now + SESSION_TTL_MS,
    });
    await store.touchLastSignIn(row.user.id, now);
    setSessionCookie(c, token);
    return c.json({ ok: true, user: userToJson(row.user) });
  });

  router.post('/signout', async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) await store.deleteSession(token);
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  router.get('/me', async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (!token) return unauthorized();
    const session = await store.getSession(token);
    if (!session) {
      deleteCookie(c, SESSION_COOKIE, { path: '/' });
      return unauthorized('session expired');
    }
    const user = await store.getUserById(session.userId);
    if (!user) return unauthorized('user not found');
    // Sliding-window refresh — every authenticated read extends the
    // session by another full TTL so active users don't get logged out.
    const now = Date.now();
    if (session.expiresAt - now < SESSION_TTL_MS / 2) {
      await store.createSession({
        token: session.token,
        userId: session.userId,
        createdAt: session.createdAt,
        expiresAt: now + SESSION_TTL_MS,
      });
    }
    return c.json({ ok: true, user: userToJson(user) });
  });

  return { router, store };
}
