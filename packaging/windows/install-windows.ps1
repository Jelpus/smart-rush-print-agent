$ErrorActionPreference = "Stop"

$AppName = "SmartRush Print Agent"
$SourceDir = Join-Path $PSScriptRoot "SmartRushPrintAgent"
$AppDir = Join-Path $env:LOCALAPPDATA $AppName
$LogDir = Join-Path $AppDir "logs"
$StartupDir = [Environment]::GetFolderPath("Startup")
$ShortcutPath = Join-Path $StartupDir "SmartRush Print Agent.lnk"

function Find-Node {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }

  $candidates = @(
    "$env:ProgramFiles\nodejs\node.exe",
    "${env:ProgramFiles(x86)}\nodejs\node.exe"
  )

  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) { return $candidate }
  }

  return $null
}

function Find-Npm {
  $cmd = Get-Command npm -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }

  $candidates = @(
    "$env:ProgramFiles\nodejs\npm.cmd",
    "${env:ProgramFiles(x86)}\nodejs\npm.cmd"
  )

  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) { return $candidate }
  }

  return $null
}

function Install-Node {
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if (-not $winget) {
    Start-Process "https://nodejs.org/en/download"
    throw "No se encontro Node.js ni winget. Instala Node.js LTS y vuelve a ejecutar este instalador."
  }

  Write-Host "Instalando Node.js LTS..."
  winget install OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
}

function Stop-ExistingAgent {
  Write-Host "Deteniendo SmartRush Print Agent anterior si existe..."

  Remove-Item -LiteralPath $ShortcutPath -Force -ErrorAction SilentlyContinue

  $processes = Get-CimInstance Win32_Process | Where-Object {
    $_.CommandLine -and (
      $_.CommandLine -like "*$AppDir*" -or
      $_.CommandLine -like "*run-agent.cmd*" -or
      $_.CommandLine -like "*run-agent-hidden.vbs*"
    )
  }

  foreach ($process in $processes) {
    if ($process.ProcessId -eq $PID) { continue }
    Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
  }
}

$node = Find-Node
$npm = Find-Npm

if (-not $node -or -not $npm) {
  Install-Node
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
  $node = Find-Node
  $npm = Find-Npm
}

if (-not $node -or -not $npm) {
  throw "No se pudo encontrar Node.js despues de instalarlo."
}

Stop-ExistingAgent

New-Item -ItemType Directory -Path $AppDir -Force | Out-Null
New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
Copy-Item -Path "$SourceDir\*" -Destination $AppDir -Recurse -Force

Push-Location $AppDir
& $npm install --omit=dev
& $node scripts/check-agent.js
Pop-Location

$LauncherPath = Join-Path $AppDir "run-agent.cmd"
$VbsPath = Join-Path $AppDir "run-agent-hidden.vbs"

@"
@echo off
cd /d "$AppDir"
set EXIT_CODE=0
:loop
"$node" "$AppDir\src\index.js" >> "$LogDir\agent.log" 2>> "$LogDir\agent.err.log"
set EXIT_CODE=%ERRORLEVEL%
if "%EXIT_CODE%"=="42" (
  timeout /t 3 /nobreak >nul
  goto loop
)
"@ | Set-Content -Path $LauncherPath -Encoding ASCII

@"
Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = "$AppDir"
shell.Run "cmd.exe /c ""$LauncherPath""", 0, False
"@ | Set-Content -Path $VbsPath -Encoding ASCII

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($ShortcutPath)
$shortcut.TargetPath = "$env:WINDIR\System32\wscript.exe"
$shortcut.Arguments = "`"$VbsPath`""
$shortcut.WorkingDirectory = $AppDir
$shortcut.WindowStyle = 7
$shortcut.Save()

Start-Process -FilePath "$env:WINDIR\System32\wscript.exe" -ArgumentList "`"$VbsPath`""

Write-Host "SmartRush Print Agent instalado y ejecutandose."
Write-Host "Carpeta: $AppDir"
Write-Host "Logs: $LogDir"
Read-Host "Pulsa Enter para cerrar"
