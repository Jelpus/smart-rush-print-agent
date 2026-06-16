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

find_node() {
  if command -v node >/dev/null 2>&1; then
    command -v node
    return 0
  fi

  for candidate in "/opt/homebrew/bin/node" "/usr/local/bin/node"; do
    if [ -x "$candidate" ]; then
      echo "$candidate"
      return 0
    fi
  done

  return 1
}

NODE_BIN="$(find_node || true)"

if [ -z "$NODE_BIN" ]; then
  echo "No se encontro Node.js."
  echo "Primero ejecuta install-macos.command para instalar SmartRush Print Agent."
  echo "Si ya lo ejecutaste, instala Node.js LTS desde https://nodejs.org/en/download y vuelve a probar."
  echo ""
  echo "Pulsa cualquier tecla para cerrar."
  read -r -n 1
  exit 1
fi

cd "$APP_DIR"
"$NODE_BIN" scripts/check-agent.js
echo ""
echo "Pulsa cualquier tecla para cerrar."
read -r -n 1
