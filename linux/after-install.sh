#!/bin/bash
# After .deb install: sandbox, wrapper in PATH, icons, desktop shortcuts.
set -u

APP_DIR="/opt/sieged-empires"
APP_BIN="$APP_DIR/sieged-empires"
SANDBOX="$APP_DIR/chrome-sandbox"
WRAPPER="/usr/bin/sieged-empires"
ICON_SRC="/usr/share/icons/hicolor/1024x1024/apps/sieged-empires.png"

# Back-compat for any leftover shortcut still pointing at the spaced path.
if [ -d "$APP_DIR" ] && [ ! -e "/opt/Sieged Empires" ]; then
  ln -sfn "$APP_DIR" "/opt/Sieged Empires" 2>/dev/null || true
fi

if [ -f "$SANDBOX" ]; then
  chown root:root "$SANDBOX" 2>/dev/null || true
  chmod 4755 "$SANDBOX" 2>/dev/null || true
fi

# Simple PATH wrapper — GNOME Exec must NOT use `env … "quoted path"` (breaks launches).
cat > "$WRAPPER" <<'EOF'
#!/bin/bash
export ELECTRON_DISABLE_SANDBOX=1
# Prefer new path; fall back to legacy symlink if present.
if [ -x /opt/sieged-empires/sieged-empires ]; then
  exec /opt/sieged-empires/sieged-empires --no-sandbox "$@"
elif [ -x "/opt/Sieged Empires/sieged-empires" ]; then
  exec "/opt/Sieged Empires/sieged-empires" --no-sandbox "$@"
else
  echo "Sieged Empires is not installed under /opt/sieged-empires" >&2
  exit 1
fi
EOF
chmod 755 "$WRAPPER"

# Extra icon sizes so the menu shows the real logo (1024-only is flaky in GNOME).
# Note: avoid ${...} here — electron-builder treats those as fpm macros at package time.
if [ -f "$ICON_SRC" ] && command -v convert >/dev/null 2>&1; then
  for s in 256 128 64 48 32; do
    mkdir -p "/usr/share/icons/hicolor/"$s"x"$s"/apps"
    convert "$ICON_SRC" -resize "$s"x"$s" \
      "/usr/share/icons/hicolor/"$s"x"$s"/apps/sieged-empires.png" 2>/dev/null || true
  done
elif [ -f "$ICON_SRC" ]; then
  for s in 256 128 64 48 32; do
    mkdir -p "/usr/share/icons/hicolor/"$s"x"$s"/apps"
    cp -f "$ICON_SRC" "/usr/share/icons/hicolor/"$s"x"$s"/apps/sieged-empires.png" 2>/dev/null || true
  done
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -f /usr/share/icons/hicolor 2>/dev/null || true
fi

write_desktop() {
  local dest="$1"
  local icon="$2"
  cat > "$dest" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=Sieged Empires
GenericName=Sieged Empires
Comment=Sieged Empires launcher
Exec=$WRAPPER %U
Icon=$icon
Terminal=false
Categories=Game;
StartupWMClass=Sieged Empires
StartupNotify=true
EOF
  chmod 644 "$dest" 2>/dev/null || true
}

SYS_DESKTOP="/usr/share/applications/sieged-empires.desktop"
write_desktop "$SYS_DESKTOP" "sieged-empires"

# Resolve installing / logged-in user (dpkg often has no SUDO_USER).
REAL_USER="${SUDO_USER:-}"
if [ -z "$REAL_USER" ] || [ "$REAL_USER" = "root" ]; then
  REAL_USER="$(logname 2>/dev/null || true)"
fi
if [ -z "$REAL_USER" ] || [ "$REAL_USER" = "root" ]; then
  REAL_USER="$(who 2>/dev/null | awk 'NR==1 {print $1; exit}')"
fi
if [ -z "$REAL_USER" ] || [ "$REAL_USER" = "root" ]; then
  if command -v loginctl >/dev/null 2>&1; then
    REAL_USER="$(loginctl list-sessions --no-legend 2>/dev/null | awk '$3!="root" && $3!="" {print $3; exit}')"
  fi
fi
if [ -z "$REAL_USER" ] || [ "$REAL_USER" = "root" ]; then
  if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database /usr/share/applications 2>/dev/null || true
  fi
  exit 0
