/**
 * Sync mods/config into the install dir.
 * - manifest + SE overrides + config/options/shader profiles: GitHub sieged-empires-client
 * - files[] (third-party): download ONLY via official CDN links in the manifest
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const { getInstallDir, bundledPackRoot, appConfigPath } = require('./paths');
const { copyFileRobust, copyTreeMissingOnly, writeFileRobust, makeWritable, makeWritableTree } = require('../../lib/copy-file');

const REMOTE_PACK = {
  owner: 'AlbertMerle',
  repo: 'sieged-empires-client',
  branch: 'main',
};

const VERSIONS_ROOT = 'versions';
const PACK_VERSION_FILE = 'pack-version.json';
const DEFAULT_PACK_VERSION = '1.0.1';
const PACK_VERSION_LOG = 'pack-version.log';

const NOTE_MANIFEST = 'Checking Sieged Empires pack for updates…';
const NOTE_MODS = 'Downloading Mods and Resource Packs from Official Websites…';
const NOTE_OVERRIDES = 'Downloading Sieged Empires mods…';
const NOTE_CONFIG = 'Installing Config and Settings…';

const PACK_PREFIXES = ['mods/', 'resourcepacks/', 'shaderpacks/'];
const STATIC_PREFIXES = ['config/', 'shaderpacks/'];
const STATIC_ROOT_FILES = ['options.txt', 'user_jvm_args.txt'];
/** Pack-managed configs always re-sync when the remote blob changes (not missing-only). */
const FORCE_SYNC_STATIC = [
  'user_jvm_args.txt',
  'config/voxelmapsync.properties',
  'config/voxyserver.json',
  'config/voxy-config.json',
  'config/c2me.toml',
  'config/sound_physics_remastered/soundphysics.properties',
];
const STATIC_EXCLUDE = [
  'config/spark/tmp/',
  'config/spark/tmp-client/',
  'config/voicechat/username-cache.json',
];

function isPackPath(p) {
  return PACK_PREFIXES.some((prefix) => p?.startsWith(prefix));
}

function remoteRawUrl(relPath) {
  const encoded = relPath.split('/').map(encodeURIComponent).join('/');
  return `https://raw.githubusercontent.com/${REMOTE_PACK.owner}/${REMOTE_PACK.repo}/${REMOTE_PACK.branch}/${encoded}`;
}

function remoteManifestUrl() {
  return remoteRawUrl('manifest.json');
}

