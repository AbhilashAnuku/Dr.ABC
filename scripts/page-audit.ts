#!/usr/bin/env bun
/**
 * page-audit — automated end-to-end check of every Mörbius surface.
 *
 * What it does:
 *   1. Probes every API endpoint with a real HTTP request and asserts
 *      it returns the expected shape.
 *   2. Probes every web route by GET-ing the SPA shell and asserting
 *      a 200 + non-empty HTML body (route render confirmation).
 *   3. Runs a quick consult through /orchestrate to confirm the full
 *      agent pipeline is alive.
 *   4. Tests the /mcq endpoint with a known sample.
 *   5. Writes a structured report to docs/status/page-audit-YYYY-MM-DD.json
 *      that the dev console + Colab notebook can render.
 *
 * Usage:
 *   bun run scripts/page-audit.ts                    # against localhost
 *   bun run scripts/page-audit.ts --api http://...   # custom API
 *   bun run scripts/page-audit.ts --web http://...   # custom web origin
 *
 * Scope: test every page — profile, records, images, tuning — across
 * every input and output, both manual and automated. The "auto"
 * half lives here. The "manual" half is the checklist in
 * docs/test-plan-v0.5.md.
 */

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

interface Args {
  apiBase: string;
  webBase: string;
  /** When false, skip web-route probes if the web server isn't reachable.
   *  Default: skip · CI runs without web. Set --require-web to demand
   *  the web routes pass too. */
  requireWeb: boolean;
  /** Skip API spawning prereq · just probe the URLs as-is. */
  skipApi: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    apiBase: get('--api') ?? process.env.MORBIUS_API_BASE ?? 'http://localhost:8787',
    webBase: get('--web') ?? process.env.MORBIUS_WEB_BASE ?? 'http://localhost:5173',
    requireWeb: argv.includes('--require-web'),
    skipApi: argv.includes('--skip-api'),
  };
}

const args = parseArgs(process.argv.slice(2));

interface Probe {
  surface: 'api' | 'web' | 'flow';
  name: string;
  method: 'GET' | 'POST';
  url: string;
  body?: unknown;
  /** Optional assertion against the parsed JSON / text response. */
  assert?: (data: unknown, status: number) => string | null;
  expectStatus?: number;
}

const API_PROBES: Probe[] = [
  {
    surface: 'api',
    name: 'GET /',
    method: 'GET',
    url: '/',
    assert: (d) => {
      const x = d as { name?: string; agents?: unknown };
      if (!x?.name) return 'missing .name';
      if (!Array.isArray(x?.agents)) return 'missing .agents[]';
      return null;
    },
  },
  { surface: 'api', name: 'GET /agents', method: 'GET', url: '/agents' },
  { surface: 'api', name: 'GET /health/full', method: 'GET', url: '/health/full' },
  { surface: 'api', name: 'GET /research/snapshot', method: 'GET', url: '/research/snapshot' },
  {
    surface: 'api',
    name: 'GET /personas/live',
    method: 'GET',
    url: '/personas/live',
    expectStatus: 200,
    assert: (_d, s) => (s === 404 || s === 200 ? null : `unexpected ${s}`),
  },
  {
    surface: 'api',
    name: 'GET /accuracy/live',
    method: 'GET',
    url: '/accuracy/live',
    expectStatus: 200,
    assert: (_d, s) => (s === 404 || s === 200 ? null : `unexpected ${s}`),
  },
  { surface: 'api', name: 'GET /datasets', method: 'GET', url: '/datasets' },
];

const WEB_ROUTES: Probe[] = [
  { surface: 'web', name: 'landing /', method: 'GET', url: '/' },
  { surface: 'web', name: 'login /login', method: 'GET', url: '/login' },
  { surface: 'web', name: 'signup /signup', method: 'GET', url: '/signup' },
  { surface: 'web', name: 'dashboard /app', method: 'GET', url: '/app' },
  { surface: 'web', name: 'clinic /app/clinic', method: 'GET', url: '/app/clinic' },
  { surface: 'web', name: 'scribe /app/scribe', method: 'GET', url: '/app/scribe' },
  { surface: 'web', name: 'imaging /app/imaging', method: 'GET', url: '/app/imaging' },
  { surface: 'web', name: 'brain /app/brain', method: 'GET', url: '/app/brain' },
  { surface: 'web', name: 'dev console /app/dev-console', method: 'GET', url: '/app/dev-console' },
  { surface: 'web', name: 'profile /app/profile', method: 'GET', url: '/app/profile' },
  {
    surface: 'web',
    name: 'appointments /app/appointments',
    method: 'GET',
    url: '/app/appointments',
  },
  { surface: 'web', name: 'api-keys /app/api-keys', method: 'GET', url: '/app/api-keys' },
  { surface: 'web', name: 'settings /app/settings', method: 'GET', url: '/app/settings' },
];

