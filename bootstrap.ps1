# bootstrap.ps1 — one-command setup for a fresh evaluation machine.
#
# Audience: the reviewer / a fresh collaborator on Windows.
# Goal:     from a clean checkout to a running Mörbius in ~10 minutes.
#
# Run from PowerShell at the repo root:
#   powershell -ExecutionPolicy Bypass -File bootstrap.ps1

$ErrorActionPreference = 'Stop'
function Step($msg) { Write-Host ""; Write-Host "▸ $msg" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "  ✓ $msg"   -ForegroundColor Green }
function Warn($msg) { Write-Host "  ⚠ $msg"   -ForegroundColor Yellow }
function Fail($msg) { Write-Host "  ✗ $msg"   -ForegroundColor Red; exit 1 }

# -------- 1. Bun --------
Step "Checking for Bun"
if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
    Warn "Bun not found. Installing from bun.sh ..."
    powershell -c "irm bun.sh/install.ps1 | iex"
    $bunDir = Join-Path $env:USERPROFILE '.bun\bin'
    if (Test-Path $bunDir) { $env:Path = "$bunDir;$env:Path" }
    if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
        Fail "Bun install failed. Reopen PowerShell and re-run, or install manually from https://bun.sh."
    }
    Ok "Bun installed: $(bun --version)"
} else {
    Ok "Bun present: $(bun --version)"
}

# -------- 2. Docker --------
Step "Checking for Docker"
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Fail "Docker is required for Postgres + Redis + Qdrant + Ollama containers. Install from https://www.docker.com/products/docker-desktop/ and re-run this script."
}
try {
    docker info | Out-Null
    Ok "Docker daemon reachable"
} catch {
    Warn "Docker is installed but the daemon isn't running."
    Warn "Open Docker Desktop, wait for the green tick, then re-run this script."
    exit 1
}

# -------- 3. workspace install --------
Step "Installing project dependencies (bun install)"
& bun install
if ($LASTEXITCODE -ne 0) { Fail "bun install failed" }
Ok "bun install complete"

# -------- 4. infra (postgres + redis + qdrant + ollama) --------
Step "Bringing up Docker infra (Postgres · Redis · Qdrant · Ollama)"
& bun run infra:up
if ($LASTEXITCODE -ne 0) { Fail "infra:up failed" }
Ok "Infra up"

# -------- 5. pull local LLM --------
Step "Pulling local LLM (llama3.1:8b · ~6 GB · one-time)"
$existing = & docker exec dr-abc-ollama ollama list 2>&1 | Select-String 'llama3.1:8b'
if ($existing) {
    Ok "llama3.1:8b already pulled"
} else {
    & docker exec dr-abc-ollama ollama pull llama3.1:8b
    if ($LASTEXITCODE -ne 0) { Fail "ollama pull failed" }
    Ok "Pulled llama3.1:8b"
}

# -------- 6. .env --------
Step "Provisioning .env"
if (-not (Test-Path '.env')) {
    if (Test-Path '.env.example') {
        Copy-Item '.env.example' '.env'
        Ok ".env created from .env.example"
    } else {
        @"
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.1:8b
MORBIUS_BACKEND=ollama
DATABASE_URL=postgres://dr_abc:dr_abc@localhost:5432/dr_abc
"@ | Set-Content -Path '.env' -Encoding UTF8
        Ok ".env created with minimum local-first defaults"
    }
} else {
    Ok ".env already present (left untouched)"
}

# -------- 7. start dev stack --------
Write-Host ""
Write-Host "════════════════════════════════════════════════════════════════"
Write-Host "  Mörbius is ready to boot. The next step starts api + web +"
Write-Host "  py-svc together — keep this terminal open while testing."
Write-Host "════════════════════════════════════════════════════════════════"
Write-Host ""
Write-Host "Run:    bun run dev"
Write-Host "Then:   open http://localhost:5173 in your browser"
Write-Host ""
Write-Host "Walk-through: docs/vault/build-instructions/reviewer-clone-and-run.md"
Write-Host ""
Write-Host "(Skipping auto-start of `bun run dev` because it is long-running."
Write-Host " Run it manually so you can see the streaming logs.)"
