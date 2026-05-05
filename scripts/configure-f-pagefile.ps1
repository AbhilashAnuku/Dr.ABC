# configure-f-pagefile.ps1 - allocate 200 GB of F: drive as the Windows
# page file so Morbius can serve the 70B-Instruct model locally.
#
# Architect's call 2026-05-11: "take the 200 GB of the F drive assign
# as the virtual memory, all permissions granted."
#
# Why the registry route:
#   The Set-WmiInstance + Win32_PageFileSetting path returns
#   "Generic failure" on modern Win10/11 builds even with admin +
#   SeCreatePagefilePrivilege - the WMI provider has been deprecated
#   for pagefile management. The canonical Windows API for this is
#   the registry key under Session Manager\Memory Management, which
#   the boot loader reads on every startup. This script writes there.
#
# What this does:
#   1. Disables system-managed pagefile (so Windows doesn't overwrite
#      our choice on next boot).
#   2. Reads any existing PagingFiles registry value.
#   3. Preserves the C: pagefile entry (small one helps crash dumps).
#   4. Adds F:\pagefile.sys 204800 204800 (initial = max = 200 GB).
#   5. Writes the merged multi-string back to the registry.
#
# REQUIRES ADMIN. REQUIRES REBOOT.
#
# Reversible via scripts\restore-default-pagefile.ps1.

$ErrorActionPreference = 'Stop'

$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "[X] This script must run as Administrator." -ForegroundColor Red
    Write-Host "    Right-click PowerShell -> Run as administrator, then re-run."
    exit 1
}

$fDrive = Get-PSDrive -Name 'F' -ErrorAction SilentlyContinue
if (-not $fDrive) {
    Write-Host "[X] F: drive not found." -ForegroundColor Red
    exit 1
}
$freeGB = [math]::Round($fDrive.Free / 1GB, 1)
Write-Host "[>] F: drive free: $freeGB GB"
if ($freeGB -lt 210) {
    Write-Host "[!] WARNING: less than 210 GB free on F:. 200 GB pagefile may not fit." -ForegroundColor Yellow
    Write-Host "    Continue anyway? (y/N) " -NoNewline
    $reply = Read-Host
    if ($reply -ne 'y') { exit 1 }
}

# 1. Disable system-managed pagefile (best-effort via WMI; the registry
# write below is what actually controls the boot loader, but flipping
# the WMI flag keeps Windows' Performance Options UI in sync).
Write-Host "[>] Disabling system-managed pagefile flag..."
try {
    $sys = Get-WmiObject -Class Win32_ComputerSystem -EnableAllPrivileges
    if ($sys.AutomaticManagedPagefile) {
        $sys.AutomaticManagedPagefile = $false
        $sys.Put() | Out-Null
        Write-Host "  [+] flag disabled"
    } else {
        Write-Host "  [=] flag already off"
    }
} catch {
    Write-Host "  [!] couldn't toggle WMI flag (non-fatal): $_" -ForegroundColor Yellow
}

# 2. Read the current PagingFiles registry value.
$regPath = 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Memory Management'
$valueName = 'PagingFiles'

$current = (Get-ItemProperty -Path $regPath -Name $valueName -ErrorAction SilentlyContinue).$valueName
if ($null -eq $current) { $current = @() }
if ($current -is [string]) { $current = @($current) }

Write-Host ""
Write-Host "[>] Current PagingFiles entries:"
if ($current.Count -eq 0) {
    Write-Host "    (none)"
} else {
    foreach ($e in $current) { Write-Host "    $e" }
}

# 3. Build the new array.
#   - Drop any existing F: entry (we're replacing it).
#   - Preserve all other drives.
#   - Add F:\pagefile.sys 204800 204800.
$kept = @()
foreach ($entry in $current) {
    if ($entry -notmatch '^F:') {
        $kept += $entry
    }
}
$kept += 'F:\pagefile.sys 204800 204800'

# 4. Write the multi-string back. REG_MULTI_SZ = "MultiString".
Write-Host ""
Write-Host "[>] Writing new PagingFiles registry value..."
Set-ItemProperty -Path $regPath -Name $valueName -Value $kept -Type MultiString
Write-Host "  [+] registry updated"

# 5. Show resulting entries.
Write-Host ""
Write-Host "[+] New PagingFiles entries:" -ForegroundColor Green
$after = (Get-ItemProperty -Path $regPath -Name $valueName).$valueName
foreach ($e in $after) { Write-Host "    $e" }

Write-Host ""
Write-Host "REBOOT REQUIRED for the new pagefile to take effect." -ForegroundColor Yellow
Write-Host ""
Write-Host "After reboot, verify with:"
Write-Host "  Get-WmiObject -Class Win32_PageFileUsage | Format-Table Name, AllocatedBaseSize, CurrentUsage"
Write-Host ""
Write-Host "Then point Ollama at the 70B and run the autopilot once:"
Write-Host "  `$env:OLLAMA_MODEL = 'llama3.3:70b-instruct-q4_K_M'"
Write-Host "  bun run morbius:autopilot -- --once --tune"
Write-Host ""
Write-Host "Expect: first request takes 3-8 minutes (model paging in from F:)."
Write-Host "Subsequent same-session requests run 30-90 s each."
