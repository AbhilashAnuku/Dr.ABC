#!/usr/bin/env bun
/**
 * smoke-e2e — end-to-end smoke. Curls every API + py-svc endpoint,
 * counts files in data/, summarises the gauntlet, writes a Markdown
 * report.
 *
 * Scope: test the API end to end — curl all smoke endpoints, verify
 * clean code and a clean UI. This is the API + data slice. UI
 * rendering still needs a human eye in the browser.
 *
 * Usage:
 *   bun run scripts/smoke-e2e.ts
 *   API_BASE=http://localhost:8787 PY_SVC=http://localhost:8001 bun run scripts/smoke-e2e.ts
 *
 * Writes:
 *   docs/status/smoke-e2e-YYYY-MM-DD.md
 *   docs/status/smoke-e2e-YYYY-MM-DD.json
 */

import { existsSync } from 'node:fs';
import { readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const API = process.env.API_BASE ?? 'http://localhost:8787';
const PY = process.env.PY_SVC ?? 'http://localhost:8001';

interface Probe {
  surface: 'api' | 'py-svc';
  method: 'GET' | 'POST';
  url: string;
  ok: boolean;
  status: number;
  latencyMs: number;
  preview?: string;
  error?: string;
}

const PROBES: Array<{ s: 'api' | 'py-svc'; m: 'GET' | 'POST'; path: string; body?: unknown }> = [
  { s: 'api', m: 'GET', path: '/' },
  { s: 'api', m: 'GET', path: '/agents' },
  { s: 'api', m: 'GET', path: '/health' },
  { s: 'api', m: 'GET', path: '/health/full' },
  { s: 'api', m: 'GET', path: '/research/snapshot' },
  { s: 'api', m: 'GET', path: '/research/rehearsal' },
  { s: 'api', m: 'GET', path: '/personas/live' },
  { s: 'api', m: 'GET', path: '/errors/stats' },
  {
    s: 'api',
    m: 'POST',
    path: '/mcq',
    body: {
      question:
        'A 65 y/o man with crushing chest pain radiating to the left arm and ST elevations in V1-V4. Most likely occluded artery?',
      options: {
        A: 'Right coronary artery',
        B: 'Left circumflex',
        C: 'Left anterior descending',
        D: 'Posterior descending',
      },
    },
  },
  {
    s: 'api',
    m: 'POST',
    path: '/research/frontier',
    body: {
      question: 'What is the most under-investigated cause of treatment-resistant hypertension?',
    },
  },
  { s: 'py-svc', m: 'GET', path: '/health' },
];

async function probe(p: (typeof PROBES)[number]): Promise<Probe> {
  const base = p.s === 'api' ? API : PY;
  const url = `${base}${p.path}`;
  const t0 = Date.now();
  try {
    const r = await fetch(url, {
      method: p.m,
      headers: p.m === 'POST' ? { 'content-type': 'application/json' } : undefined,
      body: p.m === 'POST' ? JSON.stringify(p.body ?? {}) : undefined,
      signal: AbortSignal.timeout(60_000),
    });
    const latencyMs = Date.now() - t0;
    let preview: string | undefined;
    try {
      const text = await r.text();
      preview = text.slice(0, 200).replace(/\s+/g, ' ');
    } catch {
      preview = '(body read failed)';
    }
    return {
      surface: p.s,
      method: p.m,
      url: p.path,
      ok: r.ok,
      status: r.status,
      latencyMs,
      preview,
    };
  } catch (e) {
    return {
      surface: p.s,
      method: p.m,
      url: p.path,
      ok: false,
      status: 0,
      latencyMs: Date.now() - t0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function dirSize(dir: string): Promise<{ files: number; bytes: number }> {
  if (!existsSync(dir)) return { files: 0, bytes: 0 };
  let files = 0;
  let bytes = 0;
  const walk = async (d: string): Promise<void> => {
    const ents = await readdir(d, { withFileTypes: true }).catch(() => []);
    for (const e of ents) {
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile()) {
        files++;
        try {
          bytes += (await stat(p)).size;
        } catch {}
      }
    }
  };
  await walk(dir);
  return { files, bytes };
}

async function main() {
  console.log(`[smoke-e2e] api=${API} · py-svc=${PY}`);
  const startedAt = new Date().toISOString();

  // 1. API + py-svc probes (parallel)
  const probes = await Promise.all(PROBES.map(probe));

  // 2. Data inventory
  const dataPaths = [
    'data/hf-bench',
    'data/kaggle/imaging',
    'data/kaggle/tabular',
    'data/isic-sample',
    'data/medqa-bench',
    'data/drugbank-sample',
  ];
  const inv = await Promise.all(dataPaths.map(async (p) => ({ path: p, ...(await dirSize(p)) })));
  const totalFiles = inv.reduce((s, e) => s + e.files, 0);
  const totalBytes = inv.reduce((s, e) => s + e.bytes, 0);

  // 3. Summary
  const okCount = probes.filter((p) => p.ok).length;
  const summary = {
    startedAt,
    okCount,
    totalProbes: probes.length,
    failedProbes: probes.length - okCount,
    dataInventory: { totalFiles, totalBytes, dirs: inv },
    probes,
  };

  // 4. Render markdown
  const today = new Date().toISOString().slice(0, 10);
  const md: string[] = [];
  md.push(`# Smoke E2E · ${today}`);
  md.push('');
  md.push(`**Generated** \`${startedAt}\``);
  md.push(`**API** \`${API}\``);
  md.push(`**py-svc** \`${PY}\``);
  md.push(`**Endpoints OK** ${okCount}/${probes.length}`);
  md.push(
    `**Data on disk** ${totalFiles.toLocaleString()} files · ${(totalBytes / 1024 / 1024 / 1024).toFixed(2)} GB`,
  );
  md.push('');
  md.push('## Probes');
  md.push('');
  md.push('| Surface | Method | URL | Status | Latency | Preview |');
  md.push('|---|---|---|---|---:|---|');
  for (const p of probes) {
    const status = p.ok ? `✓ ${p.status}` : `✗ ${p.status || 'ERR'}`;
    const preview = p.error ?? p.preview?.slice(0, 80) ?? '';
    md.push(
      `| ${p.surface} | ${p.method} | \`${p.url}\` | ${status} | ${p.latencyMs} ms | ${preview.replace(/\|/g, '\\|')} |`,
    );
  }
  md.push('');
  md.push('## Data inventory');
  md.push('');
  md.push('| Path | Files | Size |');
  md.push('|---|---:|---:|');
  for (const e of inv) {
    md.push(
      `| \`${e.path}/\` | ${e.files.toLocaleString()} | ${(e.bytes / 1024 / 1024).toFixed(1)} MB |`,
    );
  }
  md.push(
    `| **total** | **${totalFiles.toLocaleString()}** | **${(totalBytes / 1024 / 1024 / 1024).toFixed(2)} GB** |`,
  );
  md.push('');
  md.push('## Honest limits of this smoke');
  md.push('');
  md.push('- API JSON-shape correctness verified · response-text rendering NOT verified.');
  md.push('- UI routes / image rendering / voice playback need a human eye on the browser.');
  md.push(
    '- LLM-output quality not graded here; see `docs/status/medqa-*.json` for accuracy harness.',
  );

  const jsonPath = `docs/status/smoke-e2e-${today}.json`;
  const mdPath = `docs/status/smoke-e2e-${today}.md`;
  await writeFile(jsonPath, JSON.stringify(summary, null, 2));
  await writeFile(mdPath, md.join('\n'));

  console.log(
    `[smoke-e2e] ${okCount}/${probes.length} OK · ${totalFiles} files · ${(totalBytes / 1024 / 1024 / 1024).toFixed(2)} GB`,
  );
  console.log(`[smoke-e2e] reports: ${jsonPath} + ${mdPath}`);
}

void main().catch((e) => {
  console.error('[smoke-e2e] fatal:', e instanceof Error ? e.stack : e);
  process.exit(1);
});
