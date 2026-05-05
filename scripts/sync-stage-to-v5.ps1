# sync-stage-to-v5.ps1 -- file-level mirror from staging into V5.
#
# Why: staging and V5 are both clones of the same GitHub remote but
# their local git histories are unrelated, so git merge refuses. This
# script copies the staging tree on top of V5 with robocopy, preserving
# V5 local files (.git, .env, node_modules, .vscode).
#
# Run from staging:
#   powershell -ExecutionPolicy Bypass -File scripts/sync-stage-to-v5.ps1
#
# Or:
#   bun run morbius:sync:local

$ErrorActionPreference = 'Stop'

$stageRoot = Split-Path -Parent $PSScriptRoot
$v5Root    = Join-Path (Split-Path -Parent $stageRoot) 'Dr.Abc_V5'

function Step([string]$msg) { Write-Host ''; Write-Host ('[..] ' + $msg) -ForegroundColor Cyan }
function Ok([string]$msg)   { Write-Host ('  OK ' + $msg) -ForegroundColor Green }
function Warn([string]$msg) { Write-Host ('  !! ' + $msg) -ForegroundColor Yellow }
function Fail([string]$msg) { Write-Host ('  XX ' + $msg) -ForegroundColor Red; exit 1 }

if ($env:DR_ABC_V5_PATH -and (Test-Path $env:DR_ABC_V5_PATH)) {
    $v5Root = $env:DR_ABC_V5_PATH
}

# BARRIER -- v1.0.18 hardening (2026-05-12).
# The sync MUST refuse to run while bun run dev is alive on V5.
# Background: the architect's exam day was nearly lost to the
# sync-while-dev-running pattern -- robocopy rewrites source files
# while Vite holds open .bun chunks + esbuild binaries, then bun
# install reshuffles the store, leaving Vite serving missing chunk
# hashes. Stop the dev server FIRST, sync, restart -- always.
function Test-PortListening([int]$port) {
    try {
        return [bool](Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction Stop)
    } catch {
        return $false
    }
}
$apiBound = Test-PortListening 8787
$webBound = Test-PortListening 5173
if ($apiBound -or $webBound) {
    Write-Host ''
    Fail ('REFUSING TO SYNC -- the V5 dev server is running. ' +
          'Stop it first (Ctrl+C the bun run dev terminal, or ' +
          '`Get-Process bun | Stop-Process -Force`), then re-run ' +
          'this script. The sync rewrites source files Vite is ' +
          'actively serving -- doing it live corrupts the chunk ' +
          'store and forces a node_modules nuke to recover.')
}

Step 'Source check'
Write-Host ('  staging: ' + $stageRoot)
if (-not (Test-Path $v5Root)) {
    Fail ('V5 dir not found at ' + $v5Root + '. Set DR_ABC_V5_PATH env var to override.')
}
Write-Host ('  target:  ' + $v5Root)

$excludeDirs = @(
    'node_modules', '.git', '.venv', '.next', 'dist', 'build',
    '.bun', '.cache', '.parcel-cache', '.turbo', 'coverage',
    '.svelte-kit', 'target', 'data', '.vscode'
)

$excludeFiles = @(
    '.env', '.env.local', '.env.production', '.env.bak.*',
    '.DS_Store', 'Thumbs.db', '*.log'
)

$xdArgs = $excludeDirs  | ForEach-Object { '/XD'; (Join-Path $stageRoot $_) }
$xfArgs = $excludeFiles | ForEach-Object { '/XF'; $_ }

Step 'Mirroring staging -> V5'
& robocopy $stageRoot $v5Root /MIR /NFL /NDL /NJH /NJS /NP @xdArgs @xfArgs | Out-Null

$ec = $LASTEXITCODE
if ($ec -ge 8) {
    Fail ('robocopy failed with exit code ' + $ec)
}
if ($ec -eq 0) {
    Ok 'No changes -- staging already matches V5'
} else {
    Ok ('Mirror complete -- robocopy exit ' + $ec)
}

# Clear Vite optimiser cache AND realign V5's node_modules with the
# bun.lock that just synced over. Without this step, V5's previously
# cached .bun/vite@... install holds chunks under hash X but the
# synced lock points at hash Y -- Vite crashes with "Cannot find module
# .../node_modules/.bun/vite@.../chunks/dep-XXXX.js".

$viteCache = Join-Path $v5Root 'node_modules\.vite'
if (Test-Path $viteCache) {
    Step 'Clearing V5 Vite optimizer cache (node_modules\.vite)'
    try {
        Remove-Item -Recurse -Force $viteCache -ErrorAction Stop
        Ok 'Vite cache cleared'
    } catch {
        Warn 'Could not clear Vite cache (dev server may be running and holding it)'
    }
}

# Realign V5's node_modules with the synced bun.lock. Bun install is
# idempotent + fast when nothing changed (~3-10 s), and refreshes the
# .bun store when the lockfile diverged.
Step 'Running bun install in V5 (realigns node_modules with synced bun.lock)'
$prevLocation = Get-Location
try {
    Set-Location -LiteralPath $v5Root
    $installResult = & bun install 2>&1
    Set-Location -LiteralPath $prevLocation
    if ($LASTEXITCODE -ne 0) {
        Warn 'bun install exited non-zero in V5'
        $installResult | Select-Object -Last 6 | ForEach-Object { Write-Host ('    ' + $_) -ForegroundColor Yellow }
        Warn 'Fallback: stop bun run dev in V5, rm -rf node_modules\.bun node_modules\.vite, then bun install'
    } else {
        Ok 'V5 node_modules realigned'
    }
} catch {
    Set-Location -LiteralPath $prevLocation
    Warn ('bun install failed: ' + $_.Exception.Message)
    Warn 'Manual recovery: stop bun run dev, rm -rf node_modules, bun install'
}

Push-Location $v5Root
$branch = git rev-parse --abbrev-ref HEAD 2>$null
$dirty  = git status --porcelain 2>$null
Pop-Location

$bar = '============================================================'
Write-Host ''
Write-Host $bar
Write-Host ('  V5 branch: ' + $branch)
if ($dirty) {
    Warn 'V5 has unstaged changes from this sync.'
    Write-Host ('  Inspect with: git -C ' + $v5Root + ' status')
    Write-Host '  Commit when ready:'
    Write-Host ('    git -C ' + $v5Root + ' add .')
    Write-Host ('    git -C ' + $v5Root + ' commit -m sync-from-stage')
} else {
    Ok 'V5 is clean. The sync did not change anything.'
}
Write-Host $bar
