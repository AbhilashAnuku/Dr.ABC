import {
  Bm25Retriever,
  DEFAULT_THRESHOLDS,
  EvidenceSynthAgent,
  type GauntletThresholds,
  LibraryAgent,
  MorbiusChatAgent,
  ResearchAgent,
  SEED_CORPUS,
  TriageAgent,
  ValidatorAgent,
  createDemoProfileAgent,
  fitnessSnapshotFromEnv,
  pickDiagnosticBackend,
  pickImagingBackend,
  tryCreateDiagnosticAgent,
  tryCreateImagingAgent,
  tryCreatePgVectorRetriever,
  trySynthBackend,
} from '@dr-abc/agents';
import { AgentRegistry, Morbius, PySvcClient, type TranslateLang } from '@dr-abc/morbius-core';
import {
  type ImagingInput,
  Intent,
  type ResearchInput,
  type SynthInput,
  type Task,
  type TaskContext,
} from '@dr-abc/types';
import { type Context, Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { streamSSE } from 'hono/streaming';
import { type ActivityEntry, pickActivitySink } from './activity-sink.ts';
import {
  issue as issueKey,
  list as listKeys,
  revoke as revokeKey,
  verify as verifyKey,
} from './api-keys.ts';
import { createAuthRouter } from './auth/auth-routes.ts';
import {
  readRoboflowConfig,
  roboflowAnalyseBase64,
  roboflowAnalyseUrl,
} from './imaging/roboflow-client.ts';
import {
  firecrawlExtract,
  firecrawlScrape,
  readFirecrawlConfig,
} from './research/firecrawl-client.ts';
import { clearOverrides, effectiveEnv, listOverrides, setOverrides } from './runtime-env.ts';

// ====== bootstrap the agent mesh ======
// Library retriever — pgvector when DATABASE_URL is set, BM25 over the
// seed corpus otherwise. The PgVectorRetriever wraps the BM25 fallback
// internally so a Postgres outage doesn't break the Library agent.
const libraryRetriever = tryCreatePgVectorRetriever(
  {
    DATABASE_URL: process.env.DATABASE_URL,
    EMBEDDINGS_URL: process.env.EMBEDDINGS_URL,
    EMBEDDINGS_MODEL: process.env.EMBEDDINGS_MODEL,
    EMBEDDINGS_TOKEN: process.env.EMBEDDINGS_TOKEN,
    EMBEDDINGS_DIM: process.env.EMBEDDINGS_DIM,
  },
  new Bm25Retriever(SEED_CORPUS),
);
console.log(`✓ Library retriever: ${libraryRetriever.name}`);

const registry = new AgentRegistry()
  .register(new TriageAgent())
  .register(new ValidatorAgent())
  // MorbiusChatAgent generates real warm-doctor replies for greetings
  // + small-talk via NVIDIA NIM (HF fallback). Triage routes here on
  // greeting-detected turns so the user never sees canned text.
  .register(new MorbiusChatAgent())
  .register(new ResearchAgent())
  .register(new LibraryAgent(libraryRetriever))
  .register(createDemoProfileAgent());

// State that the dev /dev/env-keys endpoint can rebuild on demand.
// Wrapped in mutable holders so the request handlers always read the
// latest references.
let diagnosticBackend: ReturnType<typeof pickDiagnosticBackend> = 'offline';
let imagingBackend: ReturnType<typeof pickImagingBackend> = 'offline';
let morbius = new Morbius(registry);
const researchAgent = new ResearchAgent();
let synthAgent: EvidenceSynthAgent | null = null;

/**
 * Build (or rebuild) every agent that depends on env. Called once at
 * boot and again after every successful POST /dev/env-keys so a
 * developer can rotate keys and switch backends without restarting.
 *
 * Reads from `effectiveEnv()` so runtime overrides win over `.env`.
 */
function rebuildAgents(): void {
  const env = effectiveEnv();
  // We don't unregister — AgentRegistry.register replaces by (kind, version).
  // Boot-time agents may persist across rebuilds with their original keys
  // bound; the next /orchestrate call always picks up the freshly-built
  // ones because they share the same kind.
  const diagnosticEnv = {
    ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
    ANTHROPIC_MODEL: env.ANTHROPIC_MODEL,
    NVIDIA_API_KEY: env.NVIDIA_API_KEY,
    NVIDIA_MODEL: env.NVIDIA_MODEL,
    HF_API_TOKEN: env.HF_API_TOKEN,
    HF_MODEL: env.HF_MODEL,
    OLLAMA_BASE_URL: env.OLLAMA_BASE_URL,
    OLLAMA_MODEL: env.OLLAMA_MODEL,
    // Routing overrides — MORBIUS_BACKEND single-pin / BACKEND_PRIORITY
    // comma-list. Without these, the dev-console Env tab can edit them
    // but pickDiagnosticBackend wouldn't see them.
    MORBIUS_BACKEND: env.MORBIUS_BACKEND,
    BACKEND_PRIORITY: env.BACKEND_PRIORITY,
  };
  diagnosticBackend = pickDiagnosticBackend(diagnosticEnv);
  const diagnostic = tryCreateDiagnosticAgent(diagnosticEnv);
  if (diagnostic) registry.register(diagnostic);

  const imagingEnvRebuild = {
    ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
    ANTHROPIC_VISION_MODEL: env.ANTHROPIC_VISION_MODEL,
    PY_SVC_URL: env.PY_SVC_URL,
    PY_SVC_TIMEOUT_MS: env.PY_SVC_TIMEOUT_MS,
    // Anthropic Vision is never used unless explicitly opted-in.
    // py-svc / MONAI is the sovereign default.
    MORBIUS_IMAGING: env.MORBIUS_IMAGING,
  };
  imagingBackend = pickImagingBackend(imagingEnvRebuild);
  const imaging = tryCreateImagingAgent(imagingEnvRebuild, () =>
    PySvcClient.fromEnv(env as Record<string, string | undefined>),
  );
  if (imaging) registry.register(imaging);

  const synthBackend = trySynthBackend(diagnosticEnv);
  synthAgent = synthBackend ? new EvidenceSynthAgent(synthBackend) : null;
  morbius = new Morbius(registry);
}

rebuildAgents();
console.log(
  `✓ Agents booted — diagnostic: ${diagnosticBackend} · imaging: ${imagingBackend} · synth: ${synthAgent ? 'on' : 'off'}`,
);

// Activity log sink — Postgres + Drizzle when DATABASE_URL is set,
// in-memory ring buffer otherwise. Powers the Training Cockpit's live
// feed + the cockpit's per-agent metrics rollup.
const activitySink = pickActivitySink({ DATABASE_URL: process.env.DATABASE_URL });
console.log(`✓ Activity sink: ${activitySink.name}`);

// Transcript sink — same Pg-or-memory pattern as activity-sink. Holds
// every consult turn so resume works across devices, not just within
// a single browser's localStorage. Imported lazily so the api boots
// fast even when DATABASE_URL points at a slow remote.
const { pickTranscriptSink } = await import('./transcript-sink.ts');
const transcriptSink = await pickTranscriptSink({ DATABASE_URL: process.env.DATABASE_URL });
console.log(`✓ Transcript sink: ${transcriptSink.name}`);

// ====== app ======
type Variables = {
  /** API-key owner attached by the bearer-token middleware. */
  apiKeyUser?: string;
  /** API-key id attached by the bearer-token middleware. */
  apiKeyId?: string;
};
const app = new Hono<{ Variables: Variables }>();

app.use('*', logger());
app.use(
  '*',
  cors({
    origin: ['http://localhost:5173', 'tauri://localhost', 'http://tauri.localhost'],
    allowMethods: ['GET', 'POST', 'OPTIONS', 'DELETE'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Dr-Abc-Role', 'X-Dr-Abc-User'],
    credentials: true,
  }),
);

// Auth routes — sign-up / sign-in / sign-out / me. Argon2id passwords
// via Bun.password, opaque crypto-random sessions in HTTP-only cookies,
// 30-day sliding TTL, Postgres-backed with in-memory fallback.
const { router: authRouter } = createAuthRouter();
app.route('/auth', authRouter);

// ─────────────────────────────────────────────────────────────────────
//  Roboflow + Firecrawl test surface. Thin pass-through endpoints so
//  the web client + cron jobs can verify the provisioned keys work
//  end-to-end without baking the secrets into the front-end.
// ─────────────────────────────────────────────────────────────────────

app.post('/imaging/roboflow', async (c) => {
  const cfg = readRoboflowConfig(effectiveEnv());
  if (!cfg) {
    return c.json(
      { ok: false, error: 'roboflow not configured · set ROBOFLOW_API_KEY + WORKSPACE + WORKFLOW' },
      503,
    );
  }
  const body = (await c.req.json().catch(() => null)) as {
    imageUrl?: string;
    imageBase64?: string;
  } | null;
  if (!body || (!body.imageUrl && !body.imageBase64)) {
    return c.json({ ok: false, error: 'need imageUrl or imageBase64 in body' }, 400);
  }
  try {
    const result = body.imageUrl
      ? await roboflowAnalyseUrl(cfg, body.imageUrl)
      : await roboflowAnalyseBase64(cfg, body.imageBase64 ?? '');
    return c.json({
      ok: true,
      workspace: cfg.workspace,
      workflow: cfg.workflow,
      predictionCount: result.predictions.length,
      predictions: result.predictions.slice(0, 50),
      serverLatencyMs: result.serverLatencyMs,
    });
  } catch (err) {
    return c.json(
      { ok: false, error: err instanceof Error ? err.message : 'roboflow call failed' },
      502,
    );
  }
});

app.get('/imaging/roboflow/status', (c) => {
  const cfg = readRoboflowConfig(effectiveEnv());
  return c.json({
    ok: !!cfg,
    configured: !!cfg,
    workspace: cfg?.workspace ?? null,
    workflow: cfg?.workflow ?? null,
  });
});

app.post('/research/firecrawl/scrape', async (c) => {
  const cfg = readFirecrawlConfig(effectiveEnv());
  if (!cfg) {
    return c.json({ ok: false, error: 'firecrawl not configured · set FIRECRAWL_API_KEY' }, 503);
  }
  const body = (await c.req.json().catch(() => null)) as { url?: string } | null;
  if (!body?.url) return c.json({ ok: false, error: 'url required' }, 400);
  try {
    const result = await firecrawlScrape(cfg, body.url);
    return c.json({
      ok: true,
      sourceUrl: result.sourceUrl,
      markdownChars: result.markdown.length,
      markdown: result.markdown.slice(0, 2000),
      metadata: result.metadata,
    });
  } catch (err) {
    return c.json(
      { ok: false, error: err instanceof Error ? err.message : 'firecrawl scrape failed' },
      502,
    );
  }
});

app.post('/research/firecrawl/extract', async (c) => {
  const cfg = readFirecrawlConfig(effectiveEnv());
  if (!cfg) {
    return c.json({ ok: false, error: 'firecrawl not configured' }, 503);
  }
  const body = (await c.req.json().catch(() => null)) as {
    urls?: string[];
    schema?: Record<string, unknown>;
    prompt?: string;
  } | null;
  if (!body?.urls?.length || !body.schema) {
    return c.json({ ok: false, error: 'urls and schema required' }, 400);
  }
  try {
    const rows = await firecrawlExtract(cfg, body.urls, body.schema, body.prompt);
    return c.json({ ok: true, rowCount: rows.length, rows });
  } catch (err) {
    return c.json(
      { ok: false, error: err instanceof Error ? err.message : 'firecrawl extract failed' },
      502,
    );
  }
});

app.get('/research/firecrawl/status', (c) => {
  const cfg = readFirecrawlConfig(effectiveEnv());
  return c.json({ ok: !!cfg, configured: !!cfg });
});

/**
 * Security headers. Every response gets the modern OWASP-recommended
 * security headers:
 *   · X-Content-Type-Options: nosniff (MIME sniffing protection)
 *   · X-Frame-Options: DENY (clickjacking)
 *   · Referrer-Policy: strict-origin-when-cross-origin
 *   · Permissions-Policy: limit camera/mic to same-origin
 *   · Strict-Transport-Security in production only
 * CSP is intentionally NOT enforced from this middleware — Vite dev
 * uses inline scripts that would break it. The web build sets CSP
 * via vercel.json/netlify.toml on production deploys.
 */
app.use('*', async (c, next) => {
  await next();
  c.res.headers.set('X-Content-Type-Options', 'nosniff');
  c.res.headers.set('X-Frame-Options', 'DENY');
  c.res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.res.headers.set(
    'Permissions-Policy',
    'camera=(self), microphone=(self), geolocation=(), payment=()',
  );
  if (process.env.NODE_ENV === 'production') {
    c.res.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
});

/**
 * Rate limiter · token-bucket per-IP for sensitive endpoints. In-memory
 * only — fine for single-node deploys; swap to Redis when DATABASE_URL
 * is set. Window: 60 s.
 *
 * Per-path-prefix caps:
 *   /auth/*       =  6  · brute-force / credential-stuffing defense
 *   /dev/*        = 30  · headroom for backend testing and calibration;
 *                         the role-gate already filters non-developers
 *   everything    = 60  · normal API traffic
 */
interface RateBucket {
  tokens: number;
  resetAt: number;
}
const RATE_BUCKETS = new Map<string, RateBucket>();
const RATE_WINDOW_MS = 60_000;
function rateLimit(key: string, max: number): boolean {
  const now = Date.now();
  const bucket = RATE_BUCKETS.get(key);
  if (!bucket || now > bucket.resetAt) {
    RATE_BUCKETS.set(key, { tokens: max - 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (bucket.tokens <= 0) return false;
  bucket.tokens -= 1;
  return true;
}
app.use('*', async (c, next) => {
  const ip =
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? c.req.header('x-real-ip') ?? 'local';
  const path = new URL(c.req.url).pathname;
  const limit = path.startsWith('/auth') ? 6 : path.startsWith('/dev') ? 30 : 60;
  if (!rateLimit(`${ip}:${path.split('/')[1] ?? 'root'}`, limit)) {
    c.res.headers.set('Retry-After', '60');
    return c.json({ error: 'rate-limited · try again in a minute' }, 429);
  }
  return next();
});

/**
 * Mörbius API-key middleware. When an `Authorization: Bearer morbius_…`
 * header is present, validate it; on hit, attach the key meta to the
 * request via header rewrite (`X-Dr-Abc-User` + role 'doctor') so the
 * downstream activity sink + role-gated endpoints see the right caller.
 *
 * The web app continues to use the unauthenticated path (no header) for
 * the live demo; an external Postman / curl caller sends the bearer
 * token. Both succeed against /orchestrate so the demo isn't gated.
 */
app.use('*', async (c, next) => {
  const auth = c.req.header('authorization');
  if (auth?.startsWith('Bearer morbius_')) {
    const token = auth.slice('Bearer '.length);
    const meta = verifyKey(token);
    if (meta) {
      // Hono headers are immutable on the request, but we can stash on
      // the context so downstream handlers + activity-sink writes can
      // attribute the call to the API-key owner.
      c.set('apiKeyUser', meta.userId);
      c.set('apiKeyId', meta.id);
    } else {
      return c.json({ error: 'invalid or revoked api key' }, 401);
    }
  }
  await next();
});

app.get('/', async (c) => {
  // Best-effort read of the latest accuracy snapshot so a curl to the
  // root URL shows live numbers, not just the agent roster. Reads from
  // disk via dynamic import + node fs so the cold path is cheap and
  // the response never blocks on the harness being down.
  let accuracy: {
    medqaUsmle200CascadePct?: number;
    medmcqa100CascadePct?: number;
    gauntletPassPct?: number;
    topConditionPct?: number;
    kgNodes?: number;
    kgEdges?: number;
    snapshotAt?: string;
  } = {};
  try {
    const { readFile, access } = await import('node:fs/promises');
    const { join, resolve, dirname } = await import('node:path');
    // The API runs from apps/api/ (per package.json dev script), so
    // process.cwd() resolves there. Walk up until we hit a directory
    // that contains docs/status — that's the repo root. Cached after
    // first resolution.
    let statusDir: string | null = null;
    const candidates = [
      resolve(process.cwd(), 'docs/status'),
      resolve(process.cwd(), '../../docs/status'),
      resolve(process.cwd(), '../docs/status'),
      resolve(dirname(import.meta.url.replace(/^file:\/\/\/?/, '')), '../../../docs/status'),
    ];
    for (const candidate of candidates) {
      try {
        await access(candidate);
        statusDir = candidate;
        break;
      } catch {
        /* try next */
      }
    }
    if (!statusDir) throw new Error('docs/status not found');
    const safeRead = async (p: string) => {
      try {
        return JSON.parse(await readFile(join(statusDir, p), 'utf8')) as Record<string, unknown>;
      } catch {
        return null;
      }
    };
    const live = (await safeRead('live-accuracy.json')) as {
      ts?: string;
      metrics?: { gauntletPassRate?: number; topConditionRate?: number };
    } | null;
    const usmle = (await safeRead('medqa-usmle200-cascade-2026-05-03.json')) as {
      metrics?: { accuracy?: number };
    } | null;
    const medmcqa = (await safeRead('medqa-medmcqa100-cascade-2026-05-03.json')) as {
      metrics?: { accuracy?: number };
    } | null;
    const graph = (await safeRead('medical-graph.json')) as {
      nodes?: unknown[];
      edges?: unknown[];
    } | null;
    accuracy = {
      medqaUsmle200CascadePct:
        typeof usmle?.metrics?.accuracy === 'number'
          ? Math.round(usmle.metrics.accuracy * 1000) / 10
          : undefined,
      medmcqa100CascadePct:
        typeof medmcqa?.metrics?.accuracy === 'number'
          ? Math.round(medmcqa.metrics.accuracy * 1000) / 10
          : undefined,
      gauntletPassPct:
        typeof live?.metrics?.gauntletPassRate === 'number'
          ? Math.round(live.metrics.gauntletPassRate * 1000) / 10
          : undefined,
      topConditionPct:
        typeof live?.metrics?.topConditionRate === 'number'
          ? Math.round(live.metrics.topConditionRate * 1000) / 10
          : undefined,
      kgNodes: Array.isArray(graph?.nodes) ? graph.nodes.length : undefined,
      kgEdges: Array.isArray(graph?.edges) ? graph.edges.length : undefined,
      snapshotAt: typeof live?.ts === 'string' ? live.ts : undefined,
    };
  } catch {
    /* offline · fall through with empty accuracy */
  }
  return c.json({
    name: 'Mörbius API',
    project: 'Dr·ABC',
    subject: 'K-2472 · SRH University Stuttgart',
    version: '0.1.0',
    diagnosticBackend,
    imagingBackend,
    agents: registry.list().map((a) => ({ kind: a.kind, version: a.version })),
    accuracy,
  });
});

/**
 * GET /agents — formal "what can this brain do today" introspection.
 * Different from `/` (which is a thin name+version+agents tuple) and
 * from `/health/full` (which is reachability + latency). This returns
 * the full agent roster with each agent's `kind`, `version`,
 * `minConfidence`, and the canHandle-shape hint, so an external
 * integrator can see Mörbius's surface without reading the source.
 */
app.get('/agents', (c) =>
  c.json({
    ok: true,
    ts: Date.now(),
    diagnosticBackend,
    imagingBackend,
    agents: registry.list().map((a) => ({
      kind: a.kind,
      version: a.version,
      minConfidence: a.minConfidence,
    })),
    intents: ['symptom', 'imaging', 'research', 'profile', 'translate', 'synth'],
  }),
);

/**
 * Live gauntlet thresholds — start at the package defaults, mutated
 * by the calibrator (POST /dev/calibrate) once enough activity has
 * accumulated. Surfaced via /health so the dev-console Training tab
 * can render the current state.
 */
let gauntletThresholds: GauntletThresholds = { ...DEFAULT_THRESHOLDS };

app.get('/health', (c) =>
  c.json({
    ok: true,
    ts: Date.now(),
    diagnosticBackend,
    imagingBackend,
    activitySink: activitySink.name,
    agents: registry.list().map((a) => a.kind),
    gauntletThresholds,
    version: '0.4.0',
  }),
);

/**
 * GET /dev/lan-ip — auto-discover the host's LAN IPv4 addresses so the
 * mobile-share-qr can encode an URL phones can actually reach over
 * Wi-Fi (instead of the unreachable localhost).
 *
 * The QR code must encode the LAN IP rather than localhost, since a
 * phone cannot reach the host's loopback address.
 *
 * Returns the first non-internal IPv4 + the full list so the client
 * can pick. Order: external > internal. The web port is appended by
 * the client (it knows whether it's running on 5173 / 4173 / etc.).
 */
app.get('/dev/lan-ip', async (c) => {
  try {
    const { networkInterfaces } = await import('node:os');
    const ifaces = networkInterfaces();
    const candidates: { name: string; address: string; internal: boolean }[] = [];
    for (const [name, list] of Object.entries(ifaces)) {
      if (!list) continue;
      for (const i of list) {
        if (i.family === 'IPv4' || (i.family as unknown as number) === 4) {
          candidates.push({ name, address: i.address, internal: !!i.internal });
        }
      }
    }
    const external = candidates.filter((c2) => !c2.internal);
    const preferred = external[0]?.address ?? null;
    return c.json({
      ok: true,
      preferred,
      external: external.map((c2) => c2.address),
      all: candidates,
    });
  } catch (e) {
    return c.json(
      { ok: false, error: e instanceof Error ? e.message : 'lan-ip discovery failed' },
      500,
    );
  }
});

/**
 * GET /accuracy/live — the snapshot the morbius-autopilot writes after
 * every cycle. Powers the dev-console Models tab so the Mörbius row in
 * the published-benchmarks comparison shows a real-time number, not
 * the static seed baseline.
 *
 * The autopilot daemon (scripts/morbius-autopilot.ts) writes:
 *   - docs/status/live-accuracy.json         — single latest snapshot
 *   - docs/status/live-accuracy-history.json — rolling 96-point trend
 *
 * Returns 404 with `{ live: false }` when the autopilot has never run.
 */
/**
 * GET /datasets — list every Kaggle / UCI medical dataset Mörbius
 * has wired in, with the path each dataset lives at and whether the
 * file is currently present on disk. The dev console can show an
 * "Available datasets" panel showing at a glance which CSVs / image
 * folders need a `kaggle datasets download`.
 *
 * Source of truth: sample-data/datasets-index.json. Bundled CSVs
 * (heart-disease-uci) ship with the repo so they're always present;
 * larger image sets are pulled on demand.
 */
app.get('/datasets', async (c) => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const indexPath = path.resolve(process.cwd(), '../../sample-data/datasets-index.json');
  try {
    const text = await fs.readFile(indexPath, 'utf8');
    const idx = JSON.parse(text) as {
      version: string;
      sources: Array<{ id: string; path: string; bundled: boolean; [k: string]: unknown }>;
    };
    const sources = await Promise.all(
      idx.sources.map(async (s) => {
        const full = path.resolve(process.cwd(), '../../', s.path);
        let exists = false;
        try {
          await fs.access(full);
          exists = true;
        } catch {
          // missing on disk
        }
        return { ...s, exists };
      }),
    );
    return c.json({ ok: true, version: idx.version, sources });
  } catch (e) {
    return c.json(
      { ok: false, error: e instanceof Error ? e.message : 'datasets index unavailable' },
      500,
    );
  }
});

/**
 * GET /pubmed/case?term=<query> — fetch a real published clinical
 * case report from PubMed Central via NCBI E-utilities (free, no key
 * required). Used in the dev console to surface live medical data —
 * the platform is no longer scored only against the 15-case seed; any
 * consult can pull a live case report and ask Mörbius to
 * differential-diagnose against the published outcome.
 *
 * Two-step E-utility flow:
 *   1. esearch.fcgi?db=pmc&term=<term>+case+report&retmax=5 → PMC IDs
 *   2. esummary.fcgi?db=pmc&id=<csv> → article metadata
 *
 * Returns up to 5 candidate case reports with title, journal, year,
 * pmcid, and an openable link. Honest about rate-limit etiquette:
 * NCBI permits 3 req/sec without a key, 10/sec with one.
 */
app.get('/pubmed/case', async (c) => {
  const term = c.req.query('term') ?? 'differential diagnosis';
  const t0 = Date.now();
  try {
    const search = await fetch(
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pmc&term=${encodeURIComponent(term)}+AND+case+report%5BPublication+Type%5D&retmax=5&retmode=json`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!search.ok) return c.json({ ok: false, error: `PMC esearch HTTP ${search.status}` }, 502);
    const searchJson = (await search.json()) as { esearchresult?: { idlist?: string[] } };
    const ids = searchJson.esearchresult?.idlist ?? [];
    if (ids.length === 0) {
      return c.json({ ok: true, term, durationMs: Date.now() - t0, cases: [] });
    }
    const summary = await fetch(
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pmc&id=${ids.join(',')}&retmode=json`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!summary.ok)
      return c.json({ ok: false, error: `PMC esummary HTTP ${summary.status}` }, 502);
    const sumJson = (await summary.json()) as {
      result?: Record<string, { title?: string; pubdate?: string; fulljournalname?: string }>;
    };
    const cases = ids
      .map((id) => {
        const meta = sumJson.result?.[id];
        if (!meta) return null;
        return {
          pmcid: id,
          title: meta.title ?? '(untitled)',
          journal: meta.fulljournalname ?? '',
          year: (meta.pubdate ?? '').slice(0, 4),
          url: `https://www.ncbi.nlm.nih.gov/pmc/articles/PMC${id}/`,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    return c.json({ ok: true, term, durationMs: Date.now() - t0, cases });
  } catch (e) {
    return c.json(
      { ok: false, error: e instanceof Error ? e.message : 'pubmed fetch failed' },
      502,
    );
  }
});

/**
 * POST /audit/verify — verify an array of signed activity-log entries.
 *
 * Accepts: { entries: SignedEntry[] }
 * Returns: { ok: boolean, length?: number, brokenAt?: number, reason?: string, keyHint: string }
 *
 * The dev-console Health tab calls this to render the "audit chain
 * integrity" badge — green when the entire log chain validates,
 * amber when at least one entry was tampered, red when no signing
 * key is configured.
 *
 * Backed by `AuditSigner.verifyChain()` from @dr-abc/morbius-core.
 */
app.post('/audit/verify', async (c) => {
  const { getAuditSigner } = await import('@dr-abc/morbius-core');
  const signer = getAuditSigner();
  try {
    const body = await c.req.json<{ entries?: unknown }>();
    const entries = Array.isArray(body?.entries) ? body.entries : [];
    if (entries.length === 0) {
      return c.json({
        ok: true,
        length: 0,
        keyHint: signer.getKeyHint(),
        note: 'empty chain — vacuously valid',
      });
    }
    // biome-ignore lint/suspicious/noExplicitAny: runtime-validated by AuditSigner
    const result = await signer.verifyChain(entries as any);
    return c.json({ ...result, keyHint: signer.getKeyHint() });
  } catch (e) {
    return c.json(
      {
        ok: false,
        reason: e instanceof Error ? e.message : 'verify failed',
        keyHint: signer.getKeyHint(),
      },
      400,
    );
  }
});

/**
 * POST /audit/reset — wipe the in-memory activity log and rotate the
 * AuditSigner so the next signed write seeds a fresh chain. The
 * dashboard's "HIPAA audit chain · tampered" banner clears the moment
 * this returns. Developer-only (gated by X-Dr-Abc-Role: developer).
 */
// ─────────────────────────────────────────────────────────────────────
//  Records + Appointments persistence. In-process JSON store backed
//  by docs/status/ for durability across restarts. The client posts
//  the FHIR-shape record on every form save; the consult page fetches
//  it on mount so a patient's data survives browser clears.
// ─────────────────────────────────────────────────────────────────────

interface PersistedRecord {
  userId: string;
  fullName?: string;
  birthDate?: string;
  sex?: 'male' | 'female' | 'other';
  height?: number;
  weight?: number;
  allergies?: string[];
  conditions?: Array<{ icd10?: string; label: string; status?: string }>;
  medications?: Array<{ name: string; dose?: string; frequency?: string }>;
  insurance?: string;
  emergencyContact?: { name: string; phone: string; relation?: string };
  updatedAt: number;
}

interface PersistedAppointment {
  id: string;
  userId: string;
  date: string;
  time: string;
  doctor: string;
  reason: string;
  status: 'upcoming' | 'completed' | 'cancelled';
  createdAt: number;
}

const recordsStore = new Map<string, PersistedRecord>();
const appointmentsStore = new Map<string, PersistedAppointment[]>();

app.get('/records/:userId', (c) => {
  const userId = c.req.param('userId');
  const r = recordsStore.get(userId);
  if (!r) return c.json({ ok: false, record: null }, 404);
  return c.json({ ok: true, record: r });
});

app.post('/records/:userId', async (c) => {
  const userId = c.req.param('userId');
  const body = (await c.req.json().catch(() => null)) as Partial<PersistedRecord> | null;
  if (!body || typeof body !== 'object') {
    return c.json({ ok: false, error: 'invalid body' }, 400);
  }
  const next: PersistedRecord = {
    ...(recordsStore.get(userId) ?? {}),
    ...body,
    userId,
    updatedAt: Date.now(),
  };
  recordsStore.set(userId, next);
  return c.json({ ok: true, record: next });
});

app.get('/appointments/:userId', (c) => {
  const userId = c.req.param('userId');
  return c.json({ ok: true, appointments: appointmentsStore.get(userId) ?? [] });
});

app.post('/appointments/:userId', async (c) => {
  const userId = c.req.param('userId');
  const body = (await c.req.json().catch(() => null)) as Partial<PersistedAppointment> | null;
  if (!body || !body.date || !body.time || !body.reason) {
    return c.json({ ok: false, error: 'date, time, reason required' }, 400);
  }
  const next: PersistedAppointment = {
    id: body.id ?? crypto.randomUUID(),
    userId,
    date: body.date,
    time: body.time,
    doctor: body.doctor ?? 'Mörbius · auto-assigned',
    reason: body.reason,
    status: body.status ?? 'upcoming',
    createdAt: Date.now(),
  };
  const list = appointmentsStore.get(userId) ?? [];
  const idx = list.findIndex((a) => a.id === next.id);
  if (idx >= 0) list[idx] = next;
  else list.push(next);
  appointmentsStore.set(userId, list);
  return c.json({ ok: true, appointment: next });
});

app.delete('/appointments/:userId/:appointmentId', (c) => {
  const userId = c.req.param('userId');
  const appointmentId = c.req.param('appointmentId');
  const list = appointmentsStore.get(userId) ?? [];
  appointmentsStore.set(
    userId,
    list.filter((a) => a.id !== appointmentId),
  );
  return c.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────

app.post('/audit/reset', async (c) => {
  const denied = requireDeveloper(c);
  if (denied) return denied;
  try {
    await activitySink.clear();
    const { resetAuditSigner, getAuditSigner } = await import('@dr-abc/morbius-core');
    resetAuditSigner();
    return c.json({
      ok: true,
      cleared: true,
      keyHint: getAuditSigner().getKeyHint(),
    });
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : 'reset failed' }, 500);
  }
});

/**
 * POST /audit/sign — sign a single activity entry. Used by clients
 * that build their own activity log and want it signed before
 * persistence (the in-app activity sink already signs internally
 * when AUDIT_LOG_SIGNING_KEY is set).
 */
app.post('/audit/sign', async (c) => {
  const { getAuditSigner } = await import('@dr-abc/morbius-core');
  const signer = getAuditSigner();
  try {
    const body = await c.req.json<{
      id?: string;
      ts?: string;
      kind?: string;
      userId?: string;
      payload?: Record<string, unknown>;
    }>();
    if (!body.id || !body.ts || !body.kind || !body.userId) {
      return c.json({ error: 'id, ts, kind, userId required' }, 400);
    }
    const signed = await signer.sign({
      id: body.id,
      ts: body.ts,
      kind: body.kind,
      userId: body.userId,
      payload: body.payload ?? {},
    });
    return c.json(signed);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'sign failed' }, 500);
  }
});

/**
 * GET /knowledge-graph — Mörbius's medical knowledge graph + analysis.
 *
 * Returns the persistent graph from `docs/status/medical-graph.json`
 * (or an empty graph when no research-cycle has built one yet) plus a
 * fresh analysis pass (god nodes, clusters, surprises, suggested
 * follow-up questions).
 *
 * Powers:
 *   - Dashboard force-graph (interactive node viewer)
 *   - Dev-console Research tab "Knowledge graph" card (god nodes +
 *     learning-impact stats)
 *
 * The graphify-style continuous-learning surface: every cycle the
 * graph grows, the dev console shows the diff (∆ nodes, ∆ edges,
 * ∆ confidence-tag breakdown).
 */
app.get('/knowledge-graph', async (c) => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const { analyzeGraph } = await import('@dr-abc/agents');
  const { loadGraph } = await import('@dr-abc/agents/knowledge-graph/io');

  const graphPath = path.resolve(process.cwd(), '../../docs/status/medical-graph.json');
  const graph = await loadGraph(graphPath);
  const analysis = analyzeGraph(graph);

  // Confidence-tag breakdown for the learning-impact panel.
  const tagBreakdown = graph.edges.reduce<Record<string, number>>((acc, e) => {
    acc[e.confidence] = (acc[e.confidence] ?? 0) + 1;
    return acc;
  }, {});
  const kindBreakdown = graph.nodes.reduce<Record<string, number>>((acc, n) => {
    acc[n.kind] = (acc[n.kind] ?? 0) + 1;
    return acc;
  }, {});

  // Compare to yesterday's graph if a snapshot exists for delta display.
  let delta: { nodes: number; edges: number; sinceFile: string | null } | null = null;
  try {
    const statusDir = path.resolve(process.cwd(), '../../docs/status');
    const entries = await fs.readdir(statusDir);
    const cycles = entries
      .filter((n) => n.startsWith('research-cycle-') && n.endsWith('.json'))
      .sort()
      .reverse()
      .slice(0, 2);
    const prior = cycles[1];
    if (prior) {
      const text = await fs.readFile(path.join(statusDir, prior), 'utf8');
      const parsed = JSON.parse(text) as { graphNodes?: number; graphEdges?: number };
      if (parsed.graphNodes !== undefined && parsed.graphEdges !== undefined) {
        delta = {
          nodes: graph.nodes.length - parsed.graphNodes,
          edges: graph.edges.length - parsed.graphEdges,
          sinceFile: prior,
        };
      }
    }
  } catch {
    // no prior cycle — first run
  }

  return c.json({
    ts: Date.now(),
    updatedAt: graph.updatedAt,
    counts: {
      nodes: graph.nodes.length,
      edges: graph.edges.length,
      sources: Object.keys(graph.cache).length,
    },
    breakdown: { byKind: kindBreakdown, byConfidence: tagBreakdown },
    delta,
    analysis,
    // Trim graph to top-100 nodes by mentionCount for UI rendering.
    graph: {
      nodes: [...graph.nodes].sort((a, b) => b.mentionCount - a.mentionCount).slice(0, 100),
      edges: graph.edges
        .filter(
          (e) =>
            graph.nodes
              .slice(0, 100)
              .map((n) => n.id)
              .includes(e.source) ||
            graph.nodes
              .slice(0, 100)
              .map((n) => n.id)
              .includes(e.target),
        )
        .slice(0, 250),
    },
  });
});

/**
 * Sequential error correction — gradient-boosting arc.
 * (AGENTS.md §13.4-bis · packages/agents/src/boosting/)
 *
 * The journal is an append-only JSONL at docs/status/boosting-journal.jsonl
 * (mirrors the activity-sink pattern). Bounded ±0.3 cumulative shift,
 * 0.97/day decay, source-weighted defaults. "No kill, no sorry."
 */
async function loadBoostingJournal(): Promise<unknown[]> {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const p = path.resolve(process.cwd(), '../../docs/status/boosting-journal.jsonl');
  try {
    const text = await fs.readFile(p, 'utf8');
    const out: unknown[] = [];
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line));
      } catch {
        // skip malformed line
      }
    }
    return out;
  } catch {
    return [];
  }
}

async function appendBoostingEvent(event: unknown): Promise<void> {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const dir = path.resolve(process.cwd(), '../../docs/status');
  await fs.mkdir(dir, { recursive: true });
  const p = path.join(dir, 'boosting-journal.jsonl');
  await fs.writeFile(p, `${JSON.stringify(event)}\n`, { flag: 'a' });
}

/**
 * POST /errors — record a sequential-error-correction event.
 * Body: { complaint, predicted, actual, direction, source, magnitude?, note? }
 */
app.post('/errors', async (c) => {
  const denied = requireDeveloper(c);
  if (denied) return denied;
  const body = (await c.req.json().catch(() => null)) as {
    complaint?: string;
    predicted?: string;
    actual?: string;
    direction?: 'lift' | 'damp' | 'replace';
    source?: 'validator' | 'safety' | 'privacy' | 'architect' | 'follow-up' | 'autopilot';
    magnitude?: number;
    note?: string;
  } | null;
  if (
    !body?.complaint ||
    !body.predicted ||
    !body.direction ||
    !body.source ||
    typeof body.actual !== 'string'
  ) {
    return c.json({ error: 'complaint, predicted, actual, direction, source required' }, 400);
  }
  const { recordError } = await import('@dr-abc/agents');
  const event = await recordError({
    complaint: body.complaint,
    predicted: body.predicted,
    actual: body.actual,
    direction: body.direction,
    source: body.source,
    magnitude: body.magnitude,
    note: body.note,
  });
  await appendBoostingEvent(event);
  return c.json({ ok: true, event });
});

/**
 * GET /errors/stats — boosting-journal aggregation for the dev-console.
 */
app.get('/errors/stats', async (c) => {
  const { summariseBoostingJournal } = await import('@dr-abc/agents');
  const journal = await loadBoostingJournal();
  const stats = summariseBoostingJournal(journal as Parameters<typeof summariseBoostingJournal>[0]);
  return c.json({ ts: Date.now(), ...stats });
});

/**
 * POST /errors/boost — preview the boost that would be applied to a
 * given (complaint × differentials) pair. Used by the dev-console
 * "boosting" panel and (in v0.8) the orchestrate path's residual hook.
 *
 * Body: { complaint, differentials: [{condition, probability}] }
 */
app.post('/errors/boost', async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    complaint?: string;
    differentials?: Array<{ condition: string; probability: number }>;
  } | null;
  if (!body?.complaint || !Array.isArray(body.differentials)) {
    return c.json({ error: 'complaint + differentials[] required' }, 400);
  }
  const { applyBoost } = await import('@dr-abc/agents');
  const journal = (await loadBoostingJournal()) as Parameters<typeof applyBoost>[2];
  const boosted = await applyBoost(body.complaint, body.differentials, journal);
  return c.json({ count: journal.length, boosted });
});

