# setup-mcp-keys.ps1 - idempotently merge MCP / cloud-backend keys
# into the project .env file.
#
# Architect provided three keys on 2026-05-11:
#   NVIDIA_API_KEY       (NIM hosted Llama-3.3-70B)
#   ROBOFLOW_API_KEY     (medical image detection)
#   FIRECRAWL_API_KEY    (PubMed / public-web extract)
# Perplexity was skipped this round.
#
# Pass each key as a -named param; the script reads the existing
# .env, replaces any matching KEY=... line with the new value, or
# appends if the key isn't present yet. Existing keys for other
# services (ANTHROPIC_API_KEY, etc.) are preserved unchanged.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\setup-mcp-keys.ps1 `
#     -NvidiaKey   'nvapi-...' `
#     -RoboflowKey 'HTHI...' `
#     -FirecrawlKey 'fc-...' `
#     -RoboflowWorkspace 'abhilashs-workspace-qabbg' `
#     -RoboflowWorkflow 'rf-detr'

param(
    [string]$NvidiaKey = '',
    [string]$RoboflowKey = '',
    [string]$FirecrawlKey = '',
    [string]$RoboflowWorkspace = '',
    [string]$RoboflowWorkflow = '',
    [string]$EnvPath = ''
)

$ErrorActionPreference = 'Stop'

if (-not $EnvPath) {
    $RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
    $EnvPath = Join-Path $RepoRoot '.env'
}

if (-not (Test-Path $EnvPath)) {
    Write-Host "[!] $EnvPath does not exist - creating fresh." -ForegroundColor Yellow
    Set-Content -Path $EnvPath -Value '# Dr.ABC project secrets · gitignored' -Encoding utf8
}

$content = Get-Content -Path $EnvPath -Raw -Encoding utf8
if ($null -eq $content) { $content = '' }

function Update-EnvKey {
    param([string]$Body, [string]$Name, [string]$Value)
    if ([string]::IsNullOrWhiteSpace($Value)) {
        Write-Host "[=] $Name : skipped (no value provided)"
        return $Body
    }
    $line = "$Name=$Value"
    $pattern = "(?m)^$Name=.*$"
    if ($Body -match $pattern) {
        $new = [System.Text.RegularExpressions.Regex]::Replace($Body, $pattern, $line)
        Write-Host "[+] $Name : updated" -ForegroundColor Green
        return $new
    }
    Write-Host "[+] $Name : added" -ForegroundColor Green
    if ($Body -and -not $Body.EndsWith("`n")) { $Body += "`n" }
    return $Body + $line + "`n"
}

$content = Update-EnvKey $content 'NVIDIA_API_KEY'       $NvidiaKey
$content = Update-EnvKey $content 'ROBOFLOW_API_KEY'     $RoboflowKey
$content = Update-EnvKey $content 'ROBOFLOW_WORKSPACE'   $RoboflowWorkspace
$content = Update-EnvKey $content 'ROBOFLOW_WORKFLOW'    $RoboflowWorkflow
$content = Update-EnvKey $content 'FIRECRAWL_API_KEY'    $FirecrawlKey
# Pin Morbius to the cloud cascade for the demo - cheap, fast, accurate.
$content = Update-EnvKey $content 'MORBIUS_BACKEND'      'nvidia'
$content = Update-EnvKey $content 'BACKEND_PRIORITY'     'nvidia,anthropic,huggingface,ollama'

Set-Content -Path $EnvPath -Value $content -Encoding utf8 -NoNewline
Write-Host ""
Write-Host "[+] .env updated at $EnvPath" -ForegroundColor Green
Write-Host "    The API auto-reloads (bun --hot watches .env). No restart needed."
