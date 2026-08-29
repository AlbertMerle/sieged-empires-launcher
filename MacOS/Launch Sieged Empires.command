#!/bin/bash
# First-time helper for unsigned macOS builds (Gatekeeper / quarantine).
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
APP="$DIR/Sieged Empires.app"
if [[ ! -d "$APP" ]]; then
  osascript -e 'display alert "Sieged Empires.app not found" message "Unzip the download so this script sits next to Sieged Empires.app, then run it again."'
  exit 1
fi
xattr -cr "$APP" 2>/dev/null || true
open "$APP"