/**
 * GET /reports — list every daily progress report.
 * GET /reports/:date — fetch one day's report (md + json).
 *
 * Daily reports are generated by scripts/morbius-daily-report.ts and
 * also fired automatically at the end of every nightly research-cycle.
 * Surfaces a 7-day learning trail.
 */
app.get('/reports', async (c) => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const dir = path.resolve(process.cwd(), '../../docs/reports');
  try {
    const files = await fs.readdir(dir);
    const dates = files
      .filter((n) => n.startsWith('morbius-progress-') && n.endsWith('.json'))
      .map((n) => n.replace('morbius-progress-', '').replace('.json', ''))
      .sort()
      .reverse();
    return c.json({ count: dates.length, dates });
  } catch {
    return c.json({
      count: 0,
      dates: [],
      hint: 'no reports yet — run bun run scripts/morbius-daily-report.ts',
    });
  }
});

app.get('/reports/:date', async (c) => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const date = c.req.param('date');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return c.json({ error: 'date must be YYYY-MM-DD' }, 400);
  }
  const dir = path.resolve(process.cwd(), '../../docs/reports');
  try {
    const json = JSON.parse(
      await fs.readFile(path.join(dir, `morbius-progress-${date}.json`), 'utf8'),
    );
    let markdown: string | null = null;
    try {
      markdown = await fs.readFile(path.join(dir, `morbius-progress-${date}.md`), 'utf8');
    } catch {}
    return c.json({ date, metrics: json, markdown });
  } catch {
    return c.json({ error: `no report for ${date}` }, 404);
  }
});