function remoteTreeApiUrl() {
  return `https://api.github.com/repos/${REMOTE_PACK.owner}/${REMOTE_PACK.repo}/git/trees/${REMOTE_PACK.branch}?recursive=1`;
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
    const headers = { 'User-Agent': 'SiegedEmpires/1.0.0' };
    if (url.includes('api.github.com')) {
      headers.Accept = 'application/vnd.github+json';
    }
    lib
      .get(url, { headers }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          if (redirectsLeft <= 0) {
            reject(new Error('Too many redirects'));
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

async function fetchJson(url) {
  const buf = await downloadBuffer(url, 5);
  return JSON.parse(buf.toString('utf8'));
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
      if (j.files || j.overrides) return { manifest: j, path: p, source: 'bundled' };
    } catch {
      /* continue */
    }
  }
  return null;
}

async function loadManifest() {
  try {
    const manifest = await fetchJson(remoteManifestUrl());
    if (manifest.files || manifest.overrides) {
      return { manifest, path: remoteManifestUrl(), source: 'remote' };
    }
  } catch (err) {
    console.warn('Remote manifest fetch failed:', err?.message || err);
  }
  return loadBundledManifest();
}

async function fetchRemoteTree() {
  return fetchJson(remoteTreeApiUrl());
}

function staticFileEntries(tree) {
  return (tree.tree || []).filter((item) => {
    if (item.type !== 'blob') return false;
    if (item.path.startsWith(`${VERSIONS_ROOT}/`)) return false;
    if (STATIC_EXCLUDE.some((ex) => item.path === ex || item.path.startsWith(ex))) return false;
    if (STATIC_ROOT_FILES.includes(item.path)) return true;
    return STATIC_PREFIXES.some((prefix) => item.path.startsWith(prefix));
  });
}

function isUserPreservedStatic(relPath) {
  return relPath === 'options.txt' || relPath.startsWith('config/');
}

function managedStaticEntries(entries) {
  return entries.filter((entry) => !isUserPreservedStatic(entry.path));
}

function missingUserStaticFiles(installDir, entries) {
  return entries.filter((entry) => {
    if (!isUserPreservedStatic(entry.path)) return false;
    return !fs.existsSync(path.join(installDir, entry.path));
  });
}

function staticEntryNeedsDownload(installDir, entry, staticFileShas) {
  const dest = path.join(installDir, entry.path);
  if (FORCE_SYNC_STATIC.includes(entry.path)) {
    return !fs.existsSync(dest) || staticFileShas[entry.path] !== entry.sha;
  }
  if (isUserPreservedStatic(entry.path)) {
    return !fs.existsSync(dest);
  }
  return staticFileShas[entry.path] !== entry.sha;
}

function staticFilesFingerprint(entries) {
  const parts = entries.map((e) => `${e.path}:${e.sha}`).sort();
  return crypto.createHash('sha1').update(parts.join('|')).digest('hex');
}

function managedStaticFingerprint(entries) {
  return staticFilesFingerprint(managedStaticEntries(entries));
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

function readInstallMeta(installDir) {
  const metaPath = path.join(installDir, 'install-meta.json');
  if (!fs.existsSync(metaPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch {
    return {};
  }
}

function getInstalledPackVersion(meta) {
  const v = String(meta?.packVersion || '').trim();
  return v || DEFAULT_PACK_VERSION;
}

function resolveTargetPackVersion(loaded) {
  return String(loaded?.packVersionIndex?.latest || DEFAULT_PACK_VERSION).trim();
}

function packVersionUpdating(installedVersion, targetVersion) {
  return compareVersions(installedVersion, targetVersion) < 0;
}

function formatUpdatingMessage(targetVersion, detail) {
  const prefix = `Updating to ${targetVersion}…`;
  if (!detail) return prefix;
  return `${prefix} ${detail}`;
}

function appendPackVersionLog(installDir, fromVersion, toVersion) {
  const line = `${new Date().toISOString()}  Sieged Empires pack updated: ${fromVersion} → ${toVersion}\n`;
  const logPath = path.join(installDir, PACK_VERSION_LOG);
  try {
    fs.appendFileSync(logPath, line, 'utf8');
  } catch (err) {
    console.warn('pack version log:', err?.message || err);
  }
}

function recordPackVersionChange(installDir, meta, fromVersion, toVersion) {
  if (compareVersions(fromVersion, toVersion) >= 0) return meta;
  appendPackVersionLog(installDir, fromVersion, toVersion);
  console.log(`Sieged Empires pack updated: ${fromVersion} → ${toVersion}`);
  const history = Array.isArray(meta.packVersionHistory) ? [...meta.packVersionHistory] : [];
  history.push({ version: toVersion, from: fromVersion, at: new Date().toISOString() });
  return {
    ...meta,
    packVersion: toVersion,
    packVersionUpdatedAt: new Date().toISOString(),
    packVersionHistory: history,
  };
}

function needsUpdate(installDir, fp) {
  const meta = readInstallMeta(installDir);
  return meta.manifestFingerprint !== fp;
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

function overrideDownloadUrls(entry) {
  if (entry.downloads?.length) return entry.downloads;
  if (entry.packRelPath) return [remoteRawUrl(entry.packRelPath)];
  return [remoteRawUrl(entry.path)];
}

function parseVersionParts(version) {
  return String(version || '')
    .trim()
    .replace(/^v/i, '')
    .split(/[.+-]/)
    .filter(Boolean)
    .map((part) => {
      const n = parseInt(part, 10);
      return Number.isFinite(n) ? n : 0;
    });
}

function compareVersions(a, b) {
  const pa = parseVersionParts(a);
  const pb = parseVersionParts(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

function sortVersionList(versions) {
  return [...versions].sort(compareVersions);
}

async function loadPackVersionIndex() {
  try {
    const index = await fetchJson(remoteRawUrl(PACK_VERSION_FILE));
    if (!index?.versions?.length) return null;
    const versions = sortVersionList(
      index.versions.map((v) => String(v).trim()).filter(Boolean)
    );
    const latest = String(index.latest || versions[versions.length - 1] || '').trim();
    return { latest, versions };
  } catch {
    return null;
  }
}

async function loadVersionPatch(version) {
  try {
    return await fetchJson(remoteRawUrl(`${VERSIONS_ROOT}/${version}/patch.json`));
  } catch {
    return null;
  }
}

function mergeManifestWithPatches(baseManifest, patches) {
  const manifest = JSON.parse(JSON.stringify(baseManifest));
  const overrideMap = new Map();
  for (const entry of manifest.overrides || []) {
    overrideMap.set(entry.path, { ...entry });
  }
  const removeSet = new Set(manifest.remove || []);
  const versionStaticEntries = [];

  for (const { version, patch } of patches) {
    for (const entry of patch.overrides || []) {
      if (!entry?.path) continue;
      overrideMap.set(entry.path, {
        ...entry,
        packRelPath: `${VERSIONS_ROOT}/${version}/${entry.path}`,
        packVersion: version,
      });
    }
    for (const rel of patch.remove || []) {
      removeSet.add(rel);
      overrideMap.delete(rel);
    }
    for (const entry of patch.static || []) {
      if (!entry?.path) continue;
      versionStaticEntries.push({
        path: entry.path,
        sha: entry.sha || entry.blobSha || '',
        packRelPath: `${VERSIONS_ROOT}/${version}/${entry.path}`,
        packVersion: version,
      });
    }
  }

  manifest.overrides = Array.from(overrideMap.values());
  manifest.remove = [...removeSet];
  return { manifest, versionStaticEntries };
}

async function loadManifestWithVersions(baseLoaded) {
  const base = baseLoaded || (await loadManifest());
  if (!base?.manifest) return null;

  const packVersionIndex = await loadPackVersionIndex();
  if (!packVersionIndex?.versions?.length) {
    return {
      ...base,
      packVersionIndex: null,
      appliedVersions: [],
      versionStaticEntries: [],
    };
  }

  const patches = [];
  for (const version of packVersionIndex.versions) {
    const patch = await loadVersionPatch(version);
    if (patch) patches.push({ version, patch });
  }

  if (!patches.length) {
    return {
      ...base,
      packVersionIndex,
      appliedVersions: [],
      versionStaticEntries: [],
    };
  }

  const { manifest, versionStaticEntries } = mergeManifestWithPatches(base.manifest, patches);
  return {
    manifest,
    path: base.path,
    source: base.source,
    packVersionIndex,
    appliedVersions: patches.map((p) => p.version),
    versionStaticEntries,
  };
}

async function syncDownloadEntry(entry, installDir, bump, urls, label) {
  const dest = path.join(installDir, entry.path);
  const expectedHash = (entry.hashes?.sha1 || '').toLowerCase();
  const base = path.basename(entry.path);
  bump(base, 0);

  if (fs.existsSync(dest) && expectedHash && sha1File(dest).toLowerCase() === expectedHash) {
    bump(base, 1);
    return;
  }

  let lastErr = null;
  if (!urls.length) {
    throw new Error(`No download URL for ${base}`);
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
  if (lastErr) throw new Error(`Failed ${label} ${base}: ${lastErr.message}`);
  bump(base, 1);
}

async function syncCdnEntry(entry, installDir, bump) {
  await syncDownloadEntry(entry, installDir, bump, entry.downloads || [], 'CDN');
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

  try {
    await syncDownloadEntry(entry, installDir, bump, overrideDownloadUrls(entry), 'SE');
    return;
  } catch (err) {
    console.warn(`Remote override failed for ${base}:`, err?.message || err);
  }

  const src = findOverrideFile(entry);
  if (!src) throw new Error(`Missing SE file ${base} (GitHub and bundled copy unavailable)`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  copyFileRobust(src, dest);
  bump(base, 1);
}

async function syncStaticFiles(installDir, staticEntries, meta, onProgress, versionStaticEntries = []) {
  const staticFileShas = { ...(meta.staticFileShas || {}) };
  const allStaticEntries = [
    ...staticEntries,
    ...versionStaticEntries.filter(
      (entry) => !staticEntries.some((base) => base.path === entry.path)
    ),
  ];
  const pending = allStaticEntries.filter((entry) =>
    staticEntryNeedsDownload(installDir, entry, staticFileShas)
  );

  if (!pending.length) {
    return {
      changed: false,
      staticFileShas,
      staticFilesFingerprint: managedStaticFingerprint(allStaticEntries),
    };
  }

  let done = 0;
  for (const entry of pending) {
    onProgress({
      stage: 'config',
      percent: 92 + Math.round((done / pending.length) * 6),
      message: `${NOTE_CONFIG} (${path.basename(entry.path)})`,
    });
    const dest = path.join(installDir, entry.path);
    const url = entry.packRelPath ? remoteRawUrl(entry.packRelPath) : remoteRawUrl(entry.path);
    const buf = await downloadBuffer(url);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    writeFileRobust(dest, buf);
    staticFileShas[entry.path] = entry.sha || sha1Buf(buf);
    done += 1;
  }

  return {
    changed: true,
    staticFileShas,
    staticFilesFingerprint: managedStaticFingerprint(allStaticEntries),
  };
}

function copyBundledStaticFallback(installDir) {
  const pack = bundledPackRoot();
  const configDest = path.join(installDir, 'config');
  const configSrc =
    (pack && path.join(pack, 'config')) ||
    (process.resourcesPath && path.join(process.resourcesPath, 'files', 'config')) ||
    path.join(__dirname, '..', '..', 'files', 'config');
  if (fs.existsSync(configSrc)) copyTreeMissingOnly(configSrc, configDest);

  const optionsDest = path.join(installDir, 'options.txt');
  const optionsSrc =
    (pack && path.join(pack, 'options.txt')) ||
    path.join(__dirname, '..', '..', '..', 'client', 'options.txt');
  if (fs.existsSync(optionsSrc) && !fs.existsSync(optionsDest)) {
    copyFileRobust(optionsSrc, optionsDest);
  }
}

function writeInstallMeta(installDir, manifest, fp, expected, modsDest, extra = {}) {
  writeFileRobust(
    path.join(installDir, 'install-meta.json'),
    JSON.stringify(
      {
        manifestFingerprint: fp,
        updatedAt: new Date().toISOString(),
        installDir,
        modCount: jarCount(modsDest),
        fileCount: expected,
        source: 'github+cdn',
        remoteRepo: `${REMOTE_PACK.owner}/${REMOTE_PACK.repo}`,
        remoteBranch: REMOTE_PACK.branch,
        appVersion: (() => {
          try {
            return JSON.parse(fs.readFileSync(appConfigPath(), 'utf8')).appName;
          } catch {
            return 'Sieged Empires';
          }
        })(),
        ...extra,
      },
      null,
      2
    ),
    'utf8'
  );
}

/**
 * Ensure pack is present: GitHub manifest/overrides/config + CDN for files[].
 */
async function syncGamePack(onProgress = () => {}) {
  const installDir = getInstallDir();
  const modsDest = path.join(installDir, 'mods');
  const configDest = path.join(installDir, 'config');

  fs.mkdirSync(modsDest, { recursive: true });
  fs.mkdirSync(path.join(installDir, 'resourcepacks'), { recursive: true });
  fs.mkdirSync(path.join(installDir, 'shaderpacks'), { recursive: true });
  fs.mkdirSync(configDest, { recursive: true });

  let emitProgress = onProgress;
  let versionUpdate = false;
  let targetVersion = DEFAULT_PACK_VERSION;

  const wrapProgress = () => {
    if (!versionUpdate) return;
    const base = emitProgress;
    emitProgress = (p) => {
      const msg = p?.message;
      if (msg && !String(msg).startsWith('Updating to')) {
        base({ ...p, message: formatUpdatingMessage(targetVersion, msg), packVersion: targetVersion });
        return;
      }
      base({ ...p, packVersion: targetVersion });
    };
  };

  emitProgress({ stage: 'manifest', percent: 0, message: NOTE_MANIFEST });

  const loaded = await loadManifestWithVersions();
  if (!loaded?.manifest?.files && !loaded?.manifest?.overrides) {
    throw new Error('Pack manifest missing. Reinstall Sieged Empires or check your network.');
  }

  const manifest = loaded.manifest;
  const expected = expectedFileCount(manifest);
  const fp = fingerprint(manifest);
  const meta = readInstallMeta(installDir);
  const installedVersion = getInstalledPackVersion(meta);
  targetVersion = resolveTargetPackVersion(loaded);
  versionUpdate = packVersionUpdating(installedVersion, targetVersion);
  const packVersionMatch = !versionUpdate;
  wrapProgress();

  const progressMessage = (detail) => {
    if (versionUpdate) return formatUpdatingMessage(targetVersion, detail);
    return detail;
  };

  let staticEntries = [];
  try {
    const tree = await fetchRemoteTree();
    staticEntries = staticFileEntries(tree);
  } catch (err) {
    console.warn('Remote pack tree fetch failed:', err?.message || err);
  }

  const manifestMissing = missingManifestFiles(installDir, manifest);
  const manifestFpMatch = meta.manifestFingerprint === fp;
  const missingUserStatic = staticEntries.length ? missingUserStaticFiles(installDir, staticEntries) : [];
  const managedStaticFp = staticEntries.length ? managedStaticFingerprint(staticEntries) : null;
  const managedStaticFpMatch = managedStaticFp ? meta.staticFilesFingerprint === managedStaticFp : true;

  if (
    manifestFpMatch &&
    manifestMissing === 0 &&
    missingUserStatic.length === 0 &&
    managedStaticFpMatch &&
    packVersionMatch
  ) {
    makeWritableTree(configDest);
    makeWritable(path.join(installDir, 'options.txt'));
    if (!meta.packVersion) {
      writeInstallMeta(installDir, manifest, fp, expected, modsDest, {
        manifestSource: loaded.source,
        packVersion: targetVersion,
        appliedPackVersions: loaded.appliedVersions || [],
        staticFilesFingerprint: meta.staticFilesFingerprint || managedStaticFp || null,
        staticFileShas: meta.staticFileShas || {},
      });
    }
    emitProgress({
      stage: 'done',
      percent: 100,
      message: 'Already up to date.',
      packVersion: targetVersion,
      installedPackVersion: targetVersion,
    });
    return {
      ok: true,
      updated: false,
      installDir,
      packVersion: targetVersion,
      installedPackVersion: targetVersion,
    };
  }

  if (versionUpdate) {
    emitProgress({
      stage: 'manifest',
      percent: 1,
      message: formatUpdatingMessage(targetVersion, NOTE_MANIFEST),
      packVersion: targetVersion,
    });
  }

  emitProgress({ stage: 'mods', percent: 2, message: progressMessage(NOTE_OVERRIDES) });

  const overrides = (manifest.overrides || []).filter((e) => isPackPath(e.path));
  const cdnFiles = (manifest.files || []).filter((e) => isPackPath(e.path));
  const total = overrides.length + cdnFiles.length || 1;
  let done = 0;

  const bump = (name, frac = 0) => {
    const base = (done + frac) / total;
    const detail = name ? `${NOTE_MODS} (${name})` : NOTE_MODS;
    emitProgress({
      stage: 'mods',
      percent: Math.min(90, 2 + Math.round(base * 88)),
      message: progressMessage(detail),
    });
  };

  for (const entry of overrides) {
    await syncOverrideEntry(entry, installDir, bump);
    done += 1;
    bump();
  }

  emitProgress({ stage: 'mods', percent: 45, message: progressMessage(NOTE_MODS) });

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

  emitProgress({ stage: 'config', percent: 92, message: progressMessage(NOTE_CONFIG) });

  let staticMeta = {};
  if (staticEntries.length || loaded.versionStaticEntries?.length) {
    staticMeta = await syncStaticFiles(
      installDir,
      staticEntries,
      meta,
      emitProgress,
      loaded.versionStaticEntries || []
    );
  } else {
    copyBundledStaticFallback(installDir);
  }

  makeWritableTree(configDest);
  makeWritable(path.join(installDir, 'options.txt'));

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

  const versionMeta = recordPackVersionChange(installDir, meta, installedVersion, targetVersion);
  writeInstallMeta(installDir, manifest, fp, expected, modsDest, {
    manifestSource: loaded.source,
    packVersion: targetVersion,
    packVersionUpdatedAt: versionMeta.packVersionUpdatedAt || meta.packVersionUpdatedAt || null,
    packVersionHistory: versionMeta.packVersionHistory || meta.packVersionHistory || [],
    appliedPackVersions: loaded.appliedVersions || [],
    staticFilesFingerprint:
      staticMeta.staticFilesFingerprint || managedStaticFp || meta.staticFilesFingerprint || null,
    staticFileShas: staticMeta.staticFileShas || meta.staticFileShas || {},
  });

  emitProgress({
    stage: 'done',
    percent: 100,
    message: versionUpdate
      ? formatUpdatingMessage(targetVersion, 'Update complete.')
      : NOTE_CONFIG,
    packVersion: targetVersion,
    installedPackVersion: targetVersion,
  });
  return {
    ok: true,
    updated: true,
    installDir,
    packVersion: targetVersion,
    installedPackVersion: targetVersion,
    previousPackVersion: installedVersion,
  };
}

async function packStatus() {
  const installDir = getInstallDir();
  let loaded = null;
  try {
    loaded = await loadManifestWithVersions(await loadManifest());
  } catch {
    loaded = loadBundledManifest();
  }
  if (!loaded) {
    loaded = loadBundledManifest();
  }

  const fp = loaded ? fingerprint(loaded.manifest) : null;
  const jars = jarCount(path.join(installDir, 'mods'));
  const expected = loaded ? expectedFileCount(loaded.manifest) : 0;
  const missing = loaded ? missingManifestFiles(installDir, loaded.manifest) : expected;
  const meta = readInstallMeta(installDir);
  const installedPackVersion = getInstalledPackVersion(meta);
  const remotePackVersion = loaded ? resolveTargetPackVersion(loaded) : DEFAULT_PACK_VERSION;
  const packVersionStale = packVersionUpdating(installedPackVersion, remotePackVersion);

  let staticStale = false;
  try {
    const tree = await fetchRemoteTree();
    const staticEntries = staticFileEntries(tree);
    const versionStatic = loaded?.versionStaticEntries || [];
    const allStatic = [
      ...staticEntries,
      ...versionStatic.filter((entry) => !staticEntries.some((base) => base.path === entry.path)),
    ];
    if (allStatic.length) {
      const missingUser = missingUserStaticFiles(installDir, allStatic);
      const managedFp = managedStaticFingerprint(allStatic);
      staticStale = missingUser.length > 0 || meta.staticFilesFingerprint !== managedFp;
    }
  } catch {
    staticStale = false;
  }

  return {
    installDir,
    modCount: jars,
    expectedModCount: expected,
    packVersion: remotePackVersion,
    installedPackVersion,
    remotePackVersion,
    updateNeeded: fp
      ? needsUpdate(installDir, fp) ||
        missing > 0 ||
        staticStale ||
        packVersionStale ||
        jars < Math.max(1, expected)
      : jars === 0,
  };
}

function readInstalledPackVersion() {
  const installDir = getInstallDir();
  return getInstalledPackVersion(readInstallMeta(installDir));
}

module.exports = {
  syncGamePack,
  packStatus,
  loadManifest,
  loadManifestWithVersions,
  fingerprint,
  compareVersions,
  getInstalledPackVersion,
  readInstalledPackVersion,
  resolveTargetPackVersion,
  DEFAULT_PACK_VERSION,
  NOTE_MODS,
  NOTE_CONFIG,
};
