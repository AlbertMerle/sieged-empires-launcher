#!/usr/bin/env bash
# Ad-hoc signed macOS build — run on a Mac only (friend machine or GitHub Actions macos-*).
# electron-builder signs the .app during pack (identity "-"), then wraps it in a universal .dmg.
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

DMG=$(ls MacOS/MacOSSetup/SiegedEmpires-*-mac.dmg 2>/dev/null | head -1)
if [[ -n "$DMG" ]]; then
  MOUNT=$(hdiutil attach "$DMG" -nobrowse -readonly | grep -o '/Volumes/.*' | head -1)
  APP="$MOUNT/Sieged Empires.app"
  if [[ -d "$APP" ]]; then
    codesign --verify --deep --strict "$APP"
    echo "codesign verify: OK (app inside shipped DMG)"
  fi
  hdiutil detach "$MOUNT" 2>/dev/null || true
fi

echo ""
echo "Done. Artifacts:"
ls -la MacOS/MacOSSetup/SiegedEmpires-*-mac.dmg 2>/dev/null || ls -la MacOS/MacOSSetup/
echo ""
echo "Install: open the .dmg → drag Sieged Empires to Applications."
echo "First launch (ad-hoc signed): right-click the app → Open → Open."
