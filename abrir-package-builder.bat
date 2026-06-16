@echo off
setlocal
title SmartRush Package Builder

cd /d "%~dp0"

set "PORT=4310"
if not "%PACKAGE_UI_PORT%"=="" set "PORT=%PACKAGE_UI_PORT%"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js no esta disponible en el PATH.
  echo Instala Node.js o abre este proyecto desde una terminal donde node funcione.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$port = [int]$env:PORT; " ^
  "$url = 'http://localhost:' + $port; " ^
  "$listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue; " ^
  "if ($listener) { Start-Process $url; exit 10 }"

if "%ERRORLEVEL%"=="10" (
  echo SmartRush Package Builder ya estaba corriendo.
  echo Abriendo http://localhost:%PORT%
  pause
  exit /b 0
)

echo Iniciando SmartRush Package Builder en http://localhost:%PORT%
echo Cierra esta ventana para detener el servidor.
echo.

node scripts\package-ui.js

echo.
echo El servidor se detuvo.
pause