/**
 * GET /case-library — global case library, real records.
 *
 * Reads from F:\huggingface-cache\datasets\dr-abc\pubmed-cases.jsonl
 * (populated by `scripts/fetch-pubmed-cases.ts`) and returns a paged
 * response. Falls back to an empty list when the cache is missing so
 * the UI can render a "run the fetcher" hint rather than 500.
 *
 * Query params:
 *   ?limit=N          — page size (default 60, max 200)
 *   ?offset=N         — pagination cursor
 *   ?specialty=X      — filter by inferred specialty
 *   ?q=X              — free-text search across title + abstract
 */
app.get('/case-library', async (c) => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');

  const limit = Math.min(200, Number(c.req.query('limit') ?? '60'));
  const offset = Number(c.req.query('offset') ?? '0');
  const specialty = c.req.query('specialty')?.trim().toLowerCase() ?? '';
  const q = c.req.query('q')?.trim().toLowerCase() ?? '';

  // Mirror the path the fetcher writes to. Honour HF_HOME so a
  // custom cache-drive redirect works.
  const cacheBase = process.env.HF_HOME
    ? path.join(process.env.HF_HOME, 'datasets', 'dr-abc')
    : 'F:\\huggingface-cache\\datasets\\dr-abc';
  const filePath = path.join(cacheBase, 'pubmed-cases.jsonl');

  let raw = '';
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch {
    return c.json({
      total: 0,
      cases: [],
      hint: 'Cache empty. Run: bun run scripts/fetch-pubmed-cases.ts --limit 500',
    });
  }

  type Case = {
    pmid: string;
    title: string;
    abstract: string;
    meshTerms: string[];
    journal: string;
    year: number | null;
    doi: string | null;
    specialty: string | null;
  };

  const all: Case[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      all.push(JSON.parse(line) as Case);
    } catch {
      // skip malformed line
    }
  }

  let filtered = all;
  if (specialty) {
    filtered = filtered.filter((c) => (c.specialty ?? '').toLowerCase().includes(specialty));
  }
  if (q) {
    filtered = filtered.filter(
      (c) => c.title.toLowerCase().includes(q) || c.abstract.toLowerCase().includes(q),
    );
  }
  // Newest-first by year for stable ordering.
  filtered.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));

  const page = filtered.slice(offset, offset + limit);
  return c.json({
    total: filtered.length,
    grandTotal: all.length,
    offset,
    limit,
    cases: page,
  });
});

/**
 * POST /knowledge-graph/activate — run spreading activation over the
 * medical graph for a free-text query and return the ranked top-K
 * activated nodes plus the rendered evidence lines.
 *
 * Powers two surfaces:
 *   1. Neural-core 3D viz — the brain "lights up" the activated
 *      cluster when a complaint is in flight.
 *   2. Dev console — visualises which graph paths the diagnostic
 *      agent saw as grounding context for any given turn.
 *
 * Body shape: { query: string, topK?: number, decay?: number, maxHops?: number }
 */
app.post('/knowledge-graph/activate', async (c) => {
  const path = await import('node:path');
  const { relevantContext } = await import('@dr-abc/agents');
  const { loadGraph } = await import('@dr-abc/agents/knowledge-graph/io');

  const body = (await c.req.json().catch(() => null)) as {
    query?: string;
    topK?: number;
    decay?: number;
    maxHops?: number;
  } | null;
  if (!body?.query || typeof body.query !== 'string') {
    return c.json({ error: 'query (string) required' }, 400);
  }

  const graphPath = path.resolve(process.cwd(), '../../docs/status/medical-graph.json');
  const graph = await loadGraph(graphPath);
  const block = relevantContext(graph, body.query, {
    topK: body.topK ?? 12,
    spread: { decay: body.decay, maxHops: body.maxHops },
  });
  return c.json({
    query: body.query,
    empty: block.empty,
    lines: block.lines,
    hopsUsed: block.activation.hopsUsed,
    activated: block.activation.ranked.slice(0, body.topK ?? 12).map((r) => ({
      id: r.node.id,
      label: r.node.label,
      kind: r.node.kind,
      activation: Number(r.activation.toFixed(3)),
    })),
  });
});

/**
 * POST /knowledge-graph/seed — idempotent ingest of a list of consults
 * into the medical-graph.json. Used on first sign-in to bootstrap the
 * mesh from the 15 demo cases so neural-core renders something on
 * day 1 instead of an empty Fibonacci sphere.
 *
 * Body shape:
 *   {
 *     cases: Array<{
 *       consultId: string;
 *       complaint: string;
 *       topCondition?: string;
 *       differentials?: Array<{condition, probability, icd10?}>;
 *       specialty?: string;
 *       drugs?: string[];
 *       tests?: string[];
 *     }>;
 *   }
 *
 * Idempotent — mergeGraph keys by stable slugs + sourceHash so calling
 * this twice with the same input is a no-op. Returns the resulting
 * counts so the caller can decide whether to refetch /knowledge-graph.
 */
app.post('/knowledge-graph/seed', async (c) => {
  const path = await import('node:path');
  const { extractFromConsult, mergeGraph } = await import('@dr-abc/agents');
  const { loadGraph, saveGraph } = await import('@dr-abc/agents/knowledge-graph/io');

  const body = (await c.req.json().catch(() => null)) as {
    cases?: Array<{
      consultId: string;
      complaint: string;
      topCondition?: string;
      differentials?: Array<{ condition: string; probability: number; icd10?: string }>;
      specialty?: string;
      drugs?: string[];
      tests?: string[];
    }>;
  } | null;
  if (!body?.cases?.length) {
    return c.json({ error: 'expected { cases: [...] }' }, 400);
  }

  const graphPath = path.resolve(process.cwd(), '../../docs/status/medical-graph.json');
  const graph = await loadGraph(graphPath);
  let merged = 0;
  for (const caseInput of body.cases) {
    const ext = await extractFromConsult(caseInput);
    if (mergeGraph(graph, ext)) merged += 1;
  }
  await saveGraph(graphPath, graph);
  return c.json({
    merged,
    counts: {
      nodes: graph.nodes.length,
      edges: graph.edges.length,
      sources: Object.keys(graph.cache).length,
    },
  });
});

/**
 * Auth gate for the transcript endpoints. Trust model:
 *   - When the request carries a valid Bearer key (apiKeyUser is set
 *     by the middleware above), the caller's claimed userId MUST
 *     match the key's owner. Cross-user reads via someone else's
 *     userId are rejected with 403.
 *   - When no Bearer is present, this is a same-origin demo request
 *     from the web client. We allow it but pin the identity to the
 *     stated userId. A future hardening pass should require a
 *     session cookie here; for v0.7 demo mode this is sufficient
 *     because the threat model is single-user-per-browser.
 */
function authoriseUser(
  c: Context,
  claimedUserId: string,
): { ok: true } | { ok: false; status: 401 | 403; reason: string } {
  const apiKeyUser = c.get('apiKeyUser') as string | undefined;
  if (apiKeyUser && apiKeyUser !== claimedUserId) {
    return { ok: false, status: 403, reason: 'userId does not match bearer-token owner' };
  }
  return { ok: true };
}

/**
 * POST /consults/:id/messages — append one turn to a consult's
 * durable transcript. Idempotent on `id` so the web client can fire
 * the request without coordinating with localStorage.
 *
 * Body shape:
 *   { id, userId, ts, role, text, meta? }
 */
app.post('/consults/:id/messages', async (c) => {
  const consultId = c.req.param('id');
  const body = (await c.req.json().catch(() => null)) as {
    id?: string;
    userId?: string;
    ts?: number;
    role?: string;
    text?: string;
    meta?: Record<string, unknown>;
  } | null;
  if (!body?.id || !body.userId || !body.role || typeof body.text !== 'string') {
    return c.json({ error: 'id, userId, role, text required' }, 400);
  }
  const auth = authoriseUser(c, body.userId);
  if (!auth.ok) return c.json({ error: auth.reason }, auth.status);
  await transcriptSink.write({
    id: body.id,
    consultId,
    userId: body.userId,
    ts: body.ts ?? Date.now(),
    role: body.role,
    text: body.text,
    meta: body.meta,
  });
  return c.json({ ok: true, sink: transcriptSink.name });
});

/**
 * GET /consults/:id/messages?userId=… — replay a consult oldest-first.
 * Same per-user scope as POST so cross-user reads never leak.
 */
app.get('/consults/:id/messages', async (c) => {
  const consultId = c.req.param('id');
  const userId = c.req.query('userId');
  if (!userId) return c.json({ error: 'userId required' }, 400);
  const auth = authoriseUser(c, userId);
  if (!auth.ok) return c.json({ error: auth.reason }, auth.status);
  const turns = await transcriptSink.list(consultId, userId);
  return c.json({ consultId, count: turns.length, turns });
});

/**
 * GET /research/snapshot — aggregated read-only feed for the dev-console
 * Research tab. Returns the research-grade Mörbius's current state in one
 * payload so the UI doesn't have to chain four fetches:
 *
 *   - personaSummary       latest persona-harness weighted scores
 *   - liveAccuracy         the autopilot's most recent accuracy snapshot
 *   - medqa                newest medqa-*.json (overall + perModel breakdown)
 *   - cycles               every research-cycle-*.json the scheduled
 *                          training agent has written, newest-first
 *   - scheduledExperiments static manifest of the recurring jobs that
 *                          have been registered (cron + purpose)
 *   - agents               registry — kind + version of every agent on
 *                          the mesh, so the dev console can build the
 *                          per-agent analysis grid
 *
 * Each component is best-effort: a missing file → null entry, never a
 * 500. Lets the UI render whatever's available without flicker.
 */
