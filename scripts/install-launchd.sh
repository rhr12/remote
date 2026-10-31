#!/bin/bash
# Installs Remote as a per-user launchd agent (starts at login, restarts on crash).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node)" || { echo "node not found in PATH"; exit 1; }
DEST="$HOME/Library/LaunchAgents/com.remote.server.plist"
mkdir -p "$ROOT/data" "$HOME/Library/LaunchAgents"
sed -e "s#__NODE__#$NODE#g" -e "s#__ROOT__#$ROOT#g" "$ROOT/deploy/com.remote.server.plist.template" > "$DEST"
launchctl bootout "gui/$(id -u)/com.remote.server" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$DEST"
echo "Installed. Logs: $ROOT/data/server.log   Stop: launchctl bootout gui/$(id -u)/com.remote.server"
