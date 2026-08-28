# Sieged Empires launcher

**This is our own launcher.** Players only need the `.deb` (Linux), `.msi` (Windows), or `.dmg`/`.zip` (macOS). No CurseForge, no Overwolf, no other launchers.

## What players do

1. Install `SiegedEmpires-*-linux.deb`, `Sieged-Empires-*-Windows.msi`, or `SiegedEmpires-*-mac.dmg`
2. Open **Sieged Empires**
3. Sign in with Microsoft
4. Press **Play** → installs Java 25 if needed → download/update pack (progress bar) → launch game

Game data: Linux `~/Games/sieged-empires` · Windows `%APPDATA%\sieged-empires` · macOS `~/Library/Application Support/sieged-empires`

## Build

```bash
cd installer
npm run dist:linux   # → linux/LinuxSetup/SiegedEmpires-*-linux.deb
npm run dist:win     # → windows/WindowsSetup/Sieged-Empires-*-Windows.msi (build on Windows)
npm run dist:mac     # → MacOS/MacOSSetup/SiegedEmpires-*-mac.dmg (build on macOS / macOS CI)
npm start            # run launcher in dev
```

macOS signing/notarization requires a Mac or GitHub Actions `macos-latest` — see `MacOS/README.md`.
