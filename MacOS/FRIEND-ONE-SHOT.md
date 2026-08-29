# Friend one-shot — build + open Sieged Empires on Mac

You only need this once. No Apple Developer account. No signing.

## Tools (from electron-builder / GitHub Actions practice)

| Tool | Role |
|------|------|
| **Node.js 20+** | Run npm / electron-builder |
| **electron-builder** (already in `package.json`) | Packages the same Electron launcher as Linux into `.dmg` + `.zip` |
| **A real Mac** | Required to produce darwin binaries (your machine, friend’s Mac, or GitHub `macos-latest`) |
| **Env `CSC_IDENTITY_AUTO_DISCOVERY=false`** | Skip looking for a signing cert |
| **`mac.identity: null`** | Unsigned build (already in `setup-builder.json`) |
| **`mac.hardenedRuntime: false`** | Avoid Electron-builder 26 crash with unsigned apps |

You do **not** need Xcode for an unsigned friend build (electron-builder downloads what it needs).

## On the Mac (build)

1. Install Node from https://nodejs.org (LTS).
2. Copy the whole `installer/` folder to the Mac (USB, zip, etc.). Keep `files/` and `assets/` — do **not** need `node_modules/` or `linux/LinuxSetup/`.
3. In Terminal:

```bash
cd /path/to/installer
chmod +x scripts/build-mac-unsigned.sh
./scripts/build-mac-unsigned.sh
```

4. Send back (or keep):

- `MacOS/MacOSSetup/SiegedEmpires-1.0.0-mac.dmg`
- (optional) `SiegedEmpires-1.0.0-mac.zip`

## On the Mac (open — Gatekeeper)

Unsigned apps are blocked until opened once this way:

1. Open the `.zip` and keep **`Launch Sieged Empires.command`** next to **`Sieged Empires.app`** (both in the same folder).
2. **Double-click `Launch Sieged Empires.command`** the first time (clears quarantine and opens the app).
3. Or: **Right-click** the app → **Open** → **Open** again in the dialog.
4. Move the app to `/Applications` after the first successful launch if you like.

If it still says “damaged”: System Settings → Privacy & Security → allow, or:

```bash
xattr -cr "/path/to/Sieged Empires.app"
```

Then use **Launch Sieged Empires.command** or right-click → Open again.

**Apple Silicon (M1/M2/M3):** Use a **universal** build from GitHub Actions or a Mac (`npm run dist:mac`). Linux-only `dist:mac:zip` is Intel-only and will not open on Apple Silicon without Rosetta.

## What “working” looks like

Same as Linux: Microsoft sign-in → **Play** → pack download → Minecraft launches. Game data: `~/Library/Application Support/sieged-empires`.

## Later (public download page)

Needs Apple Developer Program (~$99/yr) + signed/notarized build on macOS CI (`CSC_LINK`, `APPLE_ID`, etc.). Friend-test does not need that.
