# macOS `.zip` & `.dmg`

Output folder: `MacOS/MacOSSetup/`

## Release Download

- **[Download SiegedEmpires-1.0.1-mac.zip](https://github.com/AlbertMerle/sieged-empires-launcher/releases/download/v1.0.1/SiegedEmpires-1.0.1-mac.zip)** (Universal macOS App - GitHub Release)
- **[Latest Release Assets](https://github.com/AlbertMerle/sieged-empires-launcher/releases/latest)**

## Install

1. Download and unzip `SiegedEmpires-1.0.1-mac.zip`
2. Move `Sieged Empires.app` to your `/Applications` folder
3. Launch **Sieged Empires**

Game data: `~/Library/Application Support/sieged-empires`

## Build

Artifacts appear here after a successful build on **macOS** (local Mac or GitHub Actions `macos-latest`):

- `SiegedEmpires-*-mac.dmg`
- `SiegedEmpires-*-mac.zip`

On Linux (Intel-only zip — **not for Apple Silicon release**):
```bash
npm run dist:mac:zip
```
Ship Mac releases from **GitHub Actions `macos-latest`** or `./scripts/build-mac-unsigned.sh` on a real Mac (universal Intel + Apple Silicon).