app.get('/research/snapshot', async (c) => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const statusDir = path.resolve(process.cwd(), '../../docs/status');

  const readJson = async <T>(file: string): Promise<T | null> => {
    try {
      const text = await fs.readFile(path.join(statusDir, file), 'utf8');
      return JSON.parse(text) as T;
    } catch {
      return null;
    }
  };

  const newest = async (prefix: string): Promise<string | null> => {
    try {
      const entries = await fs.readdir(statusDir);
      const matches = entries
        .filter((n) => n.startsWith(prefix) && n.endsWith('.json'))
        .sort()
        .reverse();
      return matches[0] ?? null;
    } catch {
      return null;
    }
  };

  const [personaFile, medqaFile] = await Promise.all([
    newest('persona-summary-'),
    newest('medqa-'),
  ]);

  const personaSummary = personaFile ? await readJson<unknown>(personaFile) : null;
  const liveAccuracy = await readJson<unknown>('live-accuracy.json');
  const medqa = medqaFile ? await readJson<unknown>(medqaFile) : null;

  // Research cycles — every recurring training run writes a cycle file.
  let cycles: Array<{ file: string; data: unknown }> = [];
  try {
    const entries = await fs.readdir(statusDir);
    const cycleFiles = entries
      .filter((n) => n.startsWith('research-cycle-') && n.endsWith('.json'))
      .sort()
      .reverse()
      .slice(0, 14);
    cycles = await Promise.all(
      cycleFiles.map(async (f) => ({ file: f, data: await readJson<unknown>(f) })),
    );
  } catch {
    // no cycles yet — first run hasn't fired
  }

  // Static manifest of the recurring training/testing schedule. Mirrors
  // the cron jobs registered with CronCreate; updating either side
  // without the other will drift, so keep them in sync.
  const scheduledExperiments = [
    {
      id: 'medqa-delta-oneshot',
      cadence: 'one-shot · 24 h after v0.5.0 push',
      cron: '17 3 3 5 *',
      purpose:
        'Re-run the MedQA harness against the new /mcq endpoint and post the score delta vs the 3.3 % baseline.',
      runs: '/mcq · 80 questions · score + delta + modelUsed distribution',
    },
    {
      id: 'research-morbius-daily',
      cadence: 'daily · 04:23 local',
      cron: '23 4 * * *',
      purpose:
        'Research-grade Mörbius training + testing cycle. Runs persona + MedQA + autopilot, writes a research-cycle snapshot with deltas vs yesterday.',
      runs: 'persona-harness · medqa-harness (60 q) · autopilot --once → research-cycle-YYYY-MM-DD.json',
    },
  ];

  return c.json({
    ts: Date.now(),
    files: { personaFile, medqaFile },
    personaSummary,
    liveAccuracy,
    medqa,
    cycles,
    scheduledExperiments,
    agents: registry.list().map((a) => ({ kind: a.kind, version: a.version })),
    morbius: {
      mode: 'research',
      narrative:
        'A second Mörbius runs apart from the live consult — fed by the autopilot loop, every persona harness, MedQA, Kaggle, and PubMed. Every cycle writes a doctor-brain snapshot back into docs/status/research-cycle-*.json so the dev console can replay the training timeline.',
    },
  });
});

/**
 * GET /personas/live — surfaces the most recent persona-summary the
 * persona-harness wrote, so the Settings page can display weighted
 * scores per identity (doctor / patient / student) without re-running
 * the harness in-browser. Picks the newest persona-summary-*.json
 * under docs/status/. Returns 404 with a hint when none exist yet.
 */
app.get('/personas/live', async (c) => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const statusDir = path.resolve(process.cwd(), '../../docs/status');
  try {
    const entries = await fs.readdir(statusDir);
    const summaries = entries
      .filter((name) => /^persona-summary-\d{4}-\d{2}-\d{2}\.json$/.test(name))
      .sort()
      .reverse();
    const latest = summaries[0];
    if (!latest) {
      return c.json(
        {
          live: false,
          message:
            'No persona summary yet. Run `bun run scripts/persona-harness.ts` to generate one.',
        },
        404,
      );
    }
    const text = await fs.readFile(path.join(statusDir, latest), 'utf8');
    const parsed = JSON.parse(text);
    return c.json({ live: true, file: latest, snapshot: parsed });
  } catch (e) {
    return c.json(
      {
        live: false,
        message: e instanceof Error ? e.message : 'persona summary read failed',
      },
      500,
    );
  }
});

app.get('/accuracy/live', async (c) => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const liveFile = path.resolve(process.cwd(), '../../docs/status/live-accuracy.json');
  const historyFile = path.resolve(process.cwd(), '../../docs/status/live-accuracy-history.json');
  try {
    const liveText = await fs.readFile(liveFile, 'utf8');
    const live = JSON.parse(liveText);
    let history: unknown[] = [];
    try {
      history = JSON.parse(await fs.readFile(historyFile, 'utf8'));
    } catch {
      // history file may not exist yet — that's fine
    }
    return c.json({ live: true, snapshot: live, history });
  } catch {
    return c.json(
      {
        live: false,
        message:
          'No live accuracy snapshot yet. Run `bun run morbius:autopilot --once` to generate one.',
      },
      404,
    );
  }
});

/**
 * GET /health/full — deep system probe powering the dev-console
 * SystemFlow tab. Pings every external dependency in parallel with a
 * tight per-target timeout so the dev console shows exactly which
 * provider / container / agent is alive at any given moment.
 *
 * Each component returns:
 *   - kind:        provider · container · agent · sink · frontend
 *   - status:      'ok' | 'down' | 'skipped'
 *   - latencyMs:   round-trip time (omitted when skipped)
 *   - detail:      provider-specific note (model name, version, etc.)
 *
 * "skipped" means the component isn't configured (no key, no URL) —
 * not a failure. The UI renders skipped as amber, ok as green, down
 * as red.
 */
app.get('/health/full', async (c) => {
  const env = effectiveEnv();
  const t0 = Date.now();

  type ProbeResult = {
    component: string;
    kind: 'provider' | 'container' | 'agent' | 'sink' | 'frontend';
    status: 'ok' | 'down' | 'skipped';
    latencyMs?: number;
    detail?: string;
  };

  const probe = async (
    component: string,
    kind: ProbeResult['kind'],
    fn: () => Promise<{ ok: boolean; detail?: string }>,
    skipIf: boolean,
    skipReason?: string,
  ): Promise<ProbeResult> => {
    if (skipIf) return { component, kind, status: 'skipped', detail: skipReason };
    const started = Date.now();
    try {
      const r = await fn();
      const latencyMs = Date.now() - started;
      return { component, kind, status: r.ok ? 'ok' : 'down', latencyMs, detail: r.detail };
    } catch (e) {
      return {
        component,
        kind,
        status: 'down',
        latencyMs: Date.now() - started,
        detail: e instanceof Error ? e.message.slice(0, 120) : 'probe threw',
      };
    }
  };

  const fetchTimeout = (url: string, init?: RequestInit, ms = 2500) =>
    fetch(url, { ...init, signal: AbortSignal.timeout(ms) });

  const probes: Promise<ProbeResult>[] = [
    // ── External LLM providers ──
    probe(
      'anthropic',
      'provider',
      async () => {
        const r = await fetchTimeout('https://api.anthropic.com/v1/models', {
          headers: {
            'x-api-key': env.ANTHROPIC_API_KEY ?? '',
            'anthropic-version': '2023-06-01',
          },
        });
        return { ok: r.ok, detail: env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6' };
      },
      !env.ANTHROPIC_API_KEY,
      'no ANTHROPIC_API_KEY',
    ),
    probe(
      'nvidia-nim',
      'provider',
      async () => {
        const r = await fetchTimeout('https://integrate.api.nvidia.com/v1/models', {
          headers: { Authorization: `Bearer ${env.NVIDIA_API_KEY ?? ''}` },
        });
        return { ok: r.ok, detail: env.NVIDIA_MODEL ?? 'meta/llama-3.3-70b-instruct' };
      },
      !env.NVIDIA_API_KEY,
      'no NVIDIA_API_KEY',
    ),
    probe(
      'huggingface',
      'provider',
      async () => {
        const r = await fetchTimeout('https://huggingface.co/api/whoami-v2', {
          headers: { Authorization: `Bearer ${env.HF_API_TOKEN ?? ''}` },
        });
        return { ok: r.ok, detail: env.HF_MODEL ?? 'OpenBioLLM-8B' };
      },
      !env.HF_API_TOKEN,
      'no HF_API_TOKEN',
    ),

    // ── Local services / containers ──
    probe(
      'ollama',
      'container',
      async () => {
        const r = await fetchTimeout(`${env.OLLAMA_BASE_URL ?? 'http://localhost:11434'}/api/tags`);
        if (!r.ok) return { ok: false, detail: `HTTP ${r.status}` };
        const j = (await r.json().catch(() => ({}))) as { models?: { name: string }[] };
        const models =
          j.models
            ?.map((m) => m.name)
            .slice(0, 3)
            .join(', ') ?? 'no models pulled';
        return { ok: true, detail: models };
      },
      false,
    ),
    probe(
      'py-svc',
      'container',
      async () => {
        const url = env.PY_SVC_URL ?? 'http://localhost:8000';
        const r = await fetchTimeout(`${url}/health`);
        const text = await r.text().catch(() => '');
        return { ok: r.ok, detail: text.slice(0, 80) || `HTTP ${r.status}` };
      },
      false,
    ),
    probe(
      'postgres',
      'container',
      async () => ({
        ok: activitySink.name === 'pgvector' || activitySink.name === 'postgres',
        detail: activitySink.name,
      }),
      !env.DATABASE_URL,
      'no DATABASE_URL — using in-memory sink',
    ),

    // ── Agent mesh ──
    ...registry.list().map(
      (a) =>
        Promise.resolve({
          component: a.kind,
          kind: 'agent' as const,
          status: 'ok' as const,
          latencyMs: 0,
          detail: `v${a.version}`,
        }) satisfies Promise<ProbeResult>,
    ),

    // ── Sinks / frontend ──
    Promise.resolve({
      component: 'activity-sink',
      kind: 'sink',
      status: 'ok',
      latencyMs: 0,
      detail: activitySink.name,
    } satisfies ProbeResult),
  ];

  const results = await Promise.all(probes);
  const ok = results.filter((r) => r.status === 'ok').length;
  const down = results.filter((r) => r.status === 'down').length;
  const skipped = results.filter((r) => r.status === 'skipped').length;

  return c.json({
    ts: Date.now(),
    durationMs: Date.now() - t0,
    summary: { total: results.length, ok, down, skipped },
    diagnosticBackend,
    imagingBackend,
    components: results,
  });
});

/**
 * POST /dev/calibrate — run one calibration cycle.
 * Body: optional { stats: Record<GauntletStage, StageStats> }. When
 * absent, the server pulls a fresh stats snapshot from the activity
 * sink. Returns the new thresholds + per-stage notes.
 */
app.post('/dev/calibrate', async (c) => {
  const denied = requireDeveloper(c);
  if (denied) return denied;
  const { runCalibrationCycle, statsFromActivity } = await import('@dr-abc/agents');
  const body = await c.req.json<{ stats?: unknown }>().catch(() => ({}) as { stats?: unknown });
  let stats: ReturnType<typeof statsFromActivity>;
  if (body.stats) {
    stats = body.stats as ReturnType<typeof statsFromActivity>;
  } else {
    const entries = await activitySink.query({ limit: 1000 });
    stats = statsFromActivity(entries);
  }
  const result = runCalibrationCycle({ thresholds: gauntletThresholds, stats });
  gauntletThresholds = result.thresholds;
  return c.json({ ok: true, thresholds: gauntletThresholds, notes: result.notes });
});

app.get('/dev/calibrate', (c) => {
  return c.json({ thresholds: gauntletThresholds });
});

/**
 * POST /orchestrate
 * Body: { text: string, sessionId?: string }
 * Streams Server-Sent Events with each OrchestratorEvent as it happens.
 */
/**
 * POST /mcq — multiple-choice short-circuit path. The diagnostic
 * orchestrator emits structured *clinical conditions* (the
 * differential agent's job); MedQA-style questions ask for a
 * *management letter* (A / B / C / D). Token-overlap can't bridge
 * the two on management questions, which is why the standard
 * /orchestrate path scored 3.3 % on the MedQA harness.
 *
 * /mcq goes around the structured diagnostic agent and calls the
 * cloud LLM directly with an explicit "pick A/B/C/D" prompt. The
 * response is parsed by the same harness extractor (first-letter →
 * inline cue → option-text overlap).
 *
 * Body: { question, options: { A, B, C, D } }
 * Returns: { picked, modelUsed, raw }
 *
 * Backend selection follows the same MORBIUS_BACKEND priority as
 * the diagnostic agent. If no cloud backend is configured, returns
 * 503 with a stub note rather than fabricating an answer.
 */
/**
 * One MCQ pick — single backend, single sample. Returns the letter
 * (or null) and the raw text. v0.7-final: when `cot=true`, the
 * max-tokens budget jumps so the model can reason step-by-step
 * before committing to a letter; the letter is then extracted from
 * anywhere in the response (last "Answer: X" or final A/B/C/D found).
 */
async function mcqOnePick(
  backend: 'nvidia' | 'anthropic' | 'ollama',
  prompt: string,
  temperature: number,
  env: ReturnType<typeof effectiveEnv>,
  cot = false,
): Promise<{ letter: string | null; raw: string; modelUsed: string } | { error: string }> {
  const maxTokens = cot ? 800 : 16;

  if (backend === 'nvidia' && env.NVIDIA_API_KEY) {
    const r = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.NVIDIA_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: env.NVIDIA_MODEL ?? 'meta/llama-3.3-70b-instruct',
        messages: [{ role: 'user', content: prompt }],
        temperature,
        max_tokens: maxTokens,
      }),
      signal: AbortSignal.timeout(cot ? 60_000 : 30_000),
    });
    if (!r.ok) return { error: `nvidia:${r.status}` };
    const j = (await r.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = j.choices?.[0]?.message?.content?.trim() ?? '';
    return {
      letter: extractLetter(raw, cot),
      raw,
      modelUsed: `nvidia:${env.NVIDIA_MODEL ?? 'meta/llama-3.3-70b-instruct'}`,
    };
  }
  if (backend === 'anthropic' && env.ANTHROPIC_API_KEY) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
        max_tokens: maxTokens,
        temperature,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(cot ? 60_000 : 30_000),
    });
    if (!r.ok) return { error: `anthropic:${r.status}` };
    const j = (await r.json()) as { content?: Array<{ text?: string }> };
    const raw = j.content?.[0]?.text?.trim() ?? '';
    return {
      letter: extractLetter(raw, cot),
      raw,
      modelUsed: `anthropic:${env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6'}`,
    };
  }
  if (backend === 'ollama' && (env.OLLAMA_BASE_URL || env.OLLAMA_MODEL)) {
    const ollamaBase = env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
    // Default matches packages/agents/src/ensembles/ollama.ts and
    // synth-backend.ts: 8b is the inference fit on 16 GB hardware.
    // Override per-deploy with OLLAMA_MODEL=llama3.3:70b-instruct-q4_K_M
    // on a 64 GB+ workstation (or via F: pagefile per training guide §F).
    const ollamaModel = env.OLLAMA_MODEL ?? 'llama3.1:8b';
    const r = await fetch(`${ollamaBase}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: ollamaModel,
        messages: [{ role: 'user', content: prompt }],
        options: { temperature, num_predict: maxTokens },
        stream: false,
      }),
      signal: AbortSignal.timeout(cot ? 90_000 : 60_000),
    });
    if (!r.ok) return { error: `ollama:${r.status}` };
    const j = (await r.json()) as { message?: { content?: string } };
    const raw = j.message?.content?.trim() ?? '';
    return {
      letter: extractLetter(raw, cot),
      raw,
      modelUsed: `ollama:${ollamaModel}`,
    };
  }
  return { error: `${backend}:not-configured` };
}

/**
 * Extract the chosen letter from a model response. Single-shot path
 * expects the bare letter at line-start. CoT path scans for a final
 * "Answer: X" / "answer is X" tag, falling back to the last A/B/C/D
 * mentioned. Robust to model rambling.
 */
function extractLetter(raw: string, cot: boolean): string | null {
  if (!cot) return raw.match(/^([A-D])\b/i)?.[1]?.toUpperCase() ?? null;
  // CoT: prefer an explicit answer tag.
  const tagged = raw.match(/(?:answer\s*(?:is|:)\s*|final\s*answer\s*[:=]\s*)([A-D])\b/i);
  if (tagged?.[1]) return tagged[1].toUpperCase();
  // Fallback: last standalone A/B/C/D in the response.
  const all = [...raw.matchAll(/\b([A-D])\b/g)];
  const last = all[all.length - 1];
  return last?.[1]?.toUpperCase() ?? null;
}

app.post('/mcq', async (c) => {
  const body = await c.req
    .json<{
      question?: string;
      options?: Record<'A' | 'B' | 'C' | 'D', string>;
      samples?: number;
      temperature?: number;
      cot?: boolean;
      ensemble?: boolean;
      retrieve?: boolean;
    }>()
    .catch(() => ({}) as Record<string, never>);
  if (!body.question || !body.options) {
    return c.json({ error: 'question + options { A, B, C, D } required' }, 400);
  }
  // ── Knobs ──
  // samples=1   → single-shot (legacy) · default for harness back-compat
  // samples>=2  → Wang-2022 self-consistency · temperature 0.7 default
  // cot=true    → chain-of-thought (max_tokens up, letter extracted post-hoc)
  // ensemble=true → run NVIDIA + Anthropic in parallel and merge votes
  //               (~+3pp on hard cases, costs both providers)
  // retrieve=true → pull top-2 PubMed abstracts via NCBI E-utilities
  //               and prepend to prompt (~+3-5pp on graph-grounded cases)
  const samples = Math.max(1, Math.min(7, Number(body.samples ?? 1)));
  const cot = Boolean(body.cot);
  const ensemble = Boolean(body.ensemble);
  const retrieve = Boolean(body.retrieve);
  const temperature = Number(body.temperature ?? (samples > 1 ? 0.7 : 0.1));

  const env = effectiveEnv();

  // ── Optional retrieval — best-effort PubMed E-utilities ──
  let retrievalBlock = '';
  if (retrieve) {
    try {
      const queryHints = body.question.slice(0, 200);
      const esearch = await fetch(
        `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(queryHints)}&retmax=2&retmode=json&sort=relevance`,
        { signal: AbortSignal.timeout(8_000) },
      );
      if (esearch.ok) {
        const sj = (await esearch.json()) as { esearchresult?: { idlist?: string[] } };
        const ids = sj.esearchresult?.idlist ?? [];
        if (ids.length > 0) {
          const efetch = await fetch(
            `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${ids.join(',')}&rettype=abstract&retmode=xml`,
            { signal: AbortSignal.timeout(8_000) },
          );
          if (efetch.ok) {
            const xml = await efetch.text();
            const abs = [...xml.matchAll(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g)]
              .map((m) => (m[1] ?? '').replace(/<[^>]+>/g, '').trim())
              .filter((s) => s.length > 80)
              .slice(0, 2)
              .join('\n\n');
            if (abs) {
              retrievalBlock = `RELEVANT EVIDENCE FROM PUBMED:\n${abs.slice(0, 2400)}\n\n---\n\n`;
            }
          }
        }
      }
    } catch {
      // best-effort — quiet failure
    }
  }

  // ── Prompt ──
  const corePrompt = [
    `Q: ${body.question}`,
    '',
    `A) ${body.options.A}`,
    `B) ${body.options.B}`,
    `C) ${body.options.C}`,
    `D) ${body.options.D}`,
  ].join('\n');
  const prompt = cot
    ? [
        'You are a USMLE clinical examiner. Reason step-by-step, then commit to one letter.',
        'Format:',
        '  Reasoning: <2-4 sentences>',
        '  Answer: <A | B | C | D>',
        '',
        retrievalBlock,
        corePrompt,
      ].join('\n')
    : [
        'You are a USMLE clinical examiner. Read the case and pick exactly one letter.',
        'Reply with ONLY the letter (A, B, C, or D) on its own line. Nothing else.',
        '',
        retrievalBlock,
        corePrompt,
      ].join('\n');

  const attempts: string[] = [];
  const cascade: Array<'nvidia' | 'anthropic' | 'ollama'> = ['nvidia', 'anthropic', 'ollama'];

  // ── Ensemble path: NVIDIA + Anthropic in parallel, then vote ──
  if (ensemble && env.NVIDIA_API_KEY && env.ANTHROPIC_API_KEY) {
    const perBackend = Math.max(1, Math.ceil(samples / 2));
    const all = await Promise.all([
      ...Array.from({ length: perBackend }, () =>
        mcqOnePick('nvidia', prompt, temperature, env, cot),
      ),
      ...Array.from({ length: perBackend }, () =>
        mcqOnePick('anthropic', prompt, temperature, env, cot),
      ),
    ]);
    const votes: Record<string, number> = {};
    const rawPerSample: string[] = [];
    const modelsUsed = new Set<string>();
    for (const pick of all) {
      if ('error' in pick) {
        attempts.push(pick.error);
        continue;
      }
      const k = pick.letter ?? '?';
      votes[k] = (votes[k] ?? 0) + 1;
      rawPerSample.push(pick.raw);
      modelsUsed.add(pick.modelUsed);
    }
    let picked: string | null = null;
    let topVotes = 0;
    for (const [k, v] of Object.entries(votes)) {
      if (k === '?') continue;
      if (v > topVotes || (v === topVotes && (picked === null || k < picked))) {
        picked = k;
        topVotes = v;
      }
    }
    return c.json({
      picked,
      modelUsed: Array.from(modelsUsed).join(' + '),
      raw: rawPerSample.join(' | '),
      samples: all.length,
      temperature,
      cot,
      ensemble: true,
      retrieve,
      retrievalUsed: retrievalBlock.length > 0,
      votes,
      consensus: all.length > 0 ? topVotes / all.length : 0,
      attempts,
    });
  }

  // ── Cascade path: first reachable backend, N samples in parallel ──
  for (const backend of cascade) {
    const probe = await mcqOnePick(backend, prompt, temperature, env, cot);
    if ('error' in probe) {
      attempts.push(probe.error);
      continue;
    }
    if (samples === 1) {
      return c.json({
        picked: probe.letter,
        modelUsed: probe.modelUsed,
        raw: probe.raw,
        samples: 1,
        cot,
        ensemble: false,
        retrieve,
        retrievalUsed: retrievalBlock.length > 0,
        votes: { [probe.letter ?? '?']: 1 },
        attempts,
      });
    }
    const more = await Promise.all(
      Array.from({ length: samples - 1 }, () => mcqOnePick(backend, prompt, temperature, env, cot)),
    );
    const allPicks = [probe, ...more];
    const votes: Record<string, number> = {};
    const rawPerSample: string[] = [];
    for (const pick of allPicks) {
      if ('error' in pick) {
        attempts.push(pick.error);
        continue;
      }
      const k = pick.letter ?? '?';
      votes[k] = (votes[k] ?? 0) + 1;
      rawPerSample.push(pick.raw);
    }
    let picked: string | null = null;
    let topVotes = 0;
    for (const [k, v] of Object.entries(votes)) {
      if (k === '?') continue;
      if (v > topVotes || (v === topVotes && (picked === null || k < picked))) {
        picked = k;
        topVotes = v;
      }
    }
    return c.json({
      picked,
      modelUsed: probe.modelUsed,
      raw: rawPerSample.join(' | '),
      samples,
      temperature,
      cot,
      ensemble: false,
      retrieve,
      retrievalUsed: retrievalBlock.length > 0,
      votes,
      consensus: topVotes / samples,
      attempts,
    });
  }

  return c.json(
    {
      error:
        'every backend failed — check NVIDIA_API_KEY / ANTHROPIC_API_KEY / OLLAMA_BASE_URL in the env editor',
      attempts,
    },
    503,
  );
});

// ─────────────────────────────────────────────────────────────────────
//  /research/frontier — Discovery / Frontier-thinker mode
//
//  Frontier mode: Mörbius acts as a forward-looking research assistant,
//  taking open-ended questions (e.g. "how can I cure cancer X") and
//  surfacing candidate directions grounded in medical knowledge.
//
//  Open-ended research question → structured discovery output:
//    { hypotheses[], adjacentFields[], openQuestions[],
//      experimentsToTry[], existingEvidence[], modelUsed }
//
//  Uses the same backend cascade as /mcq (NVIDIA → Anthropic → Ollama),
//  with PubMed retrieval mandatory for grounding. Output is parsed as
//  JSON; if the model drifts, returns the raw text so the operator can
//  still read the reasoning. NOT a clinical-decision endpoint —
//  surfaces hypotheses for a human researcher to evaluate, not
//  prescriptions to act on. The Mörbius Secure Protocol disclaimer
//  is appended on every reply.
// ─────────────────────────────────────────────────────────────────────
const FRONTIER_SYSTEM_PROMPT = `You are Mörbius's Frontier Researcher mode — a senior medical scientist with broad cross-specialty knowledge. The operator asks an open-ended research question (e.g. "how could we cure pancreatic cancer", "what's the best path to early Alzheimer's detection"). Your job is to think like a researcher, not a clinician.

