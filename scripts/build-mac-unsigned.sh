#!/usr/bin/env bash
# Unsigned macOS build — run on a Mac only (friend machine or GitHub Actions macos-*).
# Produces a universal (Intel + Apple Silicon) .dmg drag-to-Applications installer.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "ERROR: macOS builds must run on a Mac (Apple codesign / Electron darwin binaries)."
  echo "On Linux use GitHub Actions macos-latest (workflow: macos-unsigned.yml)."
  exit 1
fi

export CSC_IDENTITY_AUTO_DISCOVERY=false

if [[ ! -d node_modules/electron-builder ]]; then
  npm ci
fi

npm run dist:mac

APP_GLOB="MacOS/MacOSSetup/mac-universal/Sieged Empires.app"
if [[ ! -d "$APP_GLOB" ]]; then
  APP_GLOB="MacOS/MacOSSetup/mac/Sieged Empires.app"
fi
if [[ -d "$APP_GLOB" ]]; then
  bash scripts/sign-mac-app.sh "$APP_GLOB"
fi

echo ""
echo "Done. Artifacts:"
ls -la MacOS/MacOSSetup/SiegedEmpires-*-mac.dmg 2>/dev/null || ls -la MacOS/MacOSSetup/
echo ""
echo "Install: open the .dmg → drag Sieged Empires to Applications."
echo "First launch (unsigned): right-click the app → Open → Open."
