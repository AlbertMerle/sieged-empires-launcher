# Linux `.deb`

Ordinary package: installs **Sieged Empires** with the custom icon and desktop integration.

## Release Download

- **[Download SiegedEmpires-1.0.1-linux.deb](https://github.com/AlbertMerle/sieged-empires-launcher/releases/download/v1.0.1/SiegedEmpires-1.0.1-linux.deb)** (GitHub Release)
- **[Latest Release Assets](https://github.com/AlbertMerle/sieged-empires-launcher/releases/latest)**

## Install

```bash
sudo dpkg -i SiegedEmpires-1.0.1-linux.deb
sieged-empires
```

Login + pack download happen **inside the app** (not during `dpkg`).

## Build

```bash
cd installer
npm run dist:linux
```