Reply with ONE valid JSON object, no prose around it, schema:
{
  "topic": string,
  "summary": string,                    // 2-3 sentence framing of where the field is now
  "hypotheses": [                       // 3-5 testable hypotheses, each falsifiable
    { "claim": string, "rationale": string, "boldness": "low" | "medium" | "high" }
  ],
  "adjacentFields": string[],           // 3-6 disciplines that might unlock progress
  "openQuestions": string[],            // 3-5 things we genuinely do not know yet
  "experimentsToTry": [                 // 3-5 concrete experiments / studies
    { "design": string, "endpoint": string, "feasibility": "low" | "medium" | "high" }
  ],
  "existingEvidence": [                 // 2-4 anchors from current literature
    { "claim": string, "source": string }
  ],
  "risks": string[],                    // 2-4 risks of the line of investigation
  "disclaimer": string                  // always: "Research-grade reasoning. Not a clinical recommendation. A licensed clinician must review before any patient-facing action."
}

Be bold but honest. Tag bold hypotheses as "high" boldness so the operator sees what's frontier vs what's safe. Lean on real published evidence; do not fabricate citations — when uncertain, say so in openQuestions.`;

interface FrontierResult {
  topic?: string;
  summary?: string;
  hypotheses?: Array<{ claim?: string; rationale?: string; boldness?: string }>;
  adjacentFields?: string[];
  openQuestions?: string[];
  experimentsToTry?: Array<{ design?: string; endpoint?: string; feasibility?: string }>;
  existingEvidence?: Array<{ claim?: string; source?: string }>;
  risks?: string[];
  disclaimer?: string;
}

async function frontierOnePick(
  backend: 'nvidia' | 'anthropic' | 'ollama',
  systemPrompt: string,
  userPrompt: string,
  env: ReturnType<typeof effectiveEnv>,
): Promise<{ raw: string; modelUsed: string } | { error: string }> {
  if (backend === 'nvidia' && env.NVIDIA_API_KEY) {
    const r = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.NVIDIA_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: env.NVIDIA_MODEL ?? 'meta/llama-3.3-70b-instruct',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.55,
        max_tokens: 2000,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!r.ok) return { error: `nvidia:${r.status}` };
    const j = (await r.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return {
      raw: j.choices?.[0]?.message?.content?.trim() ?? '',
      modelUsed: `nvidia:${env.NVIDIA_MODEL ?? 'meta/llama-3.3-70b-instruct'}`,
    };
  }
  if (backend === 'anthropic' && env.ANTHROPIC_API_KEY) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
        max_tokens: 2000,
        temperature: 0.55,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!r.ok) return { error: `anthropic:${r.status}` };
    const j = (await r.json()) as { content?: Array<{ text?: string }> };
    return {
      raw: j.content?.[0]?.text?.trim() ?? '',
      modelUsed: `anthropic:${env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6'}`,
    };
  }
  if (backend === 'ollama' && (env.OLLAMA_BASE_URL || env.OLLAMA_MODEL)) {
    const ollamaBase = env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
    const ollamaModel = env.OLLAMA_MODEL ?? 'llama3.1:8b';
    const r = await fetch(`${ollamaBase}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: ollamaModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        format: 'json',
        options: { temperature: 0.55, num_predict: 2000 },
        stream: false,
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!r.ok) return { error: `ollama:${r.status}` };
    const j = (await r.json()) as { message?: { content?: string } };
    return {
      raw: j.message?.content?.trim() ?? '',
      modelUsed: `ollama:${ollamaModel}`,
    };
  }
  return { error: `${backend}:not-configured` };
}

function tryParseFrontier(raw: string): FrontierResult | null {
  // Models sometimes wrap the JSON in ```json fences or add a leading
  // sentence — strip both before JSON.parse.
  const fenced = raw.match(/```(?:json)?\s*([\s\S]+?)\s*```/i)?.[1];
  const candidate = (fenced ?? raw).trim();
  // First brace through last brace; tolerant of trailing commentary.
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as FrontierResult;
  } catch {
    return null;
  }
}

