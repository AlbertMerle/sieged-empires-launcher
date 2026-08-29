#!/usr/bin/env bash
# Unsigned macOS build — run on a Mac only (friend machine or GitHub Actions macos-*).
# Produces a universal (Intel + Apple Silicon) .app, .dmg, and .zip.
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

npm run dist:mac

APP_GLOB="MacOS/MacOSSetup/mac/Sieged Empires.app"
if compgen -G "$APP_GLOB" > /dev/null; then
  APP_PATH="$APP_GLOB"
  echo "Ad-hoc signing app bundle (helps Gatekeeper on unsigned builds)…"
  codesign --force --deep --sign - "$APP_PATH" || true
fi

ZIP_GLOB="MacOS/MacOSSetup/SiegedEmpires-*-mac.zip"
if compgen -G "$ZIP_GLOB" > /dev/null; then
  chmod +x "MacOS/Launch Sieged Empires.command"
  for z in $ZIP_GLOB; do
    zip -j -u "$z" "MacOS/Launch Sieged Empires.command" || true
  done
fi

echo ""
echo "Done. Artifacts:"
ls -la MacOS/MacOSSetup/SiegedEmpires-*-mac.dmg MacOS/MacOSSetup/SiegedEmpires-*-mac.zip 2>/dev/null || ls -la MacOS/MacOSSetup/
if [[ -f "$APP_PATH/Contents/MacOS/Sieged Empires" ]]; then
  echo ""
  echo "Architecture:"
  lipo -info "$APP_PATH/Contents/MacOS/Sieged Empires" || file "$APP_PATH/Contents/MacOS/Sieged Empires"
fi
echo ""
echo "Friend open instructions: see MacOS/FRIEND-ONE-SHOT.md"
