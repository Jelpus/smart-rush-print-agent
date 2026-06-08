$ErrorActionPreference = "Stop"

$AppName = "SmartRush Print Agent"
$LocalDir = Join-Path $PSScriptRoot "SmartRushPrintAgent"
$InstalledDir = Join-Path $env:LOCALAPPDATA $AppName

if (Test-Path $InstalledDir) {
  $AppDir = $InstalledDir
} elseif (Test-Path $LocalDir) {
  $AppDir = $LocalDir
} else {
  throw "No se encontro SmartRush Print Agent."
}

Push-Location $AppDir
node scripts/check-agent.js
Pop-Location

Read-Host "Pulsa Enter para cerrar"