app.post('/research/frontier', async (c) => {
  const body = await c.req
    .json<{ question?: string; topic?: string }>()
    .catch(() => ({}) as Record<string, never>);
  const question = (body.question ?? '').trim();
  if (!question) {
    return c.json({ error: 'question required' }, 400);
  }
  const env = effectiveEnv();

  // Best-effort PubMed grounding — the same E-utilities path /mcq uses.
  let evidenceBlock = '';
  try {
    const queryHints = (body.topic ?? question).slice(0, 220);
    const esearch = await fetch(
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(queryHints)}&retmax=4&retmode=json&sort=relevance`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (esearch.ok) {
      const sj = (await esearch.json()) as { esearchresult?: { idlist?: string[] } };
      const ids = sj.esearchresult?.idlist ?? [];
      if (ids.length > 0) {
        const efetch = await fetch(
          `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${ids.join(',')}&rettype=abstract&retmode=xml`,
          { signal: AbortSignal.timeout(10_000) },
        );
        if (efetch.ok) {
          const xml = await efetch.text();
          const abs = [...xml.matchAll(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g)]
            .map((m) => (m[1] ?? '').replace(/<[^>]+>/g, '').trim())
            .filter((s) => s.length > 80)
            .slice(0, 4)
            .join('\n\n---\n\n');
          if (abs) {
            evidenceBlock = `RELEVANT PUBMED EVIDENCE (top ${ids.length} hits):\n${abs.slice(0, 4000)}\n\n---\n\n`;
          }
        }
      }
    }
  } catch {
    // best-effort — proceed without grounding if PubMed is unreachable
  }

  const userPrompt = `${evidenceBlock}RESEARCH QUESTION: ${question}\n\nReturn the JSON object exactly per the schema above.`;
  const cascade: Array<'nvidia' | 'anthropic' | 'ollama'> = ['nvidia', 'anthropic', 'ollama'];
  const attempts: string[] = [];
  for (const backend of cascade) {
    const probe = await frontierOnePick(backend, FRONTIER_SYSTEM_PROMPT, userPrompt, env);
    if ('error' in probe) {
      attempts.push(probe.error);
      continue;
    }
    const parsed = tryParseFrontier(probe.raw);
    return c.json({
      ok: true,
      modelUsed: probe.modelUsed,
      retrievalUsed: evidenceBlock.length > 0,
      result: parsed,
      raw: parsed ? null : probe.raw, // expose raw if structured parse failed
      attempts,
    });
  }
  return c.json(
    {
      ok: false,
      error:
        'every backend failed — check NVIDIA_API_KEY / ANTHROPIC_API_KEY / OLLAMA_BASE_URL in the env editor',
      attempts,
    },
    503,
  );
});

// ─────────────────────────────────────────────────────────────────────
//  /research/rehearsal — defense pre-flight + accuracy trend
//
//  Brings the rehearsal commands (medqa, persona, push, tag) into the
//  dev console with advanced UX metrics and visualizations.
//
//  Returns:
//    - status grid: backends · git ahead-count · last build · agents
//    - medqaTrend: last N medqa-*.json runs, sorted oldest→newest
//    - personaSummary: latest persona-summary-*.json
//    - latencySamples: per-question latencies from latest medqa run
//      (raw values; the UI builds the histogram client-side)
//    - dataInventory: row + image counts on disk in data/
//    - rehearsalCommands: the exact PowerShell strings that can be
//      copied from the UI
// ─────────────────────────────────────────────────────────────────────
app.get('/research/rehearsal', async (c) => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const child = await import('node:child_process');
  const statusDir = path.resolve(process.cwd(), '../../docs/status');
  const dataDir = path.resolve(process.cwd(), '../../data');

  const readJson = async <T>(file: string): Promise<T | null> => {
    try {
      const text = await fs.readFile(path.join(statusDir, file), 'utf8');
      return JSON.parse(text) as T;
    } catch {
      return null;
    }
  };

  // ── medqa trend — load last 8 runs sorted by date ──
  type MedqaRun = {
    file: string;
    ranAt?: string;
    accuracy?: number;
    questionCount?: number;
    answeredCount?: number;
    perSpecialty?: Record<string, { count: number; correct: number; rate: number }>;
    durationMs?: number;
    perQuestion?: Array<{
      id?: string;
      specialty?: string;
      latencyMs?: number;
      correct?: boolean;
    }>;
  };
  let medqaTrend: MedqaRun[] = [];
  try {
    const entries = await fs.readdir(statusDir);
    const medqaFiles = entries
      .filter(
        (n) =>
          n.startsWith('medqa-') &&
          n.endsWith('.json') &&
          !n.includes('infra-fail') &&
          !n.includes('cot-ensemble') &&
          !n.includes('experimental'),
      )
      .sort()
      .slice(-8);
    const runs = await Promise.all(
      medqaFiles.map(async (f) => {
        const j = await readJson<{
          ranAt?: string;
          metrics?: { accuracy?: number; perSpecialty?: MedqaRun['perSpecialty'] };
          questionCount?: number;
          durationMs?: number;
          // Older runs put the per-question array under 'questions';
          // newer ones under 'results'. Try both.
          questions?: Array<{
            id?: string;
            specialty?: string;
            latencyMs?: number;
            correct?: boolean;
          }>;
          results?: Array<{
            id?: string;
            specialty?: string;
            latencyMs?: number;
            correct?: boolean;
          }>;
        }>(f);
        if (!j) return null;
        return {
          file: f,
          ranAt: j.ranAt,
          accuracy: j.metrics?.accuracy,
          questionCount: j.questionCount,
          answeredCount: j.questionCount,
          perSpecialty: j.metrics?.perSpecialty,
          durationMs: j.durationMs,
          perQuestion: (j.questions ?? j.results ?? []).slice(0, 200),
        } as MedqaRun;
      }),
    );
    medqaTrend = runs.filter((r): r is MedqaRun => r !== null);
  } catch {
    // status dir missing — first run
  }

  // ── persona summary — latest snapshot ──
  let personaFile: string | null = null;
  try {
    const entries = await fs.readdir(statusDir);
    personaFile =
      entries
        .filter((n) => n.startsWith('persona-summary-') && n.endsWith('.json'))
        .sort()
        .reverse()[0] ?? null;
  } catch {}
  const personaSummary = personaFile ? await readJson<unknown>(personaFile) : null;

  // ── git status — ahead count + branch + dirty? ──
  type GitState = { branch: string; ahead: number; dirty: boolean; lastSha?: string };
  let git: GitState | null = null;
  try {
    const repoRoot = path.resolve(process.cwd(), '../..');
    const run = (cmd: string): string =>
      child.execSync(cmd, { cwd: repoRoot, timeout: 4000, encoding: 'utf8' }).trim();
    const branch = run('git rev-parse --abbrev-ref HEAD');
    const status = run('git status --porcelain');
    const lastSha = run('git rev-parse --short HEAD');
    let ahead = 0;
    try {
      ahead = Number(run('git rev-list --count @{u}..HEAD'));
    } catch {
      // no upstream set
    }
    git = { branch, ahead, dirty: status.length > 0, lastSha };
  } catch {
    // git not available — non-fatal
  }

  // ── Data inventory — count rows + images on disk in data/ ──
  type DataInventory = {
    hfBench: Array<{ id: string; rows: number; sizeBytes: number }>;
    kaggleImaging: Array<{ id: string; files: number; sizeBytes: number }>;
    kaggleTabular: Array<{ id: string; sizeBytes: number }>;
    isicSample: { images: number; sizeBytes: number };
    totalSizeBytes: number;
  };
  const dataInventory: DataInventory = {
    hfBench: [],
    kaggleImaging: [],
    kaggleTabular: [],
    isicSample: { images: 0, sizeBytes: 0 },
    totalSizeBytes: 0,
  };
  const dirSize = async (dir: string): Promise<{ files: number; bytes: number }> => {
    let files = 0;
    let bytes = 0;
    const walk = async (d: string): Promise<void> => {
      let ents: import('node:fs').Dirent[];
      try {
        ents = await fs.readdir(d, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of ents) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) {
          await walk(p);
        } else if (e.isFile()) {
          files++;
          try {
            const st = await fs.stat(p);
            bytes += st.size;
          } catch {}
        }
      }
    };
    await walk(dir);
    return { files, bytes };
  };
  const countLines = async (file: string): Promise<number> => {
    try {
      const text = await fs.readFile(file, 'utf8');
      return text.split('\n').filter((l) => l.trim()).length;
    } catch {
      return 0;
    }
  };
  try {
    const hfDir = path.join(dataDir, 'hf-bench');
    const hfDirs = (await fs.readdir(hfDir, { withFileTypes: true })).filter((e) =>
      e.isDirectory(),
    );
    for (const dirent of hfDirs) {
      const sub = path.join(hfDir, dirent.name);
      const splits = await fs.readdir(sub).catch(() => []);
      let rows = 0;
      let bytes = 0;
      for (const split of splits) {
        if (split.endsWith('.jsonl')) {
          rows += await countLines(path.join(sub, split));
          try {
            bytes += (await fs.stat(path.join(sub, split))).size;
          } catch {}
        }
      }
      if (rows > 0) dataInventory.hfBench.push({ id: dirent.name, rows, sizeBytes: bytes });
    }
  } catch {}
  try {
    const imgDir = path.join(dataDir, 'kaggle', 'imaging');
    const imgDirs = (await fs.readdir(imgDir, { withFileTypes: true })).filter((e) =>
      e.isDirectory(),
    );
    for (const dirent of imgDirs) {
      const { files, bytes } = await dirSize(path.join(imgDir, dirent.name));
      dataInventory.kaggleImaging.push({ id: dirent.name, files, sizeBytes: bytes });
    }
  } catch {}
  try {
    const tabDir = path.join(dataDir, 'kaggle', 'tabular');
    const tabDirs = (await fs.readdir(tabDir, { withFileTypes: true })).filter((e) =>
      e.isDirectory(),
    );
    for (const dirent of tabDirs) {
      const { bytes } = await dirSize(path.join(tabDir, dirent.name));
      dataInventory.kaggleTabular.push({ id: dirent.name, sizeBytes: bytes });
    }
  } catch {}
  try {
    const isicDir = path.join(dataDir, 'isic-sample');
    const { files, bytes } = await dirSize(isicDir);
    dataInventory.isicSample = { images: files, sizeBytes: bytes };
  } catch {}
  dataInventory.totalSizeBytes =
    dataInventory.hfBench.reduce((s, r) => s + r.sizeBytes, 0) +
    dataInventory.kaggleImaging.reduce((s, r) => s + r.sizeBytes, 0) +
    dataInventory.kaggleTabular.reduce((s, r) => s + r.sizeBytes, 0) +
    dataInventory.isicSample.sizeBytes;

  // ── Rehearsal commands ──
  const rehearsalCommands = [
    {
      id: 'medqa-30',
      label: 'MedQA-30 vs cascade',
      cmd: 'bun run morbius:medqa',
      desc: 'Re-runs the seed-30 corpus against the live cascade. ~1 min. Writes docs/status/medqa-YYYY-MM-DD.json.',
      eta: '~60 s',
    },
    {
      id: 'persona',
      label: 'Persona harness',
      cmd: 'bun run morbius:persona',
      desc: 'Demographic skew check (patient · doctor · student). Writes docs/status/persona-summary-*.json.',
      eta: '~3 min',
    },
    {
      id: 'skin',
      label: 'Skin-lesion harness',
      cmd: 'bun run morbius:skin',
      desc: '20-row ISIC sample → /imaging/analyse. Writes docs/status/skin-lesion-*.json + .md.',
      eta: '~2 min',
    },
    {
      id: 'autopilot',
      label: 'Autopilot one-shot',
      cmd: 'bun run morbius:autopilot -- --once',
      desc: 'Single research cycle: persona + medqa + tune-proposals + daily report.',
      eta: '~8 min',
    },
    {
      id: 'page-audit',
      label: 'Page audit',
      cmd: 'bun run scripts/page-audit.ts',
      desc: 'Probes every web route + API endpoint. Writes docs/status/page-audit-*.json.',
      eta: '~30 s',
    },
    {
      id: 'push',
      label: 'Push to origin',
      cmd: 'git push origin feat/full-app-scaffold',
      desc: `Sync the local branch (currently ${git?.ahead ?? '?'} commits ahead of origin) to GitHub.`,
      eta: '~10 s',
    },
    {
      id: 'tag',
      label: 'Tag project-defense',
      cmd: 'git tag -a v0.7.5-project-defense -m "Defense-ready · 5 GB research corpora on disk" && git push origin v0.7.5-project-defense',
      desc: 'Annotated tag + push. Pin the defense state.',
      eta: '~10 s',
    },
  ];

  return c.json({
    ts: Date.now(),
    medqaTrend,
    personaSummary,
    git,
    dataInventory,
    rehearsalCommands,
    statusFile: { medqaFile: medqaTrend[medqaTrend.length - 1]?.file ?? null, personaFile },
  });
});

app.post('/orchestrate', async (c) => {
  let body: { text?: unknown; sessionId?: unknown };
  try {
    body = await c.req.json<{ text?: unknown; sessionId?: unknown }>();
  } catch {
    return c.json({ error: 'valid JSON body required' }, 400);
  }

  if (!body.text || typeof body.text !== 'string') {
    return c.json({ error: 'text required' }, 400);
  }

  const rawText = body.text;
  const context: TaskContext = {
    sessionId: typeof body.sessionId === 'string' ? body.sessionId : crypto.randomUUID(),
    patientIdHash: null,
    purposeOfUse: 'TREATMENT',
    consentToken: null,
    locale: c.req.header('accept-language')?.split(',')[0] ?? 'en-US',
    deviceClass: 'web',
  };

  // KG grounding — run spreading activation over the medical graph
  // and prepend the surfaced evidence so the diagnostic agent sees
  // Mörbius-specific context, not just generic priors. Best-effort:
  // if the graph is empty or the loader fails we just pass `text`
  // through unchanged.
  let groundedText = rawText;
  try {
    const path = await import('node:path');
    const { loadGraph } = await import('@dr-abc/agents/knowledge-graph/io');
    const { relevantContext } = await import('@dr-abc/agents');
    const graphPath = path.resolve(process.cwd(), '../../docs/status/medical-graph.json');
    const graph = await loadGraph(graphPath);
    if (graph.nodes.length > 0) {
      const block = relevantContext(graph, rawText, { topK: 12 });
      if (!block.empty) {
        groundedText = `KNOWN CONTEXT FROM MÖRBIUS'S BRAIN:\n${block.lines.join('\n')}\n\n---\n\n${rawText}`;
      }
    }
  } catch {
    // Graph unreachable — fall through to the raw prompt path.
  }
  const text = groundedText;

  const startedAt = Date.now();
  const seenAgents = new Set<string>();
  let firstError: string | null = null;

  return streamSSE(c, async (stream) => {
    try {
      for await (const event of morbius.orchestrate({ text, context })) {
        await stream.writeSSE({
          event: event.type,
          data: JSON.stringify(event),
        });
        // Best-effort tag of which agents fired so the activity entry
        // gives the cockpit a quick "what ran" summary without forcing
        // it to read the full event stream.
        if ('agentKind' in event && typeof event.agentKind === 'string') {
          seenAgents.add(event.agentKind);
        }
        if (event.type === 'pipeline.aborted' || event.type === 'agent.failed') {
          firstError ??=
            'reason' in event && typeof event.reason === 'string' ? event.reason : event.type;
        }
      }
      await stream.writeSSE({ event: 'done', data: '{}' });
    } catch (err) {
      firstError ??= err instanceof Error ? err.message : String(err);
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({ error: firstError }),
      });
    } finally {
      // Fire-and-forget journal entry — the activity sink will swallow
      // any DB issues so a flaky Postgres can't break /orchestrate.
      void activitySink.write({
        id: crypto.randomUUID(),
        ts: startedAt,
        role: (c.req.header('x-dr-abc-role') as ActivityEntry['role']) ?? 'system',
        userId: c.req.header('x-dr-abc-user') ?? 'anonymous',
        route: '/api/orchestrate',
        action: firstError ? 'orchestrate.failed' : 'orchestrate.completed',
        payload: {
          text: text.slice(0, 240),
          sessionId: context.sessionId,
          agents: [...seenAgents],
          ...(firstError ? { error: firstError } : {}),
        },
        latencyMs: Date.now() - startedAt,
        status: firstError ? 'error' : 'ok',
      });
    }
  });
});

/**
 * POST /research
 * Body: { query: string, sources?: ('pubmed'|'clinicaltrials'|'who')[], perSourceLimit?: number }
 * Returns ResearchOutput as JSON. Used by the chat overlay's Evidence
 * tab and the upcoming /app/console pane.
 */
app.post('/research', async (c) => {
  const body = await c.req.json<ResearchInput>();
  if (!body.query || typeof body.query !== 'string') {
    return c.json({ error: 'query required' }, 400);
  }
  const context: TaskContext = {
    sessionId: crypto.randomUUID(),
    patientIdHash: null,
    purposeOfUse: 'RESEARCH',
    consentToken: null,
    locale: c.req.header('accept-language')?.split(',')[0] ?? 'en-US',
    deviceClass: 'web',
  };
  const task: Task<ResearchInput> = {
    taskId: crypto.randomUUID(),
    parentTaskId: null,
    intent: Intent.Research,
    payload: body,
    context,
    priority: 5,
    deadlineMs: 15_000,
    trace: [],
    createdAt: Date.now(),
  };
  const result = await researchAgent.run(task, () => {});
  return c.json(result);
});

/**
 * POST /synth
 * Body: SynthInput { query, evidence[], maxTokens? }
 * Returns SynthOutput with parsed claims and citation indices. Used
 * by the chat overlay's Evidence tab to weave footnoted answers from
 * the citations returned by /research.
 */
app.post('/synth', async (c) => {
  const body = await c.req.json<SynthInput>();
  if (!body.query || !Array.isArray(body.evidence) || body.evidence.length === 0) {
    return c.json({ error: 'query and non-empty evidence array required' }, 400);
  }
  // Stub fallback when no LLM provider env is configured: instead of
  // 503-ing the chat overlay's Evidence tab, return a deterministic
  // citation-list response. The platform degrades to honest output
  // rather than failing closed.
  if (!synthAgent) {
    const stubAnswer = body.evidence
      .slice(0, 3)
      .map(
        (e, i) =>
          `[${i + 1}] ${e.title ?? 'Untitled source'}${e.summary ? ` — ${e.summary.slice(0, 180)}` : ''}`,
      )
      .join('\n\n');
    return c.json({
      answer: `LLM-backed synthesis is offline (no ANTHROPIC / NVIDIA / HF / OLLAMA env).\n\nReturning the top ${Math.min(3, body.evidence.length)} citations verbatim so the Evidence tab stays usable:\n\n${stubAnswer}`,
      claims: body.evidence.slice(0, 3).map((e, i) => ({
        text: e.summary ?? e.title ?? '',
        citationIdx: i,
      })),
      citations: body.evidence.slice(0, 3),
      stub: true,
    });
  }
  const context: TaskContext = {
    sessionId: crypto.randomUUID(),
    patientIdHash: null,
    purposeOfUse: 'RESEARCH',
    consentToken: null,
    locale: c.req.header('accept-language')?.split(',')[0] ?? 'en-US',
    deviceClass: 'web',
  };
  const task: Task<SynthInput> = {
    taskId: crypto.randomUUID(),
    parentTaskId: null,
    intent: Intent.Research,
    payload: body,
    context,
    priority: 5,
    deadlineMs: 30_000,
    trace: [],
    createdAt: Date.now(),
  };
  const result = await synthAgent.run(task, () => {});
  return c.json(result);
});

/**
 * POST /imaging
 * Body: ImagingInput { imageBase64, mimeType, modality, bodyRegion?, clinicalContext? }
 * Returns the AgentResult<ImagingOutput> directly — including the
 * base64 mask the chat overlay paints on top of the original frame.
 */

/**
 * KG fine-tune endpoints — power the dev-console panel.
 *
 *   GET  /kg/finetune/history       -> the full append-only journal (most-recent last)
 *   POST /kg/finetune/run           -> run one cycle right now, return the result
 */
