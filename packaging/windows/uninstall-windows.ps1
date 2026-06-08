$ErrorActionPreference = "Stop"

$AppName = "SmartRush Print Agent"
$AppDir = Join-Path $env:LOCALAPPDATA $AppName
$StartupDir = [Environment]::GetFolderPath("Startup")
$ShortcutPath = Join-Path $StartupDir "SmartRush Print Agent.lnk"

Remove-Item -LiteralPath $ShortcutPath -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $AppDir -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "SmartRush Print Agent desinstalado."
Read-Host "Pulsa Enter para cerrar"
