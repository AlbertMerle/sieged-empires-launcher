# Windows builds

Output directory for Sieged Empires **Windows** installers:

| Path | Contents |
|------|----------|
| `windows/WindowsSetup/` | `Sieged-Empires-*-Windows.msi` — normal installer |

## How it works

Same as Linux:

1. Install the `.msi` → **Sieged Empires** appears on the Desktop and in the Start Menu
2. Open the app → sign in with Microsoft (or detect Minecraft Launcher accounts)
3. Press **Play** → download/update pack (progress bar) → launch game

Login + CDN pack download happen **inside the app** (not during MSI install). Third-party mods are not bundled.

```bat
cd installer
npm install
npm run dist:win
```

Produces `windows/WindowsSetup/Sieged-Empires-${version}-Windows.msi` (currently 1.0.0).

Re-running a **newer-version** MSI replaces the installed launcher (same Start Menu / Desktop shortcuts). Game data in `%APPDATA%\sieged-empires` (login, worlds, downloaded mods) is left in place. Mods still update on **Play**, not during MSI install. Same-version repair does not reliably replace launcher files — bump `package.json` version when shipping a fix.

Default game data: `%APPDATA%\sieged-empires`

Login file: `%APPDATA%\sieged-empires\savedlogins.json`

Shortcuts: Start Menu + Desktop **Sieged Empires**
