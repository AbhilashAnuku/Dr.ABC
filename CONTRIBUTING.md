# Contributing

Thanks for your interest in Dr·ABC.

This is a solo project built for an MSc Applied AI module, but issues and suggestions are welcome.

## Setup

```bash
bun install
bun run dev        # api + web + py-svc
bun test           # run the suite
bun run lint       # Biome
bun run typecheck  # tsc
```

## Conventions

- TypeScript strict; Biome for lint + format (`bun run lint`).
- Conventional commits (`feat:`, `fix:`, `docs:`, `chore:`).
- Keep files focused; prefer small modules.
- No secrets in the repo; no real patient data (synthetic only).

## Reporting an issue

Open a GitHub issue with steps to reproduce and your environment (OS, Bun version).
