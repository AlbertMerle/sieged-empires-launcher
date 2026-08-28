/**
 * Sync mods/config into the install dir.
 * - overrides (SE-owned): copy from bundled files/mods or pack/mods
 * - files[] (third-party): download ONLY via official CDN links in the manifest
 * Never ships redistributed third-party jars inside the installer payload.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const { getInstallDir, bundledPackRoot, appConfigPath } = require('./paths');
const { copyFileRobust, copyTree, writeFileRobust, makeWritable, makeWritableTree } = require('../../lib/copy-file');

const NOTE_MODS = 'Downloading Mods and Resource Packs from Official Websites...';
const NOTE_CONFIG = 'Installing Config and Settings...';
const PACK_PREFIXES = ['mods/', 'resourcepacks/', 'shaderpacks/'];

function isPackPath(p) {
  return PACK_PREFIXES.some((prefix) => p?.startsWith(prefix));
}

function sha1File(p) {
  return crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex');
}

function sha1Buf(buf) {
  return crypto.createHash('sha1').update(buf).digest('hex');
}

function downloadBuffer(url, redirectsLeft = 5, onProgress) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib
      .get(url, { headers: { 'User-Agent': 'SiegedEmpires/1.0.0' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          if (redirectsLeft <= 0) {
            reject(new Error(`Too many redirects`));
            return;
          }
          downloadBuffer(res.headers.location, redirectsLeft - 1, onProgress).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        const total = Number(res.headers['content-length']) || 0;
        let received = 0;
        let lastReport = 0;
        const chunks = [];
        res.on('data', (c) => {
          chunks.push(c);
          received += c.length;
          const now = Date.now();
          if (onProgress && total > 0 && (now - lastReport > 60 || received === total)) {
            lastReport = now;
            onProgress(received, total);
          }
        });
        res.on('end', () => {
          if (onProgress && total > 0) onProgress(total, total);
          resolve(Buffer.concat(chunks));
        });
      })
      .on('error', reject);
  });
}

function overrideSubdir(entryPath) {
  if (entryPath.startsWith('resourcepacks/')) return 'resourcepacks';
  if (entryPath.startsWith('shaderpacks/')) return 'shaderpacks';
  return 'mods';
}

function overridesRoots(subdir) {
  const roots = [];
  if (process.resourcesPath) {
    roots.push(path.join(process.resourcesPath, 'files', subdir));
    roots.push(path.join(process.resourcesPath, 'pack', subdir));
  }
  const pack = bundledPackRoot();
  if (pack) roots.push(path.join(pack, subdir));
  roots.push(path.join(__dirname, '..', '..', 'files', subdir));
  roots.push(path.join(__dirname, '..', '..', 'pack-payload', subdir));
  return roots;
}

function findOverrideFile(entry) {
  const base = path.basename(entry.source || entry.path);
  const subdir = overrideSubdir(entry.path);
  for (const root of overridesRoots(subdir)) {
    const p = path.join(root, base);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function loadBundledManifest() {
  const candidates = [
    process.resourcesPath ? path.join(process.resourcesPath, 'files', 'manifest.json') : null,
    path.join(__dirname, '..', '..', 'files', 'manifest.json'),
    (() => {
      const pack = bundledPackRoot();
      return pack ? path.join(pack, 'pack-manifest.json') : null;
    })(),
  ].filter(Boolean);

  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    try {
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (j.files || j.overrides) return { manifest: j, path: p };
    } catch {
      /* continue */
    }
  }
  return null;
}

function manifestEntries(manifest) {
  return [...(manifest.files || []), ...(manifest.overrides || [])].filter((e) => isPackPath(e.path));
}

function fingerprint(manifest) {
  const parts = manifestEntries(manifest)
    .map((e) => `${e.path}:${e.hashes?.sha1 || ''}`)
    .sort();
  return crypto.createHash('sha1').update(parts.join('|')).digest('hex');
}

