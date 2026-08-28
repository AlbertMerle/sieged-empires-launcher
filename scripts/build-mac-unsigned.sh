#!/usr/bin/env bash
# Unsigned macOS build — run on a Mac only (friend machine or GitHub Actions macos-*).
# Sources: electron-builder docs + community Actions workflows (CSC_IDENTITY_AUTO_DISCOVERY,
# identity:null, hardenedRuntime:false for unsigned EB 26).
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "ERROR: macOS builds must run on a Mac (Apple codesign / Electron darwin binaries)."
  echo "On Linux use GitHub Actions macos-latest, or ask a Mac friend to run this script."
  exit 1
fi

export CSC_IDENTITY_AUTO_DISCOVERY=false

if [[ ! -d node_modules/electron-builder ]]; then
  npm ci
fi

if [[ "$(uname -m)" == "arm64" ]]; then
  export npm_config_arch=arm64
fi

npm run dist:mac

echo ""
echo "Done. Artifacts:"
ls -la MacOS/MacOSSetup/SiegedEmpires-*-mac.dmg MacOS/MacOSSetup/SiegedEmpires-*-mac.zip 2>/dev/null || ls -la MacOS/MacOSSetup/
echo ""
echo "Friend open instructions: see MacOS/FRIEND-ONE-SHOT.md"
