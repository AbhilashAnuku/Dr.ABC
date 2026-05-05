#!/usr/bin/env bun
/**
 * visual-report — generate a single HTML page that bundles the live
 * state of every Mörbius surface, so a reviewer can scroll one
 * page and see the entire project visually + every input/output.
 *
 * What it produces (docs/status/visual-report-YYYY-MM-DD.html):
 *   1. Header strip with the run timestamp + system probe summary
 *   2. Web routes section — an <iframe> per route, sandboxed, lazy-load
 *   3. API endpoints section — a card per probe with status + body
 *      preview rendered as pretty-printed JSON
 *   4. Sidecar (py-svc) section — every router with health pill
 *   5. Dev-console section — link buttons into the 4 categories
 *   6. Manual-test checklist mirror — copies docs/MANUAL-TEST-PLAN.md
 *      headings into a TOC so a reviewer can tick items as they go
 *
 * Usage:
 *   bun run scripts/visual-report.ts                   # local dev
 *   bun run scripts/visual-report.ts --api http://...  # custom API
 *   bun run scripts/visual-report.ts --web http://...  # custom web
 *
 * Goal: capture every input and output as visual screens in a report,
 * not only command-line output. That's this file.
 */

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

interface Args {
  apiBase: string;
  webBase: string;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    apiBase: get('--api') ?? process.env.MORBIUS_API_BASE ?? 'http://localhost:8787',
    webBase: get('--web') ?? process.env.MORBIUS_WEB_BASE ?? 'http://localhost:5173',
  };
}

const args = parseArgs(process.argv.slice(2));

interface ApiProbe {
  name: string;
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
}

const API_PROBES: ApiProbe[] = [
  { name: 'GET /', method: 'GET', path: '/' },
  { name: 'GET /agents', method: 'GET', path: '/agents' },
  { name: 'GET /datasets', method: 'GET', path: '/datasets' },
  { name: 'GET /health/full', method: 'GET', path: '/health/full' },
  { name: 'GET /research/snapshot', method: 'GET', path: '/research/snapshot' },
  { name: 'GET /personas/live', method: 'GET', path: '/personas/live' },
  { name: 'GET /accuracy/live', method: 'GET', path: '/accuracy/live' },
  {
    name: 'POST /mcq (sample)',
    method: 'POST',
    path: '/mcq',
    body: {
      question:
        '58 yo male · crushing chest pain radiating to left arm · diaphoretic · ECG ST-elevation II/III/aVF. Next?',
      options: {
        A: 'Aspirin + emergent cath',
        B: 'Schedule outpatient echo',
        C: 'Reassure + discharge',
        D: 'CXR + observe',
      },
    },
  },
];

interface SidecarProbe {
  name: string;
  path: string;
}

const SIDECAR_PROBES: SidecarProbe[] = [
  { name: 'sidecar root', path: '/' },
  { name: 'sidecar /health', path: '/health' },
  { name: 'sidecar /quantum/health', path: '/quantum/health' },
];

const WEB_ROUTES = [
  { name: 'Landing', path: '/' },
  { name: 'Login', path: '/login' },
  { name: 'Dashboard', path: '/app' },
  { name: 'Clinic', path: '/app/clinic' },
  { name: 'Imaging', path: '/app/imaging' },
  { name: 'Brain', path: '/app/brain' },
  { name: 'Profile', path: '/app/profile' },
  { name: 'Settings', path: '/app/settings' },
  { name: 'API keys', path: '/app/api-keys' },
  { name: 'Dev console', path: '/app/dev-console' },
];

async function probeApi(p: ApiProbe): Promise<{
  status: number;
  ok: boolean;
  durationMs: number;
  body: unknown;
  error: string | null;
}> {
  const t0 = Date.now();
  try {
    const init: RequestInit = {
      method: p.method,
      headers: p.body ? { 'content-type': 'application/json' } : undefined,
      body: p.body ? JSON.stringify(p.body) : undefined,
    };
    const r = await fetch(`${args.apiBase}${p.path}`, init);
    const text = await r.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = { _raw: text.slice(0, 500), _ct: r.headers.get('content-type') ?? '' };
    }
    return { status: r.status, ok: r.ok, durationMs: Date.now() - t0, body, error: null };
  } catch (e) {
    return {
      status: 0,
      ok: false,
      durationMs: Date.now() - t0,
      body: null,
      error: e instanceof Error ? e.message : 'fetch failed',
    };
  }
}

