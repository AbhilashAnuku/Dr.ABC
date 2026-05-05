# restore-default-pagefile.ps1 - undo configure-f-pagefile.ps1.
#
# Removes the F: pagefile and re-enables system-managed pagefile.
# REQUIRES ADMIN. REQUIRES REBOOT after running.

$ErrorActionPreference = 'Stop'

$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "[X] This script must run as Administrator." -ForegroundColor Red
    exit 1
}

Write-Host "[>] Removing F: pagefile entry..."
Get-WmiObject -Class Win32_PageFileSetting -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like 'F:*' } |
    ForEach-Object { $_.Delete() }

Write-Host "[>] Re-enabling system-managed pagefile..."
$sys = Get-WmiObject -Class Win32_ComputerSystem -EnableAllPrivileges
$sys.AutomaticManagedPagefile = $true
$sys.Put() | Out-Null

Write-Host ""
Write-Host "[+] Defaults restored." -ForegroundColor Green
Write-Host "    Reboot for the change to take effect."
Write-Host "    F:\pagefile.sys (~200 GB) will be unlocked on next reboot."
Write-Host "    Delete it manually if you want the disk space back."