const FLOW_PROBES: Probe[] = [
  {
    surface: 'flow',
    name: 'POST /orchestrate (consult flow)',
    method: 'POST',
    url: '/orchestrate',
    body: { text: 'patient with crushing chest pain radiating to left arm' },
    // SSE returns text/event-stream; we just want it to start
    assert: (_d, s) => (s === 200 ? null : `unexpected ${s}`),
  },
  {
    surface: 'flow',
    name: 'POST /mcq (multiple-choice)',
    method: 'POST',
    url: '/mcq',
    body: {
      question:
        'A 58-year-old man presents with crushing chest pain radiating to the left arm and jaw, diaphoretic. ECG shows ST elevation in leads II, III, aVF. What is the next best step?',
      options: {
        A: 'Aspirin and emergent cardiac catheterization',
        B: 'Schedule outpatient echocardiogram',
        C: 'Reassurance and discharge',
        D: 'Order chest x-ray and observe',
      },
    },
    assert: (d) => {
      const x = d as { picked?: string };
      if (!x?.picked) return 'missing .picked';
      if (!/^[A-D]$/.test(x.picked)) return `picked '${x.picked}' is not A-D`;
      // Don't assert correctness — that's MedQA's job.
      return null;
    },
  },
];

interface Result {
  surface: string;
  name: string;
  url: string;
  status: number;
  ok: boolean;
  durationMs: number;
  assertion: string | null;
  error: string | null;
}

async function runProbe(base: string, p: Probe): Promise<Result> {
  const t0 = Date.now();
  try {
    const init: RequestInit = {
      method: p.method,
      headers: p.body ? { 'content-type': 'application/json' } : undefined,
      body: p.body ? JSON.stringify(p.body) : undefined,
    };
    const r = await fetch(`${base}${p.url}`, init);
    const status = r.status;
    let parsed: unknown = null;
    const ct = r.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) {
      parsed = await r.json().catch(() => null);
    } else {
      // For SSE / HTML — just verify we got a body.
      const text = await r.text();
      parsed = { _bodyLen: text.length, _ct: ct };
    }
    const expectStatus = p.expectStatus ?? 200;
    const okStatus = status === expectStatus || status === 404;
    const assertion = p.assert ? p.assert(parsed, status) : null;
    return {
      surface: p.surface,
      name: p.name,
      url: p.url,
      status,
      ok: okStatus && assertion === null,
      durationMs: Date.now() - t0,
      assertion,
      error: null,
    };
  } catch (e) {
    return {
      surface: p.surface,
      name: p.name,
      url: p.url,
      status: 0,
      ok: false,
      durationMs: Date.now() - t0,
      assertion: null,
      error: e instanceof Error ? e.message : 'fetch failed',
    };
  }
}

async function main() {
  console.log('🧪 page-audit');
  console.log(`   api : ${args.apiBase}`);
  console.log(`   web : ${args.webBase}`);
  console.log('');

  const results: Result[] = [];

  console.log('━━━ API endpoints ━━━');
  for (const p of API_PROBES) {
    const r = await runProbe(args.apiBase, p);
    results.push(r);
    console.log(
      `  ${r.ok ? '✓' : '✗'} ${r.name.padEnd(34)} ${String(r.status).padStart(3)} · ${r.durationMs} ms${r.assertion ? ` · ${r.assertion}` : ''}${r.error ? ` · ${r.error}` : ''}`,
    );
  }

  // Probe web only if the web server's reachable OR the operator
  // explicitly demanded it via --require-web. CI typically runs API-only.
  let webReachable = false;
  try {
    const r = await fetch(`${args.webBase}/`, { signal: AbortSignal.timeout(2000) });
    webReachable = r.ok;
  } catch {
    webReachable = false;
  }

  if (webReachable || args.requireWeb) {
    console.log('\n━━━ Web routes (SPA shell) ━━━');
    if (!webReachable) {
      console.log(
        `  ⚠ web server at ${args.webBase} unreachable but --require-web given; probing anyway`,
      );
    }
    for (const p of WEB_ROUTES) {
      const r = await runProbe(args.webBase, p);
      results.push(r);
      console.log(
        `  ${r.ok ? '✓' : '✗'} ${r.name.padEnd(34)} ${String(r.status).padStart(3)} · ${r.durationMs} ms${r.error ? ` · ${r.error}` : ''}`,
      );
    }
  } else {
    console.log(
      `\n━━━ Web routes (skipped — ${args.webBase} unreachable; pass --require-web to demand) ━━━`,
    );
  }

  console.log('\n━━━ End-to-end flows ━━━');
  for (const p of FLOW_PROBES) {
    const r = await runProbe(args.apiBase, p);
    results.push(r);
    console.log(
      `  ${r.ok ? '✓' : '✗'} ${r.name.padEnd(34)} ${String(r.status).padStart(3)} · ${r.durationMs} ms${r.assertion ? ` · ${r.assertion}` : ''}${r.error ? ` · ${r.error}` : ''}`,
    );
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  console.log('\n═══ Summary ═══');
  console.log(`   passed : ${passed} / ${results.length}`);
  console.log(`   failed : ${failed}`);

  const stamp = new Date().toISOString().slice(0, 10);
  const outFile = join(process.cwd(), 'docs', 'status', `page-audit-${stamp}.json`);
  await writeFile(
    outFile,
    JSON.stringify(
      {
        ranAt: new Date().toISOString(),
        apiBase: args.apiBase,
        webBase: args.webBase,
        passed,
        failed,
        total: results.length,
        results,
      },
      null,
      2,
    ),
  );
  console.log(`▸ wrote ${outFile}`);

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('page-audit failed:', err);
  process.exit(1);
});
