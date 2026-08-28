# Sieged Empires launcher

**This is our own launcher.** Players only need the `.deb` (Linux), `.msi` (Windows), or `.zip`/`.dmg` (macOS). No CurseForge, no Overwolf, no other launchers.

## Release Downloads (v1.0.0)

| Platform | Installer | Download Link |
|----------|-----------|---------------|
| **Linux** | `.deb` Package | [SiegedEmpires-1.0.0-linux.deb](https://github.com/AlbertMerle/sieged-empires-launcher/releases/download/v1.0.0/SiegedEmpires-1.0.0-linux.deb) |
| **Windows** | `.msi` Installer | [Sieged-Empires-1.0.0-Windows.msi](https://github.com/AlbertMerle/sieged-empires-launcher/releases/download/v1.0.0/Sieged-Empires-1.0.0-Windows.msi) |
| **macOS** | Universal `.zip` | [SiegedEmpires-1.0.0-mac.zip](https://github.com/AlbertMerle/sieged-empires-launcher/releases/download/v1.0.0/SiegedEmpires-1.0.0-mac.zip) |

View all artifacts and release notes on the **[GitHub Releases](https://github.com/AlbertMerle/sieged-empires-launcher/releases/tag/v1.0.0)** page.

## What players do

1. Install `SiegedEmpires-1.0.0-linux.deb`, `Sieged-Empires-1.0.0-Windows.msi`, or unzip `SiegedEmpires-1.0.0-mac.zip`
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
npm run dist:mac:zip # → MacOS/MacOSSetup/SiegedEmpires-*-mac.zip (build universal zip on Linux)
npm start            # run launcher in dev
```

macOS signing/notarization requires a Mac or GitHub Actions `macos-latest` — see `MacOS/README.md`.
