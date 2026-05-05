<#
    capture-screen.ps1 — take a desktop screenshot and save under
    docs/status/screenshots/ with a timestamped filename.

    Usage:
      powershell -ExecutionPolicy Bypass -File scripts/capture-screen.ps1
      powershell -ExecutionPolicy Bypass -File scripts/capture-screen.ps1 -Label "soap-gate-demo"

    The PNG path is printed on stdout so the caller can pick it up
    and feed it into a downstream tool (Claude vision · Roboflow ·
    a chat attachment).
#>

param(
    [string]$Label = "shot",
    [string]$OutDir = "docs/status/screenshots"
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)

if (-not (Test-Path $OutDir)) {
    New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
}

$stamp = Get-Date -Format "yyyy-MM-ddTHH-mm-ss"
$file = Join-Path $OutDir "$stamp-$Label.png"
$bitmap.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)

$graphics.Dispose()
$bitmap.Dispose()

Write-Output $file
