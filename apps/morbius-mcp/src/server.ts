#!/usr/bin/env bun
/**
 * morbius-mcp — Model Context Protocol server for Mörbius's core brain.
 *
 * What it is:
 *   A minimal stdio MCP server that exposes Mörbius's training,
 *   testing, analysis, and live-diagnose tools to any MCP-compatible
 *   client (the editor, Cursor, Zed, the Anthropic CLI, etc.).
 *
 * Why it exists:
 *   The architect wanted "an MCP for the core brain — easy to train,
 *   deploy, test, also we can analyse the performance with MCP". This
 *   gives the AI client direct, structured access to the same harness
 *   commands the dev console exposes — no clicking required.
 *
 * Tools surfaced (all delegate to the running API at MORBIUS_API_BASE,
 * default http://localhost:8787):
 *
 *   morbius.health               GET /health/full          deep system probe
 *   morbius.research_snapshot    GET /research/snapshot    full research view
 *   morbius.diagnose             POST /orchestrate         run a single consult
 *   morbius.mcq                  POST /mcq                 multiple-choice run
 *   morbius.persona_summary      GET /personas/live        latest persona harness
 *   morbius.live_accuracy        GET /accuracy/live        autopilot snapshot
 *   morbius.run_persona          spawn `bun run morbius:persona`
 *   morbius.run_medqa            spawn `bun run morbius:medqa --limit N`
 *   morbius.run_autopilot        spawn `bun run morbius:autopilot --once`
 *   morbius.list_cycles          enumerate docs/status/research-cycle-*.json
 *
 * Wiring it up (the editor as an example client):
 *
 *   claude mcp add morbius -- bun run apps/morbius-mcp/src/server.ts
 *
 * Or in `claude_desktop_config.json` / `.mcp.json`:
 *
 *   {
 *     "mcpServers": {
 *       "morbius": {
 *         "command": "bun",
 *         "args": ["run", "/abs/path/to/Dr.Abc_V5/apps/morbius-mcp/src/server.ts"],
 *         "env": { "MORBIUS_API_BASE": "http://localhost:8787" }
 *       }
 *     }
 *   }
 *
 * Protocol: line-delimited JSON-RPC 2.0 over stdin/stdout per the MCP
 * stdio transport spec. Stays SDK-free so the package has zero
 * dependencies — easy to reason about, easy to ship.
 */

import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const API_BASE = process.env.MORBIUS_API_BASE ?? 'http://localhost:8787';
const REPO_ROOT = resolve(import.meta.dir, '../../..');
const STATUS_DIR = resolve(REPO_ROOT, 'docs/status');
const PROTOCOL_VERSION = '2024-11-05';

interface RpcMessage {
  jsonrpc: '2.0';
  id?: number | string | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface ToolDef {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
  };
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

// ============================================================
//  Helpers
// ============================================================

async function apiGet(path: string): Promise<unknown> {
  const r = await fetch(`${API_BASE}${path}`);
  const text = await r.text();
  try {
    return JSON.parse(text);
  } catch {
    return { ok: r.ok, status: r.status, body: text };
  }
}

async function apiPost(path: string, body: unknown): Promise<unknown> {
  const r = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  // Some endpoints stream SSE — read fully, return joined frames.
  const text = await r.text();
  try {
    return JSON.parse(text);
  } catch {
    return { ok: r.ok, status: r.status, body: text };
  }
}

interface SpawnedChild {
  on: (ev: 'exit' | 'close', cb: (code: number | null) => void) => void;
}

async function runScript(
  script: string,
  args: string[] = [],
): Promise<{
  exitCode: number | null;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolveRun) => {
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    const proc = spawn('bun', ['run', script, ...args], {
      cwd: REPO_ROOT,
      shell: true,
      env: { ...process.env },
    }) as unknown as SpawnedChild & {
      stdout: { on: (ev: 'data', cb: (d: Buffer) => void) => void };
      stderr: { on: (ev: 'data', cb: (d: Buffer) => void) => void };
    };
    proc.stdout.on('data', (d) => stdoutChunks.push(d.toString()));
    proc.stderr.on('data', (d) => stderrChunks.push(d.toString()));
    proc.on('close', (code: number | null) => {
      resolveRun({
        exitCode: code,
        stdout: stdoutChunks.join(''),
        stderr: stderrChunks.join(''),
      });
    });
  });
}

// ============================================================
//  Tools
// ============================================================