fi

USER_HOME="$(getent passwd "$REAL_USER" | cut -d: -f6 || true)"
if [ -z "$USER_HOME" ] || [ ! -d "$USER_HOME" ]; then
  exit 0
fi

PACK="$APP_DIR/resources/pack"
TARGET="$USER_HOME/Games/sieged-empires"

mkdir -p "$TARGET/mods" "$TARGET/config" || true

if [ -d "$PACK/mods" ]; then
  cp -a "$PACK/mods/." "$TARGET/mods/" 2>/dev/null || true
fi
if [ -d "$PACK/config" ]; then
  cp -a "$PACK/config/." "$TARGET/config/" 2>/dev/null || true
fi
if [ -f "$PACK/options.txt" ]; then
  cp -f "$PACK/options.txt" "$TARGET/options.txt" 2>/dev/null || true
fi
if [ -f "$PACK/pack-manifest.json" ]; then
  cp -f "$PACK/pack-manifest.json" "$TARGET/pack-manifest.json" 2>/dev/null || true
fi

# Per-user launcher + icon (works even if /usr/bin wrapper is missing).
USER_LAUNCHER="$TARGET/run-launcher.sh"
USER_ICON="$TARGET/icon.png"
APP_ICON="$APP_DIR/resources/assets/icon-transparent.png"
if [ -f "$APP_ICON" ]; then
  cp -f "$APP_ICON" "$USER_ICON" 2>/dev/null || true
elif [ -f "$ICON_SRC" ]; then
  cp -f "$ICON_SRC" "$USER_ICON" 2>/dev/null || true
fi
cat > "$USER_LAUNCHER" <<EOF
#!/bin/bash
export ELECTRON_DISABLE_SANDBOX=1
export SE_INSTALL_DIR="$TARGET"
exec /opt/sieged-empires/sieged-empires --no-sandbox "\$@"
EOF
chmod 755 "$USER_LAUNCHER" 2>/dev/null || true

chown -R "$REAL_USER":"$REAL_USER" "$USER_HOME/Games" 2>/dev/null || true

DESKTOP_DIR="$USER_HOME/.local/share/applications"
mkdir -p "$DESKTOP_DIR" || true

ICON_FOR_USER="sieged-empires"
if [ -f "$USER_ICON" ]; then
  ICON_FOR_USER="$USER_ICON"
fi

USER_DESKTOP="$DESKTOP_DIR/sieged-empires.desktop"
cat > "$USER_DESKTOP" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=Sieged Empires
GenericName=Sieged Empires
Comment=Sieged Empires launcher
Exec=$USER_LAUNCHER %U
Icon=$ICON_FOR_USER
Path=$TARGET
Terminal=false
Categories=Game;
StartupWMClass=Sieged Empires
StartupNotify=true
EOF
chmod 755 "$USER_DESKTOP" 2>/dev/null || true

# Also drop a trusted Desktop shortcut so it's obvious.
DESKTOP_FOLDER="$USER_HOME/Desktop"
if [ -d "$DESKTOP_FOLDER" ]; then
  HOME_DESKTOP="$DESKTOP_FOLDER/Sieged Empires.desktop"
  cp -f "$USER_DESKTOP" "$HOME_DESKTOP" 2>/dev/null || true
  chmod 755 "$HOME_DESKTOP" 2>/dev/null || true
  chown "$REAL_USER":"$REAL_USER" "$HOME_DESKTOP" 2>/dev/null || true
fi

rm -f "$DESKTOP_DIR/Sieged Empires.desktop" \
      "$DESKTOP_DIR/sieged-empires-setup.desktop" \
      "$DESKTOP_DIR/sieged-empires-launcher.desktop" 2>/dev/null || true

chown "$REAL_USER":"$REAL_USER" "$USER_DESKTOP" "$USER_LAUNCHER" 2>/dev/null || true
[ -f "$USER_ICON" ] && chown "$REAL_USER":"$REAL_USER" "$USER_ICON" 2>/dev/null || true

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$DESKTOP_DIR" 2>/dev/null || true
  update-desktop-database /usr/share/applications 2>/dev/null || true
fi

exit 0
