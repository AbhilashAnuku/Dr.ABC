<#
    mirror-to-staging.ps1 — copy the V5 source tree into the
    v0.8.1-stage sibling folder, skipping node_modules / .git /
    build artefacts. Architect's call (2026-05-12) for moving
    today's work onto the v0.8.1-stage workspace for continuation.
#>

$ErrorActionPreference = 'Continue'

$source = 'f:\Dr.ABC Project- K-2472-2200\Dr.Abc_V5'
$dest   = 'f:\Dr.ABC Project- K-2472-2200\Dr.ABC-reviewer-v0.8.1-stage'

if (-not (Test-Path $dest)) {
    New-Item -ItemType Directory -Path $dest -Force | Out-Null
}

$exclude = @(
    'node_modules', '.git', 'dist', 'build', '.turbo', '.vite',
    '.cache', '.next', '.bun-cache'
)

$args = @(
    $source, $dest,
    '/E',
    '/XD'
) + $exclude + @(
    '/XF', '*.log',
    '/R:1',
    '/W:1',
    '/NFL',
    '/NDL'
)

Write-Host "Mirroring:" -ForegroundColor Cyan
Write-Host "  source: $source"
Write-Host "  dest:   $dest"
Write-Host "  excluded dirs: $($exclude -join ', ')"

& robocopy @args

Write-Host "`nDone." -ForegroundColor Green
