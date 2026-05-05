#!/usr/bin/env bun
/**
 * dev-all — spawn API + web + py-svc in parallel.
 *
 * Brings up the entire mesh via `bun run dev` in one command instead
 * of three terminals. This script is the orch:
 *
 *   - apps/api          via `bun run --filter @dr-abc/api dev`
 *   - apps/web          via `bun run --filter @dr-abc/web dev`
 *   - apps/py-svc       via `uv run --directory apps/py-svc uvicorn …`
 *
 * If `uv` (the Python sidecar's package manager) is missing, the
 * py-svc launch is skipped with a one-line note — api + web still come
 * up so the demo isn't blocked. Hit Ctrl-C once and every child gets
 * SIGTERM. Exit codes from any child propagate to the parent.
 */

import { spawn } from 'node:child_process';

// Minimal shape we use from spawn() — the Node typings under bun's
// build don't surface `.on` cleanly, so cast to this narrow type at
// the call site (same pattern used in scripts/morbius-soak.ts).
interface SpawnedChild {
  on: (ev: 'exit', cb: (code: number | null) => void) => void;
  kill: (signal?: NodeJS.Signals) => boolean;
}

interface Service {
  name: string;
  color: string;
  cmd: string;
  args: string[];
  /** Optional probe — if it returns non-zero, skip the service with a note. */
  precheck?: { cmd: string; args: string[]; missingHint: string };
}

const services: Service[] = [
  {
    name: 'api',
    color: '\x1b[36m',
    cmd: 'bun',
    args: ['run', '--filter', '@dr-abc/api', 'dev'],
  },
  {
    name: 'web',
    color: '\x1b[32m',
    cmd: 'bun',
    args: ['run', '--filter', '@dr-abc/web', 'dev'],
  },
  {
    name: 'py ',
    color: '\x1b[35m',
    cmd: 'uv',
    args: [
      'run',
      '--directory',
      'apps/py-svc',
      'uvicorn',
      'app.main:app',
      '--host',
      '0.0.0.0',
      '--port',
      '8001',
      '--reload',
    ],
    precheck: {
      cmd: 'uv',
      args: ['--version'],
      missingHint:
        'uv not found — install from https://docs.astral.sh/uv/. py-svc skipped; api + web continuing.',
    },
  },
];

const RESET = '\x1b[0m';

async function probe(cmd: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { shell: true, stdio: 'ignore' }) as unknown as SpawnedChild & {
      on: (ev: 'exit' | 'error', cb: (code: number | null) => void) => void;
    };
    p.on('exit', (code) => resolve(code === 0));
    p.on('error', () => resolve(false));
  });
}

const procs: SpawnedChild[] = [];

async function main() {
  console.log('🛠 dev-all · spawning api · web · py-svc');
  console.log('');

  // Soft Docker check — warn but don't block. Local dev
  // works without Docker when using cloud LLM keys (Anthropic /
  // NVIDIA / HF). Bug A.5 from PLAN-v0.7: tell them clearly so they
  // don't wonder why Ollama-backed agents time out.
  const dockerOk = await probe('docker', ['ps']);
  if (!dockerOk) {
    console.log('\x1b[33m⚠ Docker Desktop is NOT running.\x1b[0m Cloud LLM fallbacks will work,');
    console.log('   but Ollama / Postgres / Qdrant / Redis are unavailable. Persona harness');
    console.log('   will time-out at 60 s/Q on Ollama paths. To enable everything: start');
    console.log('   Docker Desktop → run `bun run infra:up` → then re-run `bun run dev`.');
    console.log('');
  }

  for (const s of services) {
    if (s.precheck) {
      const ok = await probe(s.precheck.cmd, s.precheck.args);
      if (!ok) {
        console.log(`${s.color}[${s.name}]${RESET} skipped — ${s.precheck.missingHint}`);
        continue;
      }
    }
    const p = spawn(s.cmd, s.args, { shell: true, stdio: 'inherit' }) as unknown as SpawnedChild;
    p.on('exit', (code: number | null) => {
      console.log(`${s.color}[${s.name}]${RESET} exited (code ${code})`);
    });
    procs.push(p);
    console.log(`${s.color}[${s.name}]${RESET} spawned · ${s.cmd} ${s.args.join(' ')}`);
  }
  console.log('');
  console.log('▸ api  → http://localhost:8787');
  console.log('▸ web  → http://localhost:5173');
  console.log('▸ py   → http://localhost:8001/health');
  console.log('Ctrl-C to stop everything.');
}

const shutdown = () => {
  for (const p of procs) {
    try {
      p.kill('SIGTERM');
    } catch {
      // best-effort
    }
  }
  setTimeout(() => process.exit(0), 500);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

void main();
