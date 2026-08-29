# Friend one-shot — build Sieged Empires `.dmg` on Mac

You only need this once. No Apple Developer account. No signing.

## Tools

| Tool | Role |
|------|------|
| **Node.js 20+** | Run npm / electron-builder |
| **electron-builder** (in `package.json`) | Packages the Electron launcher into a `.dmg` |
| **A real Mac** | Required for darwin binaries (your Mac, a friend's, or GitHub `macos-latest`) |
| **`CSC_IDENTITY_AUTO_DISCOVERY=false`** | Skip looking for a signing cert |
| **`mac.identity: null`** | Unsigned build (in `setup-builder.json`) |

You do **not** need Xcode for an unsigned friend build.

## On the Mac (build)

1. Install Node from https://nodejs.org (LTS).
2. Copy the whole `installer/` folder to the Mac (USB, zip, etc.). Keep `files/` and `assets/` — skip `node_modules/` and `linux/LinuxSetup/`.
3. In Terminal:

```bash
cd /path/to/installer
chmod +x scripts/build-mac-unsigned.sh scripts/sign-mac-app.sh
./scripts/build-mac-unsigned.sh
```

4. Send back: `MacOS/MacOSSetup/SiegedEmpires-1.0.1-mac.dmg`

## On the Mac (install + open)

1. Open the `.dmg`
2. Drag **Sieged Empires** to **Applications**
3. **First launch:** right-click the app → **Open** → **Open** (bypasses Gatekeeper for unsigned apps)
4. After the first successful launch, double-click works normally

If it still says “damaged”: System Settings → Privacy & Security → **Open Anyway**, or:

```bash
xattr -cr "/Applications/Sieged Empires.app"
```

## What “working” looks like

Same as Linux: Microsoft sign-in → **Play** → pack download → Minecraft launches. Game data: `~/Library/Application Support/sieged-empires`.

## Later (public download page)

Apple Developer Program (~$99/yr) + signed/notarized build on macOS CI for one-click open without right-click.
