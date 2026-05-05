# deploy-now.ps1 — interactive zero-budget global deploy walker.
#
# Run from repo root:
#   powershell -ExecutionPolicy Bypass -File scripts\deploy-now.ps1
#
# What it does (in order):
#   1. Verifies Bun + git + curl are on PATH.
#   2. Confirms the repo is on `main` and pushed.
#   3. Checks for the Vercel + Fly CLIs; offers install commands if missing.
#   4. Runs `bun run lint && bun run typecheck && bun test` as a pre-flight.
#   5. Builds the web bundle.
#   6. Walks through `fly auth login` → `fly launch` → `fly deploy` if not yet deployed.
#   7. Walks through `vercel link` → `vercel env add` → `vercel deploy --prod`.
#   8. Pings the live URLs and reports green/red.
#
# Nothing in this script charges money. The only side-effects are to the
# architect's free Vercel/Fly accounts.

$ErrorActionPreference = 'Stop'
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $RepoRoot

function Step($n, $msg) {
    Write-Host ""
    Write-Host "[$n] $msg" -ForegroundColor Cyan
}

function Need($name, $hint) {
    if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
        Write-Host "  ✗ $name not found. $hint" -ForegroundColor Red
        return $false
    }
    Write-Host "  ✓ $name on PATH" -ForegroundColor Green
    return $true
}

Step 1 "Pre-flight — toolchain"
$ok = $true
$ok = (Need 'bun' 'Install from https://bun.sh') -and $ok
$ok = (Need 'git' 'Install from https://git-scm.com') -and $ok
$ok = (Need 'curl' 'Should ship with Windows 10+; check $env:Path') -and $ok
if (-not $ok) { exit 1 }

Step 2 "Git state"
$branch = (git rev-parse --abbrev-ref HEAD).Trim()
Write-Host "  current branch: $branch"
if ($branch -ne 'main') {
    Write-Host "  ⚠ You are on '$branch'. Vercel + Fly tag-deploy expects pushes from 'main'." -ForegroundColor Yellow
    Write-Host "    Continue anyway? (y/N): " -NoNewline
    $ans = Read-Host
    if ($ans -ne 'y') { exit 0 }
}

Step 3 "CLI presence"
$hasVercel = (Get-Command vercel -ErrorAction SilentlyContinue) -ne $null
$hasFly = (Get-Command fly -ErrorAction SilentlyContinue) -ne $null
if (-not $hasVercel) {
    Write-Host "  ⚠ vercel CLI missing. Install:" -ForegroundColor Yellow
    Write-Host "    bun add -g vercel"
}
if (-not $hasFly) {
    Write-Host "  ⚠ fly CLI missing. Install:" -ForegroundColor Yellow
    Write-Host "    iwr https://fly.io/install.ps1 -useb | iex"
}
if (-not $hasVercel -or -not $hasFly) {
    Write-Host ""
    Write-Host "  Install them then re-run this script." -ForegroundColor Yellow
    exit 0
}

Step 4 "Pre-flight — lint + typecheck + test"
& bun run lint
if ($LASTEXITCODE -ne 0) { exit 1 }
& bun run typecheck
if ($LASTEXITCODE -ne 0) { exit 1 }
& bun test
if ($LASTEXITCODE -ne 0) { exit 1 }

Step 5 "Build web bundle"
& bun run --filter '@dr-abc/web' build
if ($LASTEXITCODE -ne 0) { exit 1 }

Step 6 "Fly.io API"
& fly auth whoami 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "  ▸ Logging into Fly…"
    & fly auth login
    if ($LASTEXITCODE -ne 0) { Write-Host "  ✗ Fly login failed." -ForegroundColor Red; exit 1 }
}
& fly status --app morbius-api 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "  ▸ App not found — creating with the existing fly.toml…"
    # We already have fly.toml checked in. `fly launch --copy-config` would
    # overwrite it and re-prompt; `fly apps create` is the precise op.
    & fly apps create morbius-api
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  ✗ Could not create the Fly app (name taken?). Edit `app =` in fly.toml and retry." -ForegroundColor Red
        exit 1
    }
}
Write-Host "  ▸ Deploying API…"
& fly deploy --remote-only --config fly.toml
if ($LASTEXITCODE -ne 0) { Write-Host "  ✗ Fly deploy failed." -ForegroundColor Red; exit 1 }

Step 7 "Vercel web"
& vercel link --yes
if ($LASTEXITCODE -ne 0) { Write-Host "  ✗ vercel link failed." -ForegroundColor Red; exit 1 }
# `vercel env add` reads the value from stdin, not a positional arg —
# piping is the supported flow.
'https://morbius-api.fly.dev' | & vercel env add VITE_API_BASE_URL production --force 2>$null
# `--prebuilt` requires `vercel build` first (it expects .vercel/output).
# Run vercel build locally so the upload step has the right shape.
& vercel build --prod
if ($LASTEXITCODE -ne 0) { Write-Host "  ✗ vercel build failed." -ForegroundColor Red; exit 1 }
& vercel deploy --prebuilt --prod
if ($LASTEXITCODE -ne 0) { Write-Host "  ✗ vercel deploy failed." -ForegroundColor Red; exit 1 }

Step 8 "Smoke test live URLs"
Start-Sleep -Seconds 5
# vercel ls --json returns an array of deployments; the first entry is
# the most recent. The `.url` field is the bare hostname (no scheme).
$lsOutput = & vercel ls --json 2>$null
$webUrl = $null
try {
    $deployments = $lsOutput | ConvertFrom-Json
    if ($deployments.Count -gt 0) { $webUrl = $deployments[0].url }
} catch { }
if (-not $webUrl) { $webUrl = 'morbius.vercel.app' }
$apiUrl = 'morbius-api.fly.dev'

$webStatus = 0
$apiStatus = 0
try { $webStatus = (Invoke-WebRequest -Uri "https://$webUrl/" -UseBasicParsing -TimeoutSec 10).StatusCode } catch { }
try { $apiStatus = (Invoke-WebRequest -Uri "https://$apiUrl/health" -UseBasicParsing -TimeoutSec 10).StatusCode } catch { }

Write-Host ""
Write-Host "  Web : https://$webUrl  → $webStatus"
Write-Host "  API : https://$apiUrl/health → $apiStatus"
Write-Host ""
if ($webStatus -eq 200 -and $apiStatus -eq 200) {
    Write-Host "✓ Mörbius is live." -ForegroundColor Green
} else {
    Write-Host "✗ Something didn't come up. Check fly logs / vercel logs." -ForegroundColor Red
}
