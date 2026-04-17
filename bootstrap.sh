#!/usr/bin/env bash
# bootstrap.sh — one-command setup for a fresh evaluation machine.
#
# Audience: the reviewer / a fresh collaborator on macOS or Linux.
# Goal:     from a clean checkout to a running Mörbius in ~10 minutes.
#
# Run from a terminal at the repo root:
#   bash bootstrap.sh

set -euo pipefail

step()  { echo; echo "▸ $*"; }
ok()    { echo "  ✓ $*"; }
warn()  { echo "  ⚠ $*"; }
fail()  { echo "  ✗ $*" >&2; exit 1; }

# -------- 1. Bun --------
step "Checking for Bun"
if ! command -v bun >/dev/null 2>&1; then
  warn "Bun not found. Installing from bun.sh ..."
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
  if ! command -v bun >/dev/null 2>&1; then
    fail "Bun install failed. Re-open the terminal and re-run, or install manually from https://bun.sh."
  fi
fi
ok "Bun present: $(bun --version)"

# -------- 2. Docker --------
step "Checking for Docker"
if ! command -v docker >/dev/null 2>&1; then
  fail "Docker is required for Postgres + Redis + Qdrant + Ollama containers. Install Docker Desktop (macOS) or docker.io (Linux) and re-run."
fi
if ! docker info >/dev/null 2>&1; then
  fail "Docker is installed but the daemon isn't running. Start Docker (Docker Desktop tray on macOS, 'sudo systemctl start docker' on Linux) and re-run."
fi
ok "Docker daemon reachable"

# -------- 3. workspace install --------
step "Installing project dependencies (bun install)"
bun install
ok "bun install complete"

# -------- 4. infra (postgres + redis + qdrant + ollama) --------
step "Bringing up Docker infra (Postgres · Redis · Qdrant · Ollama)"
bun run infra:up
ok "Infra up"

# -------- 5. pull local LLM --------
step "Pulling local LLM (llama3.1:8b · ~6 GB · one-time)"
if docker exec dr-abc-ollama ollama list 2>/dev/null | grep -q 'llama3.1:8b'; then
  ok "llama3.1:8b already pulled"
else
  docker exec dr-abc-ollama ollama pull llama3.1:8b
  ok "Pulled llama3.1:8b"
fi

# -------- 6. .env --------
step "Provisioning .env"
if [[ ! -f .env ]]; then
  if [[ -f .env.example ]]; then
    cp .env.example .env
    ok ".env created from .env.example"
  else
    cat > .env <<'EOF'
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.1:8b
MORBIUS_BACKEND=ollama
DATABASE_URL=postgres://dr_abc:dr_abc@localhost:5432/dr_abc
EOF
    ok ".env created with minimum local-first defaults"
  fi
else
  ok ".env already present (left untouched)"
fi

# -------- 7. ready --------
echo
echo "════════════════════════════════════════════════════════════════"
echo "  Mörbius is ready to boot. The next step starts api + web +"
echo "  py-svc together — keep this terminal open while testing."
echo "════════════════════════════════════════════════════════════════"
echo
echo "Run:    bun run dev"
echo "Then:   open http://localhost:5173 in your browser"
echo
echo "Walk-through: docs/vault/build-instructions/reviewer-clone-and-run.md"
echo
echo "(Skipping auto-start of 'bun run dev' because it is long-running."
echo " Run it manually so you can see the streaming logs.)"