const TOOLS: ToolDef[] = [
  {
    name: 'morbius.health',
    description:
      'Deep system probe — returns reachability + latency for every backend (Anthropic / NVIDIA / HF / Ollama / py-svc / Postgres / Redis / Qdrant). Use this first to confirm the API is alive before running heavier tools.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => apiGet('/health/full'),
  },
  {
    name: 'morbius.research_snapshot',
    description:
      'One-shot aggregator: latest persona summary + MedQA + live accuracy + research cycles + scheduled experiments + agent registry. The structured form of the dev-console Research tab.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => apiGet('/research/snapshot'),
  },
  {
    name: 'morbius.diagnose',
    description:
      'Run a real consult through the full agent pipeline (triage → diagnostic → validator gauntlet). Returns the structured differential + recommended tests + specialty.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Chief complaint + patient context' },
      },
      required: ['text'],
    },
    handler: async (args) => apiPost('/orchestrate', { text: args.text }),
  },
  {
    name: 'morbius.mcq',
    description:
      'Tight A/B/C/D answer for a multiple-choice clinical question. Bypasses the structured diagnostic agent — used by the MedQA harness.',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string' },
        options: {
          type: 'object',
          description: 'Object with keys A, B, C, D mapping to option text',
        },
      },
      required: ['question', 'options'],
    },
    handler: async (args) => apiPost('/mcq', { question: args.question, options: args.options }),
  },
  {
    name: 'morbius.persona_summary',
    description: 'Latest persona-harness summary (doctor / patient / student weighted scores).',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => apiGet('/personas/live'),
  },
  {
    name: 'morbius.live_accuracy',
    description: 'Most recent autopilot accuracy snapshot + history.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => apiGet('/accuracy/live'),
  },
  {
    name: 'morbius.run_persona',
    description:
      'TRAIN — spawn `bun run morbius:persona` end-to-end. Writes a fresh persona-summary-YYYY-MM-DD.json to docs/status. Returns stdout/stderr + exit code.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => runScript('morbius:persona'),
  },
  {
    name: 'morbius.run_medqa',
    description:
      'TEST — spawn `bun run morbius:medqa --limit N` (default 60). Writes medqa-YYYY-MM-DD.json. Hits /mcq first then falls back to /orchestrate.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Number of questions (default 60)' },
      },
    },
    handler: async (args) => {
      const limit = typeof args.limit === 'number' ? args.limit : 60;
      return runScript('morbius:medqa', ['--', '--limit', String(limit)]);
    },
  },
  {
    name: 'morbius.run_autopilot',
    description:
      'TEST — spawn `bun run morbius:autopilot --once`. Updates docs/status/live-accuracy.json with a fresh snapshot.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => runScript('morbius:autopilot', ['--', '--once']),
  },
  {
    name: 'morbius.list_cycles',
    description:
      'ANALYSE — enumerate every docs/status/research-cycle-*.json on disk newest-first, with parsed contents. Use this to read the daily training trend.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      try {
        const entries = await readdir(STATUS_DIR);
        const files = entries
          .filter((n) => n.startsWith('research-cycle-') && n.endsWith('.json'))
          .sort()
          .reverse();
        const out: Array<{ file: string; data: unknown }> = [];
        for (const f of files) {
          const r = await fetch(`file://${resolve(STATUS_DIR, f)}`).catch(() => null);
          if (!r) {
            // Bun sometimes can't fetch file:// — fall back to readFile.
            const fs = await import('node:fs/promises');
            const text = await fs.readFile(resolve(STATUS_DIR, f), 'utf8');
            out.push({ file: f, data: JSON.parse(text) });
            continue;
          }
          const text = await r.text();
          try {
            out.push({ file: f, data: JSON.parse(text) });
          } catch {
            out.push({ file: f, data: { raw: text } });
          }
        }
        return { ok: true, count: out.length, cycles: out };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  },
];

// ============================================================
//  JSON-RPC framing — line-delimited JSON over stdio (MCP stdio transport)
// ============================================================

function send(msg: RpcMessage): void {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

function sendError(id: RpcMessage['id'], code: number, message: string): void {
  send({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
}

async function handle(msg: RpcMessage): Promise<void> {
  if (msg.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: msg.id ?? null,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'morbius-mcp', version: '0.1.0' },
      },
    });
    return;
  }

  if (msg.method === 'tools/list') {
    send({
      jsonrpc: '2.0',
      id: msg.id ?? null,
      result: {
        tools: TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      },
    });
    return;
  }

  if (msg.method === 'tools/call') {
    const params = msg.params as { name?: string; arguments?: Record<string, unknown> } | undefined;
    const name = params?.name;
    const args = params?.arguments ?? {};
    const tool = TOOLS.find((t) => t.name === name);
    if (!tool) {
      sendError(msg.id, -32601, `Unknown tool: ${name}`);
      return;
    }
    try {
      const result = await tool.handler(args);
      send({
        jsonrpc: '2.0',
        id: msg.id ?? null,
        result: {
          content: [
            {
              type: 'text',
              text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
            },
          ],
        },
      });
    } catch (e) {
      sendError(msg.id, -32000, e instanceof Error ? e.message : 'tool failed');
    }
    return;
  }

  if (msg.method === 'notifications/initialized' || msg.method?.startsWith('notifications/')) {
    // No response required for notifications.
    return;
  }

  if (msg.method === 'ping') {
    send({ jsonrpc: '2.0', id: msg.id ?? null, result: {} });
    return;
  }

  // Unhandled method
  if (msg.id !== undefined && msg.id !== null) {
    sendError(msg.id, -32601, `Method not found: ${msg.method ?? '(no method)'}`);
  }
}

// ============================================================
//  Stdin reader — line-delimited JSON
// ============================================================

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
  buffer += chunk;
  let idx = buffer.indexOf('\n');
  while (idx >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (line) {
      try {
        const msg = JSON.parse(line) as RpcMessage;
        void handle(msg);
      } catch (e) {
        sendError(null, -32700, `Parse error: ${e instanceof Error ? e.message : 'invalid JSON'}`);
      }
    }
    idx = buffer.indexOf('\n');
  }
});

process.stdin.on('end', () => {
  process.exit(0);
});

// Banner to stderr (clients don't read stderr as protocol, so this is
// safe and helpful when running by hand).
process.stderr.write(`morbius-mcp · stdio · API ${API_BASE} · ${TOOLS.length} tools · ready\n`);
