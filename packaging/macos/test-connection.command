#!/bin/bash
set -euo pipefail

APP_NAME="SmartRush Print Agent"
LOCAL_DIR="$(cd "$(dirname "$0")/SmartRushPrintAgent" 2>/dev/null && pwd || true)"
INSTALLED_DIR="$HOME/Library/Application Support/$APP_NAME"

if [ -d "$INSTALLED_DIR" ]; then
  APP_DIR="$INSTALLED_DIR"
elif [ -d "$LOCAL_DIR" ]; then
  APP_DIR="$LOCAL_DIR"
else
  echo "No se encontro SmartRush Print Agent."
  exit 1
fi

cd "$APP_DIR"
node scripts/check-agent.js
echo ""
echo "Pulsa cualquier tecla para cerrar."
read -r -n 1
