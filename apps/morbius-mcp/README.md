# Mörbius MCP

Stdio MCP (Model Context Protocol) server that exposes Mörbius's core
brain — health, research, diagnosis, MedQA, persona harness, autopilot,
research cycles — as structured tools any MCP client can call.

## Why

The architect's brief: _"I need an MCP for the core brain — easy to
train, deploy, test, also we can analyse the performance with MCP."_

This server gives any MCP client (the editor, Cursor, Zed, Anthropic
CLI) the same training / testing / analysis surface the dev console
exposes — without clicks. Schedule it, automate it, ship it.

## Tools

| Name | Verb | What it does |
|---|---|---|
| `morbius.health` | analyse | Deep system probe (every backend, latencies) |
| `morbius.research_snapshot` | analyse | Aggregated research view |
| `morbius.diagnose` | live | Runs a real consult through the pipeline |
| `morbius.mcq` | live | Tight A/B/C/D answer for clinical MCQs |
| `morbius.persona_summary` | analyse | Latest persona-harness scores |
| `morbius.live_accuracy` | analyse | Autopilot accuracy snapshot |
| `morbius.run_persona` | train + test | Spawns `bun run morbius:persona` |
| `morbius.run_medqa` | test | Spawns the MedQA harness (limit configurable) |
| `morbius.run_autopilot` | test | Spawns autopilot --once |
| `morbius.list_cycles` | analyse | Enumerates research-cycle-*.json |

All `run_*` tools return `{ exitCode, stdout, stderr }` so the client
can parse the harness's own structured output.

## Wiring

### the editor

```bash
claude mcp add morbius -- bun run /abs/path/to/Dr.Abc_V5/apps/morbius-mcp/src/server.ts
```

Or in `~/.config/claude-code/mcp.json` (or the project-local `.mcp.json`):

```json
{
  "mcpServers": {
    "morbius": {
      "command": "bun",
      "args": ["run", "/abs/path/to/Dr.Abc_V5/apps/morbius-mcp/src/server.ts"],
      "env": { "MORBIUS_API_BASE": "http://localhost:8787" }
    }
  }
}
```

### Anthropic CLI / Cursor / Zed

Same shape — every MCP client speaks the same JSON-RPC over stdio.

## Prerequisites

The Mörbius API must be reachable at `MORBIUS_API_BASE` (default
`http://localhost:8787`). Start it with:

```bash
bun run dev:api    # api only
bun run dev        # api + web + py-svc via dev-all.ts
```

## Protocol notes

- Line-delimited JSON-RPC 2.0 over stdin/stdout.
- Implements `initialize`, `tools/list`, `tools/call`, and `ping`.
- Notifications (`notifications/initialized`, etc.) are ack'd silently.
- Zero npm dependencies — only Bun + `node:child_process` + `node:fs`.

## Extending

Add a new tool by appending to the `TOOLS` array in
[`src/server.ts`](./src/server.ts). Each tool has:

- `name` — namespaced like `morbius.<verb>`
- `description` — one paragraph (clients render this to the model)
- `inputSchema` — JSON Schema for the arguments
- `handler` — async function returning the result (any JSON-serialisable shape)
