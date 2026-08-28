const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const { spawn } = require('child_process');
const {
  loadManifest,
  manifestFingerprint,
  expectedModFilenames,
  bundledOverridesDir,
  bundledConfigDir,
} = require('./manifest');
const { writeInstallMeta } = require('./install-meta');
const {
  modsDir,
  configDir,
  launcherAppDir,
  packManifestPath,
  instanceDir,
} = require('./paths');
const { copyFileRobust, copyTree: copyTreeSync, writeFileRobust } = require('./copy-file');

function sha1File(filePath) {
  return crypto.createHash('sha1').update(fs.readFileSync(filePath)).digest('hex');
}

function sha1Buffer(buf) {
  return crypto.createHash('sha1').update(buf).digest('hex');
}

function downloadBuffer(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib
      .get(url, { headers: { 'User-Agent': 'SiegedEmpiresInstaller/0.2.0' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          if (redirectsLeft <= 0) {
            reject(new Error(`Too many redirects for ${url}`));
            return;
          }
          downloadBuffer(res.headers.location, redirectsLeft - 1).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      })
      .on('error', reject);
  });
}

function copyOverrideFile(sourceRel, destPath, expectedSha1, onProgress, overridesRoot) {
  const src = path.join(overridesRoot, path.basename(sourceRel));
  if (!fs.existsSync(src)) throw new Error(`Override missing: ${src}`);
  onProgress({ stage: 'copy', message: `Copying ${path.basename(destPath)}…` });
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  copyFileRobust(src, destPath);
  if (expectedSha1) {
    const got = sha1File(destPath).toLowerCase();
    if (got !== expectedSha1.toLowerCase()) {
      throw new Error(`Override hash mismatch for ${path.basename(destPath)}`);
    }
  }
  return { ok: true, path: destPath };
}