async function probeSidecar(p: SidecarProbe): Promise<{
  status: number;
  ok: boolean;
  body: unknown;
  error: string | null;
}> {
  try {
    const r = await fetch(`http://localhost:8001${p.path}`);
    const text = await r.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = text.slice(0, 200);
    }
    return { status: r.status, ok: r.ok, body, error: null };
  } catch (e) {
    return {
      status: 0,
      ok: false,
      body: null,
      error: e instanceof Error ? e.message : 'sidecar offline',
    };
  }
}

const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

function renderApiCard(p: ApiProbe, r: Awaited<ReturnType<typeof probeApi>>): string {
  const tone = r.ok ? '#10b981' : r.status >= 400 && r.status < 500 ? '#f59e0b' : '#f43f5e';
  const bodyJson = JSON.stringify(r.body, null, 2);
  const truncated = bodyJson.length > 4000 ? `${bodyJson.slice(0, 4000)}\n…` : bodyJson;
  return `
    <article class="card">
      <header>
        <code class="method">${p.method}</code>
        <code class="path">${escapeHtml(p.path)}</code>
        <span class="status" style="background:${tone}1a; color:${tone}; border-color:${tone}55">
          ${r.status || 'ERR'} · ${r.durationMs} ms
        </span>
      </header>
      ${p.body ? `<details><summary>Request body</summary><pre>${escapeHtml(JSON.stringify(p.body, null, 2))}</pre></details>` : ''}
      <details open><summary>Response</summary><pre>${escapeHtml(truncated)}</pre></details>
      ${r.error ? `<p class="err">⚠ ${escapeHtml(r.error)}</p>` : ''}
    </article>`;
}

function renderRouteCard(name: string, path: string): string {
  const url = `${args.webBase}${path}`;
  return `
    <article class="card route">
      <header>
        <strong>${escapeHtml(name)}</strong>
        <code class="path"><a href="${url}" target="_blank" rel="noopener">${escapeHtml(path)}</a></code>
      </header>
      <iframe src="${url}" loading="lazy" sandbox="allow-same-origin allow-scripts" title="${escapeHtml(name)}"></iframe>
    </article>`;
}

function renderSidecar(p: SidecarProbe, r: Awaited<ReturnType<typeof probeSidecar>>): string {
  const tone = r.ok ? '#10b981' : '#f43f5e';
  return `
    <article class="card">
      <header>
        <code class="path">${escapeHtml(p.path)}</code>
        <span class="status" style="background:${tone}1a; color:${tone}; border-color:${tone}55">
          ${p.name} · ${r.status || 'OFFLINE'}
        </span>
      </header>
      <pre>${escapeHtml(JSON.stringify(r.body, null, 2).slice(0, 1200))}</pre>
      ${r.error ? `<p class="err">⚠ ${escapeHtml(r.error)}</p>` : ''}
    </article>`;
}