function needsUpdate(installDir, fp) {
  const metaPath = path.join(installDir, 'install-meta.json');
  if (!fs.existsSync(metaPath)) return true;
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    return meta.manifestFingerprint !== fp;
  } catch {
    return true;
  }
}

function jarCount(dir) {
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter((n) => n.endsWith('.jar')).length;
}

function expectedFileCount(manifest) {
  return manifestEntries(manifest).length;
}

function missingManifestFiles(installDir, manifest, verifyHashes = true) {
  let missing = 0;
  for (const entry of manifestEntries(manifest)) {
    const dest = path.join(installDir, entry.path);
    if (!fs.existsSync(dest)) {
      missing += 1;
      continue;
    }
    if (verifyHashes) {
      const expectedHash = (entry.hashes?.sha1 || '').toLowerCase();
      if (expectedHash && sha1File(dest).toLowerCase() !== expectedHash) {
        missing += 1;
      }
    }
  }
  return missing;
}

async function syncCdnEntry(entry, installDir, bump) {
  const dest = path.join(installDir, entry.path);
  const expectedHash = (entry.hashes?.sha1 || '').toLowerCase();
  const base = path.basename(entry.path);
  bump(base, 0);

  if (fs.existsSync(dest) && expectedHash && sha1File(dest).toLowerCase() === expectedHash) {
    bump(base, 1);
    return;
  }

  let lastErr = null;
  const urls = entry.downloads || [];
  if (!urls.length) {
    throw new Error(`No download URL for ${base} (cannot redistribute this file)`);
  }
  for (const url of urls) {
    try {
      const buf = await downloadBuffer(url, 5, (received, totalBytes) => {
        bump(base, totalBytes ? received / totalBytes : 0);
      });
      if (expectedHash && sha1Buf(buf).toLowerCase() !== expectedHash) {
        throw new Error('hash mismatch');
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      writeFileRobust(dest, buf);
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (lastErr) throw new Error(`Failed ${base}: ${lastErr.message}`);
  bump(base, 1);
}

async function syncOverrideEntry(entry, installDir, bump) {
  const dest = path.join(installDir, entry.path);
  const expectedHash = (entry.hashes?.sha1 || '').toLowerCase();
  const base = path.basename(entry.source || entry.path);
  bump(base, 0);

  if (fs.existsSync(dest) && expectedHash && sha1File(dest).toLowerCase() === expectedHash) {
    bump(base, 1);
    return;
  }

  const src = findOverrideFile(entry);
  if (!src) throw new Error(`Missing bundled SE file: ${base}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  copyFileRobust(src, dest);
  bump(base, 1);
}

/**
 * Ensure pack is present: CDN download for files[], local copy for overrides[].
 */
async function syncGamePack(onProgress = () => {}) {
  const installDir = getInstallDir();
  const pack = bundledPackRoot();
  const loaded = loadBundledManifest();
  const modsDest = path.join(installDir, 'mods');
  const configDest = path.join(installDir, 'config');

  fs.mkdirSync(modsDest, { recursive: true });
  fs.mkdirSync(path.join(installDir, 'resourcepacks'), { recursive: true });
  fs.mkdirSync(path.join(installDir, 'shaderpacks'), { recursive: true });
  fs.mkdirSync(configDest, { recursive: true });

  if (!loaded?.manifest?.files && !loaded?.manifest?.overrides) {
    throw new Error('Pack manifest missing. Reinstall Sieged Empires.');
  }

  const manifest = loaded.manifest;
  const expected = expectedFileCount(manifest);
  const fp = fingerprint(manifest);
  const updateNeeded =
    needsUpdate(installDir, fp) || missingManifestFiles(installDir, manifest) > 0;

  if (!updateNeeded) {
    makeWritableTree(configDest);
    makeWritable(path.join(installDir, 'options.txt'));
    onProgress({ stage: 'done', percent: 100, message: 'Already up to date.' });
    return { ok: true, updated: false, installDir };
  }

  onProgress({ stage: 'mods', percent: 0, message: NOTE_MODS });

  const overrides = (manifest.overrides || []).filter((e) => isPackPath(e.path));
  const cdnFiles = (manifest.files || []).filter((e) => isPackPath(e.path));
  const total = overrides.length + cdnFiles.length || 1;
  let done = 0;

  const bump = (name, frac = 0) => {
    const base = (done + frac) / total;
    onProgress({
      stage: 'mods',
      percent: Math.min(90, Math.round(base * 90)),
      message: name ? `${NOTE_MODS} (${name})` : NOTE_MODS,
    });
  };

  for (const entry of overrides) {
    await syncOverrideEntry(entry, installDir, bump);
    done += 1;
    bump();
  }

  // Download CDN files in parallel (concurrency 4) to speed up pack sync
  const concurrency = 4;
  let cursor = 0;
  const downloadWorker = async () => {
    while (cursor < cdnFiles.length) {
      const idx = cursor++;
      const entry = cdnFiles[idx];
      await syncCdnEntry(entry, installDir, bump);
      done += 1;
      bump();
    }
  };

  const workers = [];
  for (let i = 0; i < Math.min(concurrency, cdnFiles.length); i += 1) {
    workers.push(downloadWorker());
  }
  await Promise.all(workers);

  onProgress({ stage: 'config', percent: 92, message: NOTE_CONFIG });

  const configSrc =
    (pack && path.join(pack, 'config')) ||
    (process.resourcesPath && path.join(process.resourcesPath, 'files', 'config')) ||
    path.join(__dirname, '..', '..', 'files', 'config');
  if (fs.existsSync(configSrc)) copyTree(configSrc, configDest);
  makeWritableTree(configDest);
  makeWritable(path.join(installDir, 'options.txt'));

  // macOS (and any manifest with remove[]): drop Voxy jars/configs left from older installs
  for (const rel of manifest.remove || []) {
    const p = path.join(installDir, rel);
    if (fs.existsSync(p) && fs.statSync(p).isFile()) {
      try {
        fs.unlinkSync(p);
      } catch {
        /* ignore */
      }
    }
  }

  const optionsSrc =
    (pack && path.join(pack, 'options.txt')) ||
    path.join(__dirname, '..', '..', '..', 'client', 'options.txt');
  if (fs.existsSync(optionsSrc)) {
    copyFileRobust(optionsSrc, path.join(installDir, 'options.txt'));
  }

  writeFileRobust(
    path.join(installDir, 'install-meta.json'),
    JSON.stringify(
      {
        manifestFingerprint: fp,
        updatedAt: new Date().toISOString(),
        installDir,
        modCount: jarCount(modsDest),
        fileCount: expected,
        source: 'cdn+overrides',
        appVersion: (() => {
          try {
            return JSON.parse(fs.readFileSync(appConfigPath(), 'utf8')).appName;
          } catch {
            return 'Sieged Empires';
          }
        })(),
      },
      null,
      2
    ),
    'utf8'
  );

  onProgress({ stage: 'done', percent: 100, message: NOTE_CONFIG });
  return { ok: true, updated: true, installDir };
}

function packStatus() {
  const installDir = getInstallDir();
  const loaded = loadBundledManifest();
  const fp = loaded ? fingerprint(loaded.manifest) : null;
  const jars = jarCount(path.join(installDir, 'mods'));
  const expected = loaded ? expectedFileCount(loaded.manifest) : 0;
  const missing = loaded ? missingManifestFiles(installDir, loaded.manifest) : expected;
  return {
    installDir,
    modCount: jars,
    expectedModCount: expected,
    updateNeeded: fp
      ? needsUpdate(installDir, fp) || missing > 0 || jars < Math.max(1, expected)
      : jars === 0,
  };
}

module.exports = {
  syncGamePack,
  packStatus,
  NOTE_MODS,
  NOTE_CONFIG,
};
