# macOS builds

| Path | Contents |
|------|----------|
| `MacOS/MacOSSetup/` | `SiegedEmpires-*-mac.dmg` after build |
| `FRIEND-ONE-SHOT.md` | One-shot build + Gatekeeper open for a Mac friend |
| `github-actions-macos-unsigned.yml` | Copy to `.github/workflows/` when the project is on GitHub |

Same Electron launcher as Linux and Windows: Microsoft login → Play → CDN pack + SE overrides → Minecraft.

## Universal pack (same as Linux)

Mac builds use **`installer/files/manifest.json`** — identical mod list (Voxy, SE overrides, etc.) to the Linux `.deb` and Windows MSI. There is no separate Mac-only manifest in normal builds.

Legacy Mac-only manifest (Distant Horizons instead of Voxy) lives under `MacOS/files/` and is only used if you explicitly run `npm run prepare:pack:mac-legacy` — not recommended.

## Build commands

| Command | Where | Output |
|---------|-------|--------|
| `npm run dist:mac` | **macOS only** | universal `.dmg` |
| `npm run dist:mac:zip` | Linux or macOS | Intel-only `.zip` (dev; not for Apple Silicon release) |
| `./scripts/build-mac-unsigned.sh` | macOS | universal `.dmg` |

On **Linux**, `dist:mac` fails at DMG creation (`sips` is macOS-only). Ship Mac releases via **GitHub Actions `macos-unsigned.yml`** or a Mac friend running `build-mac-unsigned.sh`.

### Tools (electron-builder)

| Need | Tool |
|------|------|
| Package `.app` + `.dmg` | `electron-builder` (v26 in `package.json`) |
| Skip ad-hoc signing (friend test) | `CSC_IDENTITY_AUTO_DISCOVERY=false` + `"identity": "-"` in `setup-builder.json` |
| Avoid ad-hoc crash on EB 26 | `"hardenedRuntime": false` (required with identity `"-"`) |
| Free Mac build VM | GitHub Actions `macos-latest` |
| Cert later (public ship) | Apple Developer ID + `CSC_LINK` / notarize env vars |

### Recommended paths

**From Linux (zip only):**

```bash
cd installer
npm run dist:mac:zip
# → MacOS/MacOSSetup/SiegedEmpires-1.0.0-mac.zip
```

**On a Mac (dmg + zip):**

```bash
cd installer
chmod +x scripts/build-mac-unsigned.sh
./scripts/build-mac-unsigned.sh
```

**GitHub Actions:** copy `github-actions-macos-unsigned.yml` → `.github/workflows/macos-unsigned.yml`, run workflow, download artifact.

Game data on Mac: `~/Library/Application Support/sieged-empires`.
