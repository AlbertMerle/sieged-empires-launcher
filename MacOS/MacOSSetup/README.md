# macOS `.dmg`

Output folder: `MacOS/MacOSSetup/`

## Release Download

- **[Download SiegedEmpires-1.0.1-mac.dmg](https://github.com/AlbertMerle/sieged-empires-launcher/releases/download/v1.0.1/SiegedEmpires-1.0.1-mac.dmg)** (Universal macOS — Intel + Apple Silicon)
- **[Latest Release Assets](https://github.com/AlbertMerle/sieged-empires-launcher/releases/latest)**

## Install

1. Download `SiegedEmpires-1.0.1-mac.dmg` and open it
2. Drag **Sieged Empires** to **Applications**
3. **First launch only** (unsigned build): right-click the app → **Open** → **Open** again in the dialog  
   After that, double-click works normally.

Game data: `~/Library/Application Support/sieged-empires`

## Build

Artifacts appear here after a successful build on **macOS** (local Mac or GitHub Actions `macos-latest`):

- `SiegedEmpires-*-mac.dmg` — universal Intel + Apple Silicon

```bash
npm run dist:mac
# or
./scripts/build-mac-unsigned.sh
```

Dev-only on Linux (Intel `.zip`, not for Apple Silicon release):

```bash
npm run dist:mac:zip
```

Ship Mac releases from **GitHub Actions `macos-unsigned.yml`** or `./scripts/build-mac-unsigned.sh` on a real Mac.
