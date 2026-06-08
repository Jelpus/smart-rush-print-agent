#!/bin/bash
set -euo pipefail

APP_NAME="SmartRush Print Agent"
LABEL="io.smartrush.print-agent"
APP_DIR="$HOME/Library/Application Support/$APP_NAME"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

if [ -f "$PLIST" ]; then
  launchctl bootout "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || launchctl unload "$PLIST" >/dev/null 2>&1 || true
  rm -f "$PLIST"
fi

rm -rf "$APP_DIR"

osascript -e 'display dialog "SmartRush Print Agent desinstalado." buttons {"OK"} default button "OK"'
echo "Uninstalled SmartRush Print Agent"
