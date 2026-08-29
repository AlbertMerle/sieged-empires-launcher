#!/usr/bin/env bash
# Manual inside-out ad-hoc sign for a prepackaged .app (Option B / recovery only).
# Normal releases use identity "-" in MacOS/setup-builder.json — electron-builder signs before DMG.
set -euo pipefail

APP="${1:?Usage: sign-mac-app.sh path/to/App.app}"
if [[ ! -d "$APP" ]]; then
  echo "ERROR: not a directory: $APP" >&2
  exit 1
fi

sign() {
  codesign --force --sign - "$1" 2>/dev/null || true
}

echo "Ad-hoc signing $APP …"

# Dylibs and Mach-O helpers first (deepest paths first).
while IFS= read -r -d '' f; do
  sign "$f"
done < <(find "$APP/Contents" -type f \( -name "*.dylib" -o -name "*.node" \) -print0 | sort -rz)

while IFS= read -r -d '' f; do
  [[ -x "$f" ]] || continue
  sign "$f"
done < <(find "$APP/Contents/Frameworks" -type f -perm -111 -print0 2>/dev/null | sort -rz)

# Nested helper .app bundles (Electron Helper, GPU, Plugin, Renderer).
while IFS= read -r -d '' helper; do
  sign "$helper"
done < <(find "$APP/Contents/Frameworks" -name "*.app" -print0 2>/dev/null)

# Framework bundles.
while IFS= read -r -d '' fw; do
  sign "$fw"
done < <(find "$APP/Contents/Frameworks" -name "*.framework" -print0 2>/dev/null)

# Main executable + outer bundle.
sign "$APP/Contents/MacOS/"*
sign "$APP"

echo "Architecture:"
lipo -info "$APP/Contents/MacOS/"* 2>/dev/null || file "$APP/Contents/MacOS/"*
codesign --verify --deep "$APP" 2>/dev/null && echo "codesign verify: OK" || echo "codesign verify: unsigned (expected)"
