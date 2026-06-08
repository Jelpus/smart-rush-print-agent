#!/bin/bash
set -euo pipefail

APP_NAME="SmartRush Print Agent"
LABEL="io.smartrush.print-agent"
SOURCE_DIR="$(cd "$(dirname "$0")/SmartRushPrintAgent" && pwd)"
APP_DIR="$HOME/Library/Application Support/$APP_NAME"
LOG_DIR="$HOME/Library/Logs/SmartRushPrintAgent"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

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

find_npm() {
  if command -v npm >/dev/null 2>&1; then
    command -v npm
    return 0
  fi

  for candidate in "/opt/homebrew/bin/npm" "/usr/local/bin/npm"; do
    if [ -x "$candidate" ]; then
      echo "$candidate"
      return 0
    fi
  done

  return 1
}

NODE_BIN="$(find_node || true)"
NPM_BIN="$(find_npm || true)"

if [ -z "$NODE_BIN" ] || [ -z "$NPM_BIN" ]; then
  if ! command -v brew >/dev/null 2>&1; then
    osascript -e 'display dialog "SmartRush Print Agent instalara Homebrew y Node.js. Es posible que macOS pida tu password." buttons {"OK"} default button "OK"'
    NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

    if [ -x "/opt/homebrew/bin/brew" ]; then
      eval "$(/opt/homebrew/bin/brew shellenv)"
    elif [ -x "/usr/local/bin/brew" ]; then
      eval "$(/usr/local/bin/brew shellenv)"
    fi
  fi

  brew install node
  NODE_BIN="$(find_node || true)"
  NPM_BIN="$(find_npm || true)"
fi

if [ -z "$NODE_BIN" ] || [ -z "$NPM_BIN" ]; then
  osascript -e 'display dialog "No se pudo instalar Node.js automaticamente. Se abrira la pagina de descarga. Instala Node.js LTS y vuelve a ejecutar este instalador." buttons {"OK"} default button "OK"'
  open "https://nodejs.org/en/download"
  exit 1
fi

mkdir -p "$APP_DIR" "$LOG_DIR" "$HOME/Library/LaunchAgents"
rsync -a --delete "$SOURCE_DIR/" "$APP_DIR/"

cd "$APP_DIR"
"$NPM_BIN" install --omit=dev
"$NODE_BIN" scripts/check-agent.js

LAUNCHER="$APP_DIR/run-agent.command"
cat > "$LAUNCHER" <<LAUNCHER
#!/bin/bash
cd "$APP_DIR"
exec "$NODE_BIN" "$APP_DIR/src/index.js"
LAUNCHER
chmod +x "$LAUNCHER"

if [ -f "$PLIST" ]; then
  launchctl bootout "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || launchctl unload "$PLIST" >/dev/null 2>&1 || true
fi

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$LAUNCHER</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$APP_DIR</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/agent.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/agent.err.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
</dict>
</plist>
PLIST

launchctl bootstrap "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || launchctl load "$PLIST"
launchctl kickstart -k "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true

osascript -e 'display dialog "SmartRush Print Agent instalado y ejecutandose. Puedes cerrar esta ventana." buttons {"OK"} default button "OK"'
echo "Installed at: $APP_DIR"
echo "Logs: $LOG_DIR"