async function downloadEntry(entry, destPath, onProgress) {
  const expectedSha1 = (entry.hashes?.sha1 || '').toLowerCase();
  const urls = entry.downloads || [];
  let lastErr = null;
  for (const url of urls) {
    try {
      onProgress({ stage: 'download', message: `Downloading ${path.basename(destPath)}…` });
      const buf = await downloadBuffer(url);
      const got = sha1Buffer(buf).toLowerCase();
      if (expectedSha1 && got !== expectedSha1) {
        throw new Error(
          `Hash mismatch for ${path.basename(destPath)} (expected ${expectedSha1}, got ${got})`
        );
      }
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      writeFileRobust(destPath, buf);
      return { ok: true, path: destPath, sha1: got };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error(`No download URL for ${destPath}`);
}

function removeOrphans(dir, expectedNames, onProgress) {
  if (!fs.existsSync(dir)) return [];
  const removed = [];
  for (const name of fs.readdirSync(dir)) {
    if (!expectedNames.has(name)) {
      fs.unlinkSync(path.join(dir, name));
      removed.push(name);
      onProgress({ stage: 'clean', message: `Removed obsolete ${name}` });
    }
  }
  return removed;
}

function resolveResourcesRoot() {
  if (process.resourcesPath && fs.existsSync(path.join(process.resourcesPath, 'files'))) {
    return process.resourcesPath;
  }
  return path.join(__dirname, '..');
}

function resolveBundledAppRoot(resourcesRoot) {
  const portable = path.join(resourcesRoot, 'app-portable');
  if (fs.existsSync(portable)) {
    for (const name of fs.readdirSync(portable).filter((e) => !e.endsWith('.blockmap'))) {
      const candidate = path.join(portable, name);
      if (fs.statSync(candidate).isDirectory()) return candidate;
    }
  }
  const bundle = path.join(resourcesRoot, 'app-bundle');
  if (fs.existsSync(path.join(bundle, 'src', 'main.js'))) return bundle;
  const devApp = path.join(__dirname, '..', 'app');
  if (fs.existsSync(path.join(devApp, 'src', 'main.js'))) return devApp;
  return null;
}

function writeLinuxLauncherScript(appDir, installDir) {
  const script = `#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
export SE_INSTALL_DIR="${installDir.replace(/"/g, '\\"')}"
cd "$DIR"
if command -v electron >/dev/null 2>&1; then
  exec electron "$DIR/src/main.js"
fi
if [ -x "$DIR/node_modules/electron/dist/electron" ]; then
  exec "$DIR/node_modules/electron/dist/electron" "$DIR/src/main.js"
fi
echo "Electron not found. Re-run Sieged Empires Setup." >&2
exit 1
`;
  fs.writeFileSync(path.join(appDir, 'sieged-empires'), script, { mode: 0o755 });
}

function writeWindowsLauncherScript(appDir, installDir) {
  const bat = `@echo off
set SE_INSTALL_DIR=${installDir}
cd /d "%~dp0"
where electron >nul 2>nul
if %ERRORLEVEL%==0 (
  electron "%~dp0src\\main.js"
  exit /b %ERRORLEVEL%
)
if exist "%~dp0node_modules\\electron\\dist\\electron.exe" (
  "%~dp0node_modules\\electron\\dist\\electron.exe" "%~dp0src\\main.js"
  exit /b %ERRORLEVEL%
)
echo Electron not found. Re-run Sieged Empires Setup.
exit /b 1
`;
  fs.writeFileSync(path.join(appDir, 'sieged-empires.bat'), bat, 'utf8');
}

function deployLauncherApp(installDir, resourcesRoot, onProgress) {
  const dest = launcherAppDir(installDir);
  const appRoot = resolveBundledAppRoot(resourcesRoot);
  if (!appRoot) {
    onProgress({ stage: 'warn', message: 'Launcher app bundle not found — skipping app copy.' });
    return false;
  }

  onProgress({ stage: 'app', message: 'Installing Sieged Empires launcher…' });
  if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
  copyTreeSync(appRoot, dest);

  const iconSrc = path.join(resourcesRoot, 'assets', 'icon-transparent.png');
  if (fs.existsSync(iconSrc)) {
    fs.mkdirSync(path.join(dest, 'assets'), { recursive: true });
    copyFileRobust(iconSrc, path.join(dest, 'assets', 'icon-transparent.png'));
  }

  fs.writeFileSync(
    path.join(dest, 'install-dir.json'),
    JSON.stringify({ installDir }, null, 2),
    'utf8'
  );

  const isPortable =
    fs.existsSync(path.join(dest, 'resources')) ||
    /\.exe$/i.test(fs.readdirSync(dest).find((n) => n.endsWith('.exe')) || '');

  if (!isPortable) {
    if (process.platform === 'win32') writeWindowsLauncherScript(dest, installDir);
    else writeLinuxLauncherScript(dest, installDir);
  }
  return true;
}

const NOTE_MODS = 'Downloading Mods from Official Websites...';
const NOTE_CONFIG = 'Installing Config and Settings...';

/** Mods phase uses 0–90%; config/settings/app finish 90–100%. */
function modsPercent(done, total) {
  if (!total) return 90;
  return Math.round((done / total) * 90);
}

async function syncPack(installDir, onProgress = () => {}) {
  const resourcesRoot = resolveResourcesRoot();
  const manifest = loadManifest(resourcesRoot);
  const fingerprint = manifestFingerprint(manifest);
  const overridesRoot = bundledOverridesDir(resourcesRoot);
  const configSource = bundledConfigDir(resourcesRoot);

  fs.mkdirSync(installDir, { recursive: true });
  fs.mkdirSync(modsDir(installDir), { recursive: true });
  fs.mkdirSync(instanceDir(installDir), { recursive: true });

  const allEntries = [...(manifest.files || []), ...(manifest.overrides || [])];
  const modEntries = allEntries.filter((e) => e.path && e.path.startsWith('mods/'));
  const modTotal = modEntries.length;
  const installed = [];

  onProgress({
    stage: 'mods',
    current: 0,
    total: modTotal,
    percent: 0,
    message: NOTE_MODS,
  });

  // Quiet per-file callbacks — UI shows the phase note + overall percent only.
  const quiet = () => {};

  for (let i = 0; i < modEntries.length; i += 1) {
    const entry = modEntries[i];
    const rel = entry.path;
    const destPath = path.join(installDir, rel);

    onProgress({
      stage: 'mods',
      current: i,
      total: modTotal,
      percent: modsPercent(i, modTotal),
      message: NOTE_MODS,
    });

    const localOverride = Boolean(entry.source) && !(entry.downloads || []).length;
    if (localOverride) {
      copyOverrideFile(entry.source, destPath, entry.hashes?.sha1, quiet, overridesRoot);
    } else {
      const existingOk =
        fs.existsSync(destPath) &&
        entry.hashes?.sha1 &&
        sha1File(destPath).toLowerCase() === entry.hashes.sha1.toLowerCase();
      if (!existingOk) {
        await downloadEntry(entry, destPath, quiet);
      }
    }
    installed.push(rel);

    onProgress({
      stage: 'mods',
      current: i + 1,
      total: modTotal,
      percent: modsPercent(i + 1, modTotal),
      message: NOTE_MODS,
    });
  }

  onProgress({
    stage: 'clean',
    percent: 92,
    message: NOTE_CONFIG,
  });
  const removed = removeOrphans(modsDir(installDir), expectedModFilenames(manifest), quiet);

  if (fs.existsSync(configSource)) {
    onProgress({
      stage: 'config',
      percent: 95,
      message: NOTE_CONFIG,
    });
    copyTreeSync(configSource, configDir(installDir));
  }

  onProgress({
    stage: 'app',
    percent: 97,
    message: NOTE_CONFIG,
  });
  deployLauncherApp(installDir, resourcesRoot, quiet);

  fs.writeFileSync(
    packManifestPath(installDir),
    JSON.stringify(
      {
        formatVersion: manifest.formatVersion || 1,
        name: manifest.name,
        minecraft: manifest.minecraft,
        loader: manifest.loader,
        manifestFingerprint: fingerprint,
        syncedAt: new Date().toISOString(),
        modCount: installed.length,
        removedMods: removed,
      },
      null,
      2
    ),
    'utf8'
  );

  writeInstallMeta(installDir, {
    manifestFingerprint: fingerprint,
    manifestFormatVersion: manifest.formatVersion || 1,
    installedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    installDir,
    minecraft: manifest.minecraft,
    loader: manifest.loader,
  });

  onProgress({
    stage: 'done',
    percent: 100,
    message: NOTE_CONFIG,
  });
  return { fingerprint, modCount: installed.length, removedMods: removed };
}

function launchInstalledApp(installDir) {
  const appDir = launcherAppDir(installDir);
  if (!fs.existsSync(appDir)) {
    return { ok: false, error: 'Installed launcher not found. Re-run setup.' };
  }

  if (process.platform === 'win32') {
    const exe = fs
      .readdirSync(appDir)
      .find((n) => n.endsWith('.exe') && !n.toLowerCase().includes('setup'));
    if (exe) {
      spawn(path.join(appDir, exe), [], {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, SE_INSTALL_DIR: installDir },
      }).unref();
      return { ok: true };
    }
    const bat = path.join(appDir, 'sieged-empires.bat');
    if (fs.existsSync(bat)) {
      spawn('cmd.exe', ['/c', bat], { detached: true, stdio: 'ignore' }).unref();
      return { ok: true };
    }
  } else {
    const sh = path.join(appDir, 'sieged-empires');
    if (fs.existsSync(sh)) {
      spawn(sh, [], {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, SE_INSTALL_DIR: installDir },
      }).unref();
      return { ok: true };
    }
  }
  return { ok: false, error: 'Installed launcher not found. Re-run setup.' };
}

module.exports = {
  syncPack,
  launchInstalledApp,
  resolveResourcesRoot,
  sha1File,
};