async function main() {
  console.log('🖼  visual-report');
  console.log(`   api : ${args.apiBase}`);
  console.log(`   web : ${args.webBase}`);

  const apiResults = await Promise.all(
    API_PROBES.map(async (p) => [p, await probeApi(p)] as const),
  );
  const sidecarResults = await Promise.all(
    SIDECAR_PROBES.map(async (p) => [p, await probeSidecar(p)] as const),
  );

  const apiPassed = apiResults.filter(([, r]) => r.ok).length;
  const sidecarPassed = sidecarResults.filter(([, r]) => r.ok).length;
  const ts = new Date();

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Mörbius · Visual Report · ${ts.toISOString().slice(0, 16)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    :root {
      --bg: #0a1628;
      --bg-card: rgba(20, 30, 50, 0.6);
      --border: rgba(255,255,255,0.08);
      --text: #f1f5f9;
      --text-muted: #94a3b8;
      --quantum: #38bdf8;
      --bio: #10b981;
      --purple: #a855f7;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0; padding: 0;
      font-family: 'Inter', -apple-system, system-ui, sans-serif;
      background: linear-gradient(180deg, #050b18 0%, #0a1628 50%, #050b18 100%);
      color: var(--text);
      min-height: 100vh;
    }
    header.hero {
      padding: 32px 40px;
      border-bottom: 1px solid var(--border);
      backdrop-filter: blur(12px);
      position: sticky; top: 0; z-index: 5;
      background: rgba(5, 11, 24, 0.85);
    }
    header.hero h1 {
      font-family: 'Syne', sans-serif;
      font-size: 56px;
      letter-spacing: -0.02em;
      margin: 0;
      background: linear-gradient(135deg, #c4b5fd, #93c5fd, #6ee7b7);
      -webkit-background-clip: text;
      background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    header.hero .meta {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      letter-spacing: 0.3em;
      text-transform: uppercase;
      color: var(--text-muted);
      margin-top: 8px;
    }
    header.hero .stats {
      display: flex; gap: 16px;
      margin-top: 16px;
      flex-wrap: wrap;
    }
    .pill {
      padding: 6px 14px;
      border-radius: 999px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      border: 1px solid var(--border);
    }
    .pill.bio { color: var(--bio); border-color: rgba(16, 185, 129, 0.4); background: rgba(16, 185, 129, 0.08); }
    .pill.quantum { color: var(--quantum); border-color: rgba(56, 189, 248, 0.4); background: rgba(56, 189, 248, 0.08); }
    .pill.purple { color: var(--purple); border-color: rgba(168, 85, 247, 0.4); background: rgba(168, 85, 247, 0.08); }
    section {
      padding: 32px 40px;
      border-bottom: 1px solid var(--border);
    }
    section h2 {
      font-family: 'Syne', sans-serif;
      font-size: 32px;
      letter-spacing: -0.01em;
      margin: 0 0 8px;
    }
    section h2::after {
      content: '';
      display: block;
      width: 56px; height: 2px;
      background: linear-gradient(90deg, var(--quantum), var(--bio));
      margin-top: 8px;
      border-radius: 999px;
      opacity: 0.7;
    }
    section .desc {
      color: var(--text-muted);
      font-size: 14px;
      margin: 0 0 24px;
      max-width: 800px;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
      gap: 16px;
    }
    .grid.routes {
      grid-template-columns: repeat(auto-fill, minmax(440px, 1fr));
    }
    .card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 16px;
      backdrop-filter: blur(8px);
    }
    .card header {
      display: flex; gap: 8px;
      align-items: center;
      margin-bottom: 8px;
      flex-wrap: wrap;
    }
    .card iframe {
      width: 100%;
      height: 360px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: #050b18;
    }
    .method {
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
      padding: 2px 6px;
      background: rgba(56, 189, 248, 0.15);
      color: var(--quantum);
      border-radius: 4px;
      letter-spacing: 0.15em;
      text-transform: uppercase;
    }
    .path {
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      color: var(--text-muted);
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .status {
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
      padding: 4px 10px;
      border-radius: 999px;
      border: 1px solid;
      letter-spacing: 0.15em;
      text-transform: uppercase;
    }
    pre {
      background: rgba(0,0,0,0.4);
      padding: 12px;
      border-radius: 6px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      line-height: 1.5;
      max-height: 360px;
      overflow: auto;
      margin: 0;
      color: #cbd5e1;
    }
    details > summary {
      cursor: pointer;
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
      letter-spacing: 0.15em;
      text-transform: uppercase;
      color: var(--text-muted);
      margin: 8px 0;
    }
    .err { color: #f43f5e; font-size: 12px; }
    a { color: var(--quantum); text-decoration: none; }
    a:hover { text-decoration: underline; }
    .toc { columns: 2; column-gap: 32px; }
    .toc a { display: block; padding: 4px 0; font-size: 13px; }
  </style>
</head>
<body>
  <header class="hero">
    <h1>Mörbius — visual report</h1>
    <div class="meta">${escapeHtml(ts.toISOString())} · api: ${escapeHtml(args.apiBase)} · web: ${escapeHtml(args.webBase)}</div>
    <div class="stats">
      <span class="pill quantum">api · ${apiPassed}/${API_PROBES.length} ok</span>
      <span class="pill bio">sidecar · ${sidecarPassed}/${SIDECAR_PROBES.length} ok</span>
      <span class="pill purple">web routes · ${WEB_ROUTES.length} probed</span>
    </div>
  </header>

  <section id="toc">
    <h2>Table of contents</h2>
    <p class="desc">Jump to any section. Bundle this report by pressing Ctrl+S in your browser.</p>
    <div class="toc">
      <a href="#api">API endpoints (${API_PROBES.length})</a>
      <a href="#sidecar">Sidecar (py-svc)</a>
      <a href="#routes">Web routes (${WEB_ROUTES.length})</a>
      <a href="#dev-console">Dev console categories</a>
      <a href="#manual">Manual test checklist (mirror)</a>
    </div>
  </section>

  <section id="api">
    <h2>API endpoints</h2>
    <p class="desc">Every probe captures status code, latency, and the response body. Click "Response" to expand. Architect can curl the same endpoints with the request body shown.</p>
    <div class="grid">
      ${apiResults.map(([p, r]) => renderApiCard(p, r)).join('\n')}
    </div>
  </section>

  <section id="sidecar">
    <h2>Sidecar · py-svc</h2>
    <p class="desc">FastAPI sidecar at :8001 — imaging · genomics · NER · translate · quantum routers.</p>
    <div class="grid">
      ${sidecarResults.map(([p, r]) => renderSidecar(p, r)).join('\n')}
    </div>
  </section>

  <section id="routes">
    <h2>Web routes — visual screens</h2>
    <p class="desc">Live iframe per route. Each one is the actual app rendering against the local dev server. If a frame is blank, that route is failing — open it in a tab to see the error.</p>
    <div class="grid routes">
      ${WEB_ROUTES.map((r) => renderRouteCard(r.name, r.path)).join('\n')}
    </div>
  </section>

  <section id="dev-console">
    <h2>Dev console categories</h2>
    <p class="desc">The four categories that re-organised 11 flat tabs into a story future researchers can extend.</p>
    <div class="grid">
      <article class="card">
        <header><strong>⚡ Live</strong></header>
        <p>Pipeline · Query lab · Activity tail · Inspect drilldown</p>
        <a href="${args.webBase}/app/dev-console" target="_blank">Open →</a>
      </article>
      <article class="card">
        <header><strong>🧠 Research</strong></header>
        <p>Doctor-brain · Per-agent analysis · Scheduled experiments · Research timeline · Benchmarks</p>
        <a href="${args.webBase}/app/dev-console" target="_blank">Open →</a>
      </article>
      <article class="card">
        <header><strong>🩺 Health</strong></header>
        <p>System probe · Inventory · /health snapshot</p>
        <a href="${args.webBase}/app/dev-console" target="_blank">Open →</a>
      </article>
      <article class="card">
        <header><strong>🎚 Tune</strong></header>
        <p>Env editor · Learning flow · Training corpus</p>
        <a href="${args.webBase}/app/dev-console" target="_blank">Open →</a>
      </article>
    </div>
  </section>

  <section id="manual">
    <h2>Manual test checklist · mirror</h2>
    <p class="desc">Full checklist lives at <a href="../MANUAL-TEST-PLAN.md">docs/MANUAL-TEST-PLAN.md</a> — open it in your editor to tick boxes as you go.</p>
    <p class="desc">Section anchors:
      §1 Public surfaces · §2 Authenticated app · §3 Sidecar · §4 Auto smoke · §5 Visual report · §6 Cross-cutting · §7 Pass criteria
    </p>
  </section>

  <footer style="padding: 24px 40px; color: var(--text-muted); font-size: 12px; text-align: center;">
    Generated by <code>scripts/visual-report.ts</code> · Mörbius v0.6 · zero-budget · local-first
  </footer>
</body>
</html>
`;

  const stamp = ts.toISOString().slice(0, 10);
  const out = join(process.cwd(), 'docs', 'status', `visual-report-${stamp}.html`);
  await writeFile(out, html);
  console.log(`▸ wrote ${out} (${(html.length / 1024).toFixed(1)} KB)`);
  console.log(`▸ open in browser: file://${out.replace(/\\/g, '/')}`);
}

main().catch((err) => {
  console.error('visual-report failed:', err);
  process.exit(1);
});
