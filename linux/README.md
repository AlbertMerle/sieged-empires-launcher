# Linux builds

| Path | Contents |
|------|----------|
| `linux/LinuxSetup/` | `SiegedEmpires-*-linux.deb` — normal package installer |

## How it works

1. Install the `.deb` → **Sieged Empires** appears in the app menu
2. Open the app → sign in (or detect Minecraft Launcher accounts)
3. Press **Play** → download/update pack (progress bar) → launch game

```bash
cd installer
npm run dist:linux
```
