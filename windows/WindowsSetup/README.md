# Windows MSI

Output folder: `windows/WindowsSetup/`

Build **on a Windows PC** (WiX / MSI packaging does not work reliably under Wine):

```bat
cd installer
npm install
npm run dist:win
```

Produces `Sieged-Empires-*-Windows.msi` — normal installer with desktop + Start Menu shortcuts for **Sieged Empires**. A newer version MSI upgrades the existing launcher in place.

Default game data: `%APPDATA%\sieged-empires`
