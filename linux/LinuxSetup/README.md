# Linux `.deb`

Ordinary package: installs **Sieged Empires** with the custom icon.

```bash
sudo dpkg -i SiegedEmpires-*-linux.deb
sieged-empires
```

Login + download happen **inside the app** (not during `dpkg`).

Build: `cd installer && npm run dist:linux`
