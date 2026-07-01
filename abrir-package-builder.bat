@echo off
setlocal
title SmartRush Package Builder

cd /d "%~dp0"

set "PORT=4500"
if not "%PACKAGE_UI_PORT%"=="" set "PORT=%PACKAGE_UI_PORT%"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js no esta disponible en el PATH.
  echo Instala Node.js o abre este proyecto desde una terminal donde node funcione.
  pause
  exit /b 1
)

echo Iniciando SmartRush Package Builder desde http://127.0.0.1:%PORT%
echo Si ese puerto esta bloqueado, se usara el siguiente disponible.
echo Cierra esta ventana para detener el servidor.
echo.

node scripts\package-ui.js

echo.
echo El servidor se detuvo.
pause