app.get('/kg/finetune/history', async (c) => {
  try {
    const { readFile: rf } = await import('node:fs/promises');
    const path = await import('node:path');
    const historyPath = path.resolve(process.cwd(), '../../docs/status/kg-finetune-history.jsonl');
    const text = await rf(historyPath, 'utf8').catch(() => '');
    const cycles = text
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => {
        try {
          return JSON.parse(l) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter((x): x is Record<string, unknown> => x !== null);
    return c.json({ cycles });
  } catch (err) {
    return c.json({ cycles: [], error: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * POST /cycle/big/start fires the full training pipeline in the
 * background and returns immediately with `started: true`. The agents-
 * room card polls GET /cycle/big/last every 5 s to watch the
 * docs/status/big-cycle-last.json file fill in stage-by-stage as each
 * child process exits.
 *
 * Pipeline order: accuracy harness -> meta-agent -> KG fine-tune.
 * Total wall-clock ~2-3 minutes warm on the free NVIDIA tier.
 *
 * Rationale: spawnSync inside a Hono handler blocks the worker thread
 * for the full pipeline duration; the browser HTTP socket times out
 * around 30 s. Switching to detached `spawn` + a polled status file
 * makes the cycle observable in real time without holding open a
 * long HTTP request.
 */
type BigCycleStage = {
  name: string;
  ok: boolean | null;
  durationMs: number;
  summary: Record<string, unknown>;
  exitCode: number | null;
};

let bigCycleRunning = false;

async function decorateStageSummariesFromDisk(stages: BigCycleStage[]): Promise<void> {
  const { readFile, readdir } = await import('node:fs/promises');
  const path = await import('node:path');
  const statusDir = path.resolve(process.cwd(), '../../docs/status');
  const entries = await readdir(statusDir).catch(() => [] as string[]);

  const accs = entries.filter((n) => /^accuracy-\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort();
  const latestAcc = accs[accs.length - 1];
  const accStage = stages.find((s) => s.name === 'accuracy');
  if (latestAcc && accStage) {
    try {
      const j = JSON.parse(await readFile(path.join(statusDir, latestAcc), 'utf8'));
      accStage.summary = {
        topConditionRate: j?.metrics?.topConditionRate ?? null,
        icdPrefixRate: j?.metrics?.icdPrefixRate ?? null,
        gauntletPassRate: j?.metrics?.gauntletPassRate ?? null,
        p50LatencyMs: j?.metrics?.p50LatencyMs ?? null,
        caseCount: j?.caseCount ?? null,
        snapshot: latestAcc,
      };
    } catch {
      /* swallow */
    }
  }

  // Latest MedQA snapshot (medqa-YYYY-MM-DD.json).
  const medqas = entries.filter((n) => /^medqa-\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort();
  const latestMedqa = medqas[medqas.length - 1];
  const medqaStage = stages.find((s) => s.name === 'medqa');
  if (latestMedqa && medqaStage) {
    try {
      const j = JSON.parse(await readFile(path.join(statusDir, latestMedqa), 'utf8'));
      medqaStage.summary = {
        accuracy: j?.metrics?.accuracy ?? null,
        nonErrorAccuracy: j?.metrics?.nonErrorAccuracy ?? null,
        answeredCount: j?.metrics?.answeredCount ?? null,
        questionCount: j?.questionCount ?? null,
        snapshot: latestMedqa,
      };
    } catch {
      /* swallow */
    }
  }

  const metas = entries
    .filter((n) => /^meta-agent-2026-\d{2}-\d{2}T\d{2}-\d{2}\.json$/.test(n))
    .sort();
  const latestMeta = metas[metas.length - 1];
  const metaStage = stages.find((s) => s.name === 'meta-agent');
  if (latestMeta && metaStage) {
    try {
      const j = JSON.parse(await readFile(path.join(statusDir, latestMeta), 'utf8'));
      metaStage.summary = {
        candidateCount: j?.candidates?.length ?? 0,
        promotedCount: j?.promotedCount ?? 0,
        baseline: j?.baselineTopConditionRate ?? null,
        snapshot: latestMeta,
      };
    } catch {
      /* swallow */
    }
  }

  const kgStage = stages.find((s) => s.name === 'kg-finetune');
  if (kgStage) {
    try {
      const journal = await readFile(path.join(statusDir, 'kg-finetune-history.jsonl'), 'utf8');
      const lines = journal.split('\n').filter((l) => l.trim().length > 0);
      const last = lines[lines.length - 1];
      if (last) {
        const j = JSON.parse(last);
        kgStage.summary = {
          cycleSeq: j?.cycleSeq ?? null,
          signalsConsumed: j?.signalsConsumed ?? 0,
          edgesUpdated: j?.edgesUpdated ?? 0,
          totalAbsoluteShift: j?.totalAbsoluteShift ?? 0,
          redFlagsGuarded: j?.redFlagsGuarded ?? 0,
          decayedEdges: j?.decayedEdges ?? 0,
          topStrengthened: (j?.topStrengthened ?? []).slice(0, 5),
          topWeakened: (j?.topWeakened ?? []).slice(0, 5),
        };
      }
    } catch {
      /* swallow */
    }
  }
}

async function runBigCyclePipelineDetached(): Promise<void> {
  if (bigCycleRunning) return;
  bigCycleRunning = true;
  const { spawn } = await import('node:child_process');
  const { writeFile } = await import('node:fs/promises');
  const path = await import('node:path');
  const repoRoot = path.resolve(process.cwd(), '../..');
  const statusDir = path.resolve(repoRoot, 'docs/status');
  const reportPath = path.join(statusDir, 'big-cycle-last.json');
  const ranAt = new Date().toISOString();
  const startedMs = Date.now();
  const stages: BigCycleStage[] = [
    { name: 'accuracy', ok: null, durationMs: 0, summary: {}, exitCode: null },
    { name: 'medqa', ok: null, durationMs: 0, summary: {}, exitCode: null },
    { name: 'meta-agent', ok: null, durationMs: 0, summary: {}, exitCode: null },
    { name: 'kg-finetune', ok: null, durationMs: 0, summary: {}, exitCode: null },
  ];

  const persist = async (running: boolean): Promise<void> => {
    const r = { ranAt, durationMs: Date.now() - startedMs, running, stages };
    await writeFile(reportPath, JSON.stringify(r, null, 2)).catch(() => undefined);
  };

  const runStage = (name: string, scriptPath: string): Promise<void> =>
    new Promise((resolve) => {
      const stage = stages.find((s) => s.name === name);
      if (!stage) {
        resolve();
        return;
      }
      const t0 = Date.now();
      const child = spawn(process.execPath, ['run', scriptPath], {
        cwd: repoRoot,
        env: { ...process.env, MORBIUS_BACKEND: 'nvidia' },
      });
      let timedOut = false;
      const killer = setTimeout(() => {
        timedOut = true;
        try {
          child.kill('SIGKILL');
        } catch {
          /* swallow */
        }
      }, 270_000);
      child.on('exit', async (code) => {
        clearTimeout(killer);
        stage.ok = !timedOut && code === 0;
        stage.exitCode = code;
        stage.durationMs = Date.now() - t0;
        await decorateStageSummariesFromDisk(stages).catch(() => undefined);
        await persist(true);
        resolve();
      });
      child.on('error', async () => {
        clearTimeout(killer);
        stage.ok = false;
        stage.exitCode = null;
        stage.durationMs = Date.now() - t0;
        await persist(true);
        resolve();
      });
    });

  await persist(true);
  try {
    await runStage('accuracy', 'scripts/accuracy-harness.ts');
    await runStage('medqa', 'scripts/medqa-harness.ts');
    await runStage('meta-agent', 'scripts/morbius-meta-agent.ts');
    await runStage('kg-finetune', 'scripts/morbius-kg-finetune.ts');
    await decorateStageSummariesFromDisk(stages).catch(() => undefined);
  } finally {
    await persist(false);
    bigCycleRunning = false;
  }
}

app.post('/cycle/big/start', async (c) => {
  const role = c.req.header('X-Dr-Abc-Role') ?? 'demo';
  if (role !== 'developer') {
    return c.json({ error: 'developer role required (X-Dr-Abc-Role: developer)' }, 403);
  }
  if (bigCycleRunning) {
    return c.json({ started: false, reason: 'cycle already running — poll /cycle/big/last' });
  }
  // Fire and forget — the pipeline writes its status to disk as it runs.
  void runBigCyclePipelineDetached();
  return c.json({ started: true, pollEndpoint: '/cycle/big/last', pollEverySeconds: 5 });
});

app.get('/cycle/big/last', async (c) => {
  try {
    const { readFile } = await import('node:fs/promises');
    const path = await import('node:path');
    const fp = path.resolve(process.cwd(), '../../docs/status/big-cycle-last.json');
    const text = await readFile(fp, 'utf8');
    return c.json(JSON.parse(text));
  } catch {
    return c.json({ ranAt: null, durationMs: 0, stages: [] });
  }
});

app.post('/kg/finetune/run', async (c) => {
  // Developer-gated trigger — the dev-console panel uses this to launch
  // a cycle on demand. Same code path as the CLI runner; the script
  // module just isn't directly callable, so we shell it out.
  const role = c.req.header('X-Dr-Abc-Role') ?? 'demo';
  if (role !== 'developer') {
    return c.json({ error: 'developer role required (X-Dr-Abc-Role: developer)' }, 403);
  }
  try {
    const { spawnSync } = await import('node:child_process');
    const path = await import('node:path');
    const repoRoot = path.resolve(process.cwd(), '../..');
    const out = spawnSync(process.execPath, ['run', 'scripts/morbius-kg-finetune.ts'], {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: 90_000,
    });
    return c.json({
      ok: out.status === 0,
      exitCode: out.status,
      stdout: out.stdout,
      stderr: out.stderr,
    });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

app.post('/imaging', async (c) => {
  // Pull the latest ImagingAgent from the registry every call — that
  // way `/dev/env-keys` rebuilds (which re-register the agent) take
  // effect immediately on the next request.
  const imagingAgent = registry.list().find((a) => a.kind === 'imaging');
  if (!imagingAgent) {
    return c.json(
      { error: 'imaging backend offline — start py-svc or set ANTHROPIC_API_KEY' },
      503,
    );
  }
  const body = await c.req.json<ImagingInput>();
  if (!body.imageBase64 || !body.mimeType || !body.modality) {
    return c.json({ error: 'imageBase64, mimeType and modality required' }, 400);
  }
  const context: TaskContext = {
    sessionId: crypto.randomUUID(),
    patientIdHash: null,
    purposeOfUse: 'TREATMENT',
    consentToken: null,
    locale: c.req.header('accept-language')?.split(',')[0] ?? 'en-US',
    deviceClass: 'web',
  };
  const task: Task<ImagingInput> = {
    taskId: crypto.randomUUID(),
    parentTaskId: null,
    intent: Intent.ImageAnalysis,
    payload: body,
    context,
    priority: 4,
    deadlineMs: 45_000,
    trace: [],
    createdAt: Date.now(),
  };
  try {
    const result = await imagingAgent.run(task, () => {});
    return c.json(result);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

/**
 * POST /fitness/sync
 * Body: { token?: string }   — OAuth2 access token for Google Fit
 *
 * Returns a {@link FitnessSnapshot} for the current UTC day. If no
 * token is in the body and no GOOGLE_FIT_TOKEN env is set, returns a
 * demo snapshot (so the Profile UI is never empty).
 *
 * The token is request-scoped and never persisted server-side. Pair
 * with a browser OAuth flow on the client; see docs/guides for the
 * Google Cloud Console setup.
 */
app.post('/fitness/sync', async (c) => {
  let body: { token?: string } = {};
  try {
    body = await c.req.json<{ token?: string }>();
  } catch {
    // empty body is fine — falls through to env / demo
  }
  try {
    const snap = await fitnessSnapshotFromEnv({ token: body.token ?? null });
    return c.json(snap);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
  }
});

/**
 * Developer-only env overlay.
 *
 *   GET    /dev/env-keys   → list of currently-overridden keys (redacted)
 *   POST   /dev/env-keys   → merge body into the runtime overlay
 *   DELETE /dev/env-keys   → clear all overrides
 *
 * Gated by `X-Dr-Abc-Role: developer`. The web app always sends this
 * header on calls from /app/secrets; mock-auth posture matches the
 * rest of the alpha (real JWT verification lands with Keycloak in
 * Phase 4). Unknown keys in the body are silently dropped — see
 * runtime-env.ts.
 */
function requireDeveloper(c: {
  req: { header: (name: string) => string | undefined };
  json: (body: unknown, status?: number) => Response;
}): Response | null {
  const role = c.req.header('x-dr-abc-role');
  if (role !== 'developer') {
    return c.json({ error: 'developer role required' }, 403);
  }
  return null;
}

app.get('/dev/env-keys', (c) => {
  const denied = requireDeveloper(c);
  if (denied) return denied;
  return c.json({ overrides: listOverrides() });
});

app.post('/dev/env-keys', async (c) => {
  const denied = requireDeveloper(c);
  if (denied) return denied;
  const body = await c.req.json<Record<string, unknown>>();
  const result = setOverrides(body);
  // Hot-reload every env-dependent agent so the next /orchestrate
  // call sees the override without restarting the process.
  rebuildAgents();
  return c.json({
    ok: true,
    ...result,
    diagnosticBackend,
    imagingBackend,
  });
});

app.delete('/dev/env-keys', (c) => {
  const denied = requireDeveloper(c);
  if (denied) return denied;
  clearOverrides();
  rebuildAgents();
  return c.json({ ok: true, cleared: true, diagnosticBackend, imagingBackend });
});

/**
 * POST /dev/env-persist — write the supplied overrides into the
 * repo-root .env file AND apply them to the runtime overlay (same as
 * POST /dev/env-keys). Adds missing keys and updates existing ones in
 * place so existing comments / unrelated keys survive untouched. The
 * previous .env is backed up to .env.bak.<ts> before the rewrite.
 *
 * Body: { values: Record<string,string>, includeComments?: boolean }
 *
 * Use case: a developer tweaks ANTHROPIC_API_KEY in the dev console →
 * one click persists it so the next dev-server restart still has it,
 * AND the in-memory overlay is updated so the change takes effect on
 * the very next /orchestrate call without any restart.
 */
app.post('/dev/env-persist', async (c) => {
  const denied = requireDeveloper(c);
  if (denied) return denied;
  const body = await c.req.json<{ values: Record<string, string> }>();
  if (!body || typeof body.values !== 'object') {
    return c.json({ error: 'body.values: Record<string,string> required' }, 400);
  }

  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const envPath = path.resolve(process.cwd(), '../../.env');

  let original = '';
  try {
    original = await fs.readFile(envPath, 'utf8');
  } catch {
    // file doesn't exist yet — start with an empty buffer
  }

  // Backup before rewriting.
  const backupPath = `${envPath}.bak.${Date.now()}`;
  if (original) {
    await fs.writeFile(backupPath, original, 'utf8');
  }

  // Update each requested key in-place when present, append when not.
  const lines = original.split(/\r?\n/);
  const seen = new Set<string>();
  const next: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      next.push(line);
      continue;
    }
    const match = trimmed.match(/^([A-Z][A-Z0-9_]*)=/);
    const key = match?.[1];
    if (key && key in body.values) {
      seen.add(key);
      const value = body.values[key] ?? '';
      next.push(`${key}=${value}`);
      continue;
    }
    next.push(line);
  }
  for (const [key, value] of Object.entries(body.values)) {
    if (seen.has(key)) continue;
    next.push(`${key}=${value}`);
  }
  const rewritten = next.join('\n');
  await fs.writeFile(envPath, rewritten, 'utf8');

  // Apply to the runtime overlay too — instant effect, no restart.
  const result = setOverrides(body.values);
  rebuildAgents();

  return c.json({
    ok: true,
    persistedTo: envPath,
    backupPath: original ? backupPath : null,
    ...result,
    diagnosticBackend,
    imagingBackend,
  });
});

/**
 * POST /dev/activity
 * Body: ActivityEntry — { id?, ts?, role, userId, route, action, payload?, latencyMs?, status? }
 *
 * Web instrumentation calls this fire-and-forget on every meaningful
 * user action (consult submit, Rx signed, lab run, secret reveal). The
 * cockpit's left column tails the same sink. Developer-gated to keep
 * the surface honest about who can write to the journal.
 */
app.post('/dev/activity', async (c) => {
  const denied = requireDeveloper(c);
  if (denied) return denied;
  const body = await c.req.json<Partial<ActivityEntry>>();
  if (!body.role || !body.userId || !body.route || !body.action) {
    return c.json({ error: 'role, userId, route, action required' }, 400);
  }
  const entry: ActivityEntry = {
    id: body.id ?? crypto.randomUUID(),
    ts: body.ts ?? Date.now(),
    role: body.role,
    userId: body.userId,
    route: body.route,
    action: body.action,
    payload: body.payload,
    latencyMs: body.latencyMs,
    status: body.status ?? 'ok',
  };
  await activitySink.write(entry);
  return c.json({ ok: true, id: entry.id });
});

/**
 * GET /dev/activity?since=…&until=…&role=…&route=…&action=…&status=…&limit=…
 * Returns newest-first. Backed by the same sink as the live tail.
 */
app.get('/dev/activity', async (c) => {
  const denied = requireDeveloper(c);
  if (denied) return denied;
  const q = c.req.query();
  const entries = await activitySink.query({
    since: q.since ? Number(q.since) : undefined,
    until: q.until ? Number(q.until) : undefined,
    role: q.role as ActivityEntry['role'] | undefined,
    route: q.route,
    action: q.action,
    status: q.status as 'ok' | 'error' | undefined,
    limit: q.limit ? Math.min(1000, Number(q.limit)) : 200,
  });
  return c.json({ sink: activitySink.name, entries });
});

/**
 * GET /dev/activity/stream — SSE tail. Yields each new entry as it's
 * written to the sink. The cockpit subscribes here for the live feed.
 */
app.get('/dev/activity/stream', (c) => {
  const denied = requireDeveloper(c);
  if (denied) return denied;
  return streamSSE(c, async (stream) => {
    const ac = new AbortController();
    // Hono's stream doesn't expose abort directly; we close the loop
    // on client disconnect via the request's signal where available.
    try {
      for await (const entry of activitySink.tail({ signal: ac.signal })) {
        await stream.writeSSE({
          event: 'activity',
          data: JSON.stringify(entry),
        });
      }
    } catch (err) {
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      });
    } finally {
      ac.abort();
    }
  });
});

/**
 * POST /translate — proxy to py-svc's MarianMT pipeline.
 *
 * Body: `{ text: string, src: TranslateLang, tgt: TranslateLang }`.
 * Returns the translated text + the model id + the latency. Public to
 * any signed-in role: translation is a presentation-layer concern,
 * not a privileged operation. The py-svc router gracefully falls
 * back to a stub when the `translate` extra isn't installed, so this
 * endpoint always returns a structured response — never 500s for a
 * missing model.
 */
const SUPPORTED_LANGS: ReadonlySet<TranslateLang> = new Set(['en', 'de', 'hi', 'es', 'fr']);

app.post('/translate', async (c) => {
  const body = await c.req.json<{ text?: string; src?: string; tgt?: string }>();
  if (!body.text || typeof body.text !== 'string') {
    return c.json({ error: 'text required' }, 400);
  }
  if (
    !body.src ||
    !body.tgt ||
    !SUPPORTED_LANGS.has(body.src as TranslateLang) ||
    !SUPPORTED_LANGS.has(body.tgt as TranslateLang)
  ) {
    return c.json({ error: 'src + tgt required; supported: en | de | hi | es | fr' }, 400);
  }
  try {
    const client = PySvcClient.fromEnv();
    const result = await client.translate({
      text: body.text,
      src: body.src as TranslateLang,
      tgt: body.tgt as TranslateLang,
    });
    return c.json(result);
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : String(err), source: 'py-svc' },
      502,
    );
  }
});

/**
 * API-key surface — issue / list / revoke. Identifies the caller via
 * the `X-Dr-Abc-User` header (mock auth, matches the rest of the alpha
 * — the real Keycloak verify lands in Phase 4).
 *
 *   POST   /api-keys           { label } → { key, meta }   (key shown ONCE)
 *   GET    /api-keys                     → { keys: meta[] }
 *   DELETE /api-keys/:id                 → { ok: true }
 *
 * Once issued, callers send the key as `Authorization: Bearer morbius_…`
 * on /orchestrate, /research, /imaging — the global middleware above
 * validates + rejects unknown keys with a 401.
 */
function requireUser(c: { req: { header: (name: string) => string | undefined } }): string | null {
  const u = c.req.header('x-dr-abc-user');
  return u?.trim() ? u.trim() : null;
}

app.post('/api-keys', async (c) => {
  const userId = requireUser(c);
  if (!userId) return c.json({ error: 'X-Dr-Abc-User header required' }, 400);
  const body = await c.req.json<{ label?: string }>().catch(() => ({}) as { label?: string });
  const { key, meta } = issueKey(userId, body.label ?? 'untitled');
  return c.json({ key, meta });
});

// ════════════════════════════════════════════════════════════════════
//  AUTH SESSIONS · HttpOnly · Secure · SameSite=Lax · HMAC-SHA256 signed
//
//  Cookie-session foundation supporting login/logout, multiple users,
//  DB seed data, migrations, and security limitations. Used by the web
//  client, Postman, and any other surface.
//
//  Design choices (sovereign + zero-budget rules):
//    · No external auth library — handcrafted HMAC-SHA256 signed token
//    · Token format: base64url(`${userId}.${expiresAt}.${nonce}`).${sig}
//    · Cookie name: `dr-abc.sid` · HttpOnly · Secure (prod) · SameSite=Lax
//    · TTL: 30 days, slid forward on each /auth/session/me hit
//    · Storage: stateless · the cookie IS the session, no DB lookup
//      required (when DATABASE_URL lands, we add a revocation table)
//
//  Endpoints:
//    POST /auth/session/login   { userId, email? }  → 204 + Set-Cookie
//    GET  /auth/session/me                          → 200 { userId }
//    POST /auth/session/logout                      → 204 + clear cookie
//
//  Required env (defaulted to a dev secret — ROTATE BEFORE PROD):
//    AUTH_COOKIE_SECRET=<32-byte hex>   ← MUST be set in .env
// ════════════════════════════════════════════════════════════════════

const AUTH_COOKIE_NAME = 'dr-abc.sid';
const AUTH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const AUTH_SECRET = process.env.AUTH_COOKIE_SECRET ?? 'dev-only-rotate-me-please-1234567890abcdef';

async function hmacSha256(message: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  // base64url, no padding
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function mintSessionToken(userId: string): Promise<string> {
  const expiresAt = Date.now() + AUTH_TTL_MS;
  const nonce = crypto.randomUUID();
  const payload = btoa(`${userId}.${expiresAt}.${nonce}`)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const sig = await hmacSha256(payload, AUTH_SECRET);
  return `${payload}.${sig}`;
}

async function verifySessionToken(token: string): Promise<{ userId: string } | null> {
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = await hmacSha256(payload, AUTH_SECRET);
  // constant-time comparison
  if (sig.length !== expected.length) return null;
  let mismatch = 0;
  for (let i = 0; i < sig.length; i++) mismatch |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (mismatch !== 0) return null;
  const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
  const [userId, expiresAtStr] = decoded.split('.');
  if (!userId || !expiresAtStr) return null;
  const expiresAt = Number.parseInt(expiresAtStr, 10);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return null;
  return { userId };
}

function setSessionCookie(c: Context, token: string): void {
  setCookie(c, AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax',
    path: '/',
    maxAge: Math.floor(AUTH_TTL_MS / 1000),
  });
}

/**
 * POST /auth/session/login
 * Body: { userId: string, email?: string }
 *
 * Mints a signed cookie session for the supplied userId. v0.8 demo
 * mode — no password verification yet. The next session adds:
 *   · password hashing (argon2)
 *   · email verification
 *   · DB-backed users + sessions table with revocation
 *   · OAuth (Google) callback that lands here
 */
app.post('/auth/session/login', async (c) => {
  const body = await c.req
    .json<{ userId?: string; email?: string }>()
    .catch(() => ({}) as { userId?: string; email?: string });
  const userId = body.userId?.trim();
  if (!userId) return c.json({ error: 'userId required' }, 400);
  const token = await mintSessionToken(userId);
  setSessionCookie(c, token);
  return c.json({ ok: true, userId });
});

/**
 * GET /auth/session/me
 *
 * Returns the current authenticated user from the cookie. Sliding TTL —
 * each successful read re-issues a fresh cookie so active users stay
 * logged in indefinitely while idle ones expire after 30 days.
 */
app.get('/auth/session/me', async (c) => {
  const token = getCookie(c, AUTH_COOKIE_NAME);
  if (!token) return c.json({ user: null }, 200);
  const session = await verifySessionToken(token);
  if (!session) {
    deleteCookie(c, AUTH_COOKIE_NAME, { path: '/' });
    return c.json({ user: null }, 200);
  }
  // Slide the cookie forward
  const fresh = await mintSessionToken(session.userId);
  setSessionCookie(c, fresh);

  // If the user signed in via Google, surface the cached profile so
  // the frontend can pre-fill name / email / avatar instead of asking
  // the user to retype what Google already returned.
  const profile = GOOGLE_PROFILES.get(session.userId);
  const isGoogle = session.userId.startsWith('google:');

  return c.json(
    {
      user: {
        id: session.userId,
        provider: isGoogle ? 'google' : 'local',
        email: profile?.email,
        emailVerified: profile?.emailVerified,
        name: profile?.name,
        givenName: profile?.givenName,
        familyName: profile?.familyName,
        picture: profile?.picture,
        locale: profile?.locale,
      },
    },
    200,
  );
});

/**
 * POST /auth/session/logout
 *
 * Clears the session cookie. Stateless logout — when DB-backed sessions
 * land, this also writes the token to a revocation set.
 */
app.post('/auth/session/logout', async (c) => {
  deleteCookie(c, AUTH_COOKIE_NAME, { path: '/' });
  return c.json({ ok: true });
});

// ════════════════════════════════════════════════════════════════════
//  GOOGLE OAUTH 2.0 · server-side authorization-code flow
//
//  Enables real device connectivity. Two scopes pulled in one consent
//  screen:
//
//    1. openid + email + profile  →  Google sign-in (lands a session
//                                    cookie)
//    2. fitness.activity.read     →  Google Fit sync (steps, heart rate,
//                                    sleep, weight)
//
//  Required env (set manually in .env):
//    GOOGLE_OAUTH_CLIENT_ID=<...>.apps.googleusercontent.com
//    GOOGLE_OAUTH_CLIENT_SECRET=GOCSPX-<...>
//    GOOGLE_OAUTH_REDIRECT=http://localhost:8787/auth/google/callback
//
//  Endpoints:
//    GET /auth/google/start          → 302 to Google's consent screen
//    GET /auth/google/callback?code  → exchanges code, sets session,
//                                       persists access_token + refresh_token
//                                       in the user's row (when DB lands;
//                                       in-memory map for now), redirects to /app
// ════════════════════════════════════════════════════════════════════

const GOOGLE_OAUTH_AUTHZ = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_OAUTH_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO = 'https://www.googleapis.com/oauth2/v3/userinfo';
// Login-only scope set. The Google Advanced Protection Program on the
// account blocks any app that lists *restricted* scopes on its consent
// screen — even when the specific request only asks for
// openid/email/profile.
// Fitness scopes have been removed entirely so APP stops returning
// `Error 400: policy_enforced`. If Fit data is needed in a future
// release it ships as a separate (verified) OAuth client.
const GOOGLE_OAUTH_SCOPES_LOGIN = ['openid', 'email', 'profile'].join(' ');

interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  id_token?: string;
  scope?: string;
  token_type?: string;
}

interface GoogleUserInfo {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  locale?: string;
}

/** In-memory token store · keyed by userId · replaced with DB once
 *  packages/db schema lands a `user_oauth_tokens` table. */
const GOOGLE_TOKENS = new Map<
  string,
  { accessToken: string; refreshToken?: string; expiresAt: number; scope: string }
>();

/**
 * In-memory profile store. After Google OAuth completes, we cache the
 * user's email + name + avatar so the clinic profile / dashboard /
 * sign-up form can pre-fill instead of asking the user to retype
 * fields Google already gave us. Replaced with the user-profile DB
 * column once packages/db schema migrates the `app_user.profile_*`
 * fields. Lookup keyed by the same userId used for sessions.
 */
const GOOGLE_PROFILES = new Map<
  string,
  {
    email?: string;
    emailVerified?: boolean;
    name?: string;
    givenName?: string;
    familyName?: string;
    picture?: string;
    locale?: string;
    googleSub?: string;
    receivedAt: number;
  }
>();

/**
 * GET /auth/google/start
 *
 * Build the Google authz URL with a `state` (a random token we sign so
 * we can verify it on callback) and 302 to Google. Browser follows the
 * redirect, user consents, Google bounces back to /auth/google/callback.
 */
app.get('/auth/google/start', async (c) => {
  const env = effectiveEnv();
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID;
  const redirect = env.GOOGLE_OAUTH_REDIRECT ?? 'http://localhost:8787/auth/google/callback';
  if (!clientId) {
    return c.json(
      {
        error:
          'GOOGLE_OAUTH_CLIENT_ID not configured · paste it into .env, then restart the api server',
      },
      503,
    );
  }
  const state = await mintSessionToken('oauth-state');
  setCookie(c, 'dr-abc.oauth-state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax',
    path: '/',
    maxAge: 600, // 10-minute window for the user to consent
  });
  // Login-only scopes. Fitness scopes were removed entirely so the
  // Advanced Protection Program stops blocking the consent screen.
  const url = new URL(GOOGLE_OAUTH_AUTHZ);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirect);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', GOOGLE_OAUTH_SCOPES_LOGIN);
  url.searchParams.set('access_type', 'offline'); // get refresh_token
  url.searchParams.set('prompt', 'consent'); // always show consent so refresh_token comes back
  url.searchParams.set('state', state);
  return c.redirect(url.toString(), 302);
});

/**
 * GET /auth/google/callback?code=...&state=...
 *
 * Verify state, exchange the auth code for tokens, fetch userinfo,
 * mint a Mörbius session cookie, store the tokens for later Fit sync.
 * Lands the user back on /app on success.
 */
app.get('/auth/google/callback', async (c) => {
  const env = effectiveEnv();
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirect = env.GOOGLE_OAUTH_REDIRECT ?? 'http://localhost:8787/auth/google/callback';
  const webOrigin = env.WEB_ORIGIN ?? 'http://localhost:5173';
  if (!clientId || !clientSecret) {
    return c.redirect(`${webOrigin}/login?google=err&reason=not_configured`, 302);
  }

  // Google sends ?error=... when the user (or APP) refuses consent or
  // when the OAuth client is blocked by the user's account policy.
  // `policy_enforced` = Advanced Protection blocking an unverified app.
  // `access_denied` = user clicked "Cancel" on the consent screen.
  // In every case we bounce the user back to /login with a reason so
  // the UI can render an actionable hint instead of a JSON wall.
  const errParam = c.req.query('error');
  if (errParam) {
    const reason = errParam.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 40);
    return c.redirect(`${webOrigin}/login?google=err&reason=${reason}`, 302);
  }

  const code = c.req.query('code');
  const state = c.req.query('state');
  const expected = getCookie(c, 'dr-abc.oauth-state');
  if (!code) return c.redirect(`${webOrigin}/login?google=err&reason=missing_code`, 302);
  if (!state || !expected || state !== expected) {
    return c.redirect(`${webOrigin}/login?google=err&reason=invalid_state`, 302);
  }
  deleteCookie(c, 'dr-abc.oauth-state', { path: '/' });

  // Exchange the code for tokens
  const tokenRes = await fetch(GOOGLE_OAUTH_TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirect,
      grant_type: 'authorization_code',
    }),
  });
  if (!tokenRes.ok) {
    return c.redirect(`${webOrigin}/login?google=err&reason=token_exchange_failed`, 302);
  }
  const tokens = (await tokenRes.json()) as GoogleTokenResponse;

  // Fetch user identity
  const profileRes = await fetch(GOOGLE_USERINFO, {
    headers: { authorization: `Bearer ${tokens.access_token}` },
  });
  if (!profileRes.ok) {
    return c.json({ error: 'google userinfo failed' }, 502);
  }
  const profile = (await profileRes.json()) as GoogleUserInfo;
  const userId = `google:${profile.sub}`;

  GOOGLE_TOKENS.set(userId, {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
    scope: tokens.scope ?? '',
  });

  // Cache the Google profile so the chat surface can pre-fill name +
  // email + avatar instead of asking the user to retype what Google
  // already returned. Profile is volatile in dev (in-memory map); a
  // future migration plumbs it through app_user.
  GOOGLE_PROFILES.set(userId, {
    email: profile.email,
    emailVerified: profile.email_verified,
    name: profile.name,
    givenName: profile.given_name,
    familyName: profile.family_name,
    picture: profile.picture,
    locale: profile.locale,
    googleSub: profile.sub,
    receivedAt: Date.now(),
  });

  // Mint Mörbius session cookie + send the user to the app
  const sessionToken = await mintSessionToken(userId);
  setSessionCookie(c, sessionToken);
  return c.redirect(`${webOrigin}/app?google=ok`, 302);
});

/**
 * GET /fitness/google/sync
 *
 * Pulls the last 24 h of step + heart-rate aggregates from Google Fit
 * for the calling session user and returns a normalised FitnessSnapshot.
 * Re-uses the access token stored at callback time.
 */
app.get('/fitness/google/sync', async (c) => {
  const sid = getCookie(c, AUTH_COOKIE_NAME);
  if (!sid) return c.json({ error: 'not signed in' }, 401);
  const session = await verifySessionToken(sid);
  if (!session) return c.json({ error: 'session expired' }, 401);

  const tokenState = GOOGLE_TOKENS.get(session.userId);
  if (!tokenState) {
    return c.json(
      { error: 'google fit not connected for this user · sign in via /auth/google/start' },
      412,
    );
  }

  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const startMs = dayStart.getTime();
  const endMs = Date.now();

  const aggregateRes = await fetch(
    'https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate',
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${tokenState.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        aggregateBy: [
          { dataTypeName: 'com.google.step_count.delta' },
          { dataTypeName: 'com.google.heart_rate.bpm' },
        ],
        bucketByTime: { durationMillis: endMs - startMs },
        startTimeMillis: startMs,
        endTimeMillis: endMs,
      }),
    },
  );
  if (!aggregateRes.ok) {
    const detail = await aggregateRes.text().catch(() => '');
    return c.json({ error: 'google fit aggregate failed', detail }, 502);
  }
  const data = (await aggregateRes.json()) as {
    bucket?: Array<{
      dataset?: Array<{
        dataSourceId?: string;
        point?: Array<{
          dataTypeName?: string;
          value?: Array<{ intVal?: number; fpVal?: number }>;
        }>;
      }>;
    }>;
  };

  let steps = 0;
  let hrSum = 0;
  let hrCount = 0;
  for (const bucket of data.bucket ?? []) {
    for (const ds of bucket.dataset ?? []) {
      for (const p of ds.point ?? []) {
        if (p.dataTypeName === 'com.google.step_count.delta') {
          steps += p.value?.[0]?.intVal ?? 0;
        } else if (p.dataTypeName === 'com.google.heart_rate.bpm') {
          const v = p.value?.[0]?.fpVal;
          if (typeof v === 'number') {
            hrSum += v;
            hrCount += 1;
          }
        }
      }
    }
  }

  return c.json({
    source: 'google-fit',
    userId: session.userId,
    range: { startMs, endMs },
    steps,
    averageHeartRate: hrCount > 0 ? Math.round(hrSum / hrCount) : null,
    fetchedAt: Date.now(),
  });
});

app.get('/api-keys', (c) => {
  const userId = requireUser(c);
  if (!userId) return c.json({ error: 'X-Dr-Abc-User header required' }, 400);
  return c.json({ keys: listKeys(userId) });
});

app.delete('/api-keys/:id', (c) => {
  const userId = requireUser(c);
  if (!userId) return c.json({ error: 'X-Dr-Abc-User header required' }, 400);
  const ok = revokeKey(userId, c.req.param('id'));
  return c.json({ ok }, ok ? 200 : 404);
});

const port = Number(process.env.PORT ?? 8787);
console.log(`🧠 Mörbius API listening on :${port}`);

// Bun's default idleTimeout is 10 s — too tight for SSE streams that
// span a slow Ollama Meditron call (20-60 s on CPU). 255 is the max
// Bun accepts (4 minutes). The orchestrator's per-task deadline
// (60 s default) still bounds the actual work; idleTimeout just keeps
// the HTTP socket alive long enough for the diagnostic SSE event to
// reach the client.
export default { port, fetch: app.fetch, idleTimeout: 255 };
