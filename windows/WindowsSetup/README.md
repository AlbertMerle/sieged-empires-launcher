# Windows MSI

Output folder: `windows/WindowsSetup/`

## Release Download

- **[Download Sieged-Empires-1.0.1-Windows.msi](https://github.com/AlbertMerle/sieged-empires-launcher/releases/download/v1.0.1/Sieged-Empires-1.0.1-Windows.msi)** (GitHub Release)
- **[Latest Release Assets](https://github.com/AlbertMerle/sieged-empires-launcher/releases/latest)**

## Install

Run `Sieged-Empires-1.0.1-Windows.msi` — standard Windows installer with Desktop and Start Menu shortcuts for **Sieged Empires**. A newer version MSI upgrades the existing launcher in place.

Default game data: `%APPDATA%\sieged-empires`

## Build

Build **on a Windows PC** (WiX / MSI packaging) or via GitHub Actions CI:

```bat
cd installer
npm install
npm run dist:win
```
