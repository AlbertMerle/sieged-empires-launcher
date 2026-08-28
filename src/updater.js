const {
  loadConfig,
  pageDownload,
  modrinthConfigured,
  modrinthRef,
  curseforgeConfigured,
  curseforgeHasApiKey,
  getCurseforgeApiKey,
  curseforgeRef,
} = require('./config');
const { instanceDir } = require('./paths');
const fs = require('fs');
const path = require('path');
const https = require('https');

function httpsJson(url, { headers = {}, method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        path: u.pathname + u.search,
        method,
        headers: {
          'User-Agent': 'SiegedEmpiresLauncher/0.1.0',
          Accept: 'application/json',
          ...headers,
        },
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          httpsJson(res.headers.location, { headers, method: 'GET' }).then(resolve, reject);
          return;
        }
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode} for ${url}: ${data.slice(0, 200)}`));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function readLocalManifest() {
  const p = path.join(instanceDir(), 'pack-manifest.json');
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function writeLocalManifest(manifest) {
  const dir = instanceDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'pack-manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
}

async function checkModrinth(cfg, onProgress) {
  if (!modrinthConfigured(cfg)) {
    return {
      skipped: true,
      upToDate: true,
      source: 'modrinth',
      reason: 'modrinth_not_configured',
      message:
        'Modrinth project id is empty in config.json — skipping pack sync. Paste projectId or projectSlug when approved.',
    };
  }

  const ref = modrinthRef(cfg);
  onProgress({ stage: 'check', message: `Checking Modrinth for updates (${ref})…` });

  const versions = await httpsJson(
    `https://api.modrinth.com/v2/project/${encodeURIComponent(ref)}/version`
  );

  if (!Array.isArray(versions) || versions.length === 0) {
    throw new Error('No Modrinth versions found for this project');
  }

  const mcVer = cfg.minecraftVersion;
  const preferred =
    versions.find(
      (v) =>
        (v.loaders || []).includes('fabric') &&
        (v.game_versions || []).includes(mcVer)
    ) || versions[0];

  const local = readLocalManifest();
  if (local?.source === 'modrinth' && local?.versionId === preferred.id) {
    return {
      skipped: false,
      upToDate: true,
      source: 'modrinth',
      versionId: preferred.id,
      versionNumber: preferred.version_number,
      message: `Already on ${preferred.version_number}`,
    };
  }

  onProgress({
    stage: 'pending',
    message: `Update available on Modrinth: ${preferred.version_number} (.mrpack install not wired yet)`,
  });

  return {
    skipped: false,
    upToDate: false,
    needsInstall: true,
    source: 'modrinth',
    versionId: preferred.id,
    versionNumber: preferred.version_number,
    files: preferred.files || [],
    message: `Update available: ${preferred.version_number}. Full Modrinth .mrpack install pending.`,
  };
}

/**
 * Resolve CurseForge numeric mod id from projectId, slug, or URL slug.
 * API: https://docs.curseforge.com/rest-api/
 */
async function resolveCurseforgeModId(cfg, apiKey) {
  const rawId = String(cfg.curseforge?.projectId || '').trim();
  if (/^\d+$/.test(rawId)) return Number(rawId);

  const slug = curseforgeRef(cfg);
  if (!slug) throw new Error('CurseForge project id/slug/url not set');

  // Search Minecraft (gameId 432) modpacks by slug
  const q = new URLSearchParams({
    gameId: '432',
    classId: '4471', // Modpacks
    slug,
    pageSize: '5',
  });
  const search = await httpsJson(`https://api.curseforge.com/v1/mods/search?${q}`, {
    headers: { 'x-api-key': apiKey },
  });

  const hit =
    (search.data || []).find((m) => m.slug === slug) ||
    (search.data || [])[0];
  if (!hit?.id) {
    throw new Error(
      `CurseForge search found no modpack for slug "${slug}". Set curseforge.projectId (numeric) from the project page.`
    );
  }
  return hit.id;
}

async function checkCurseforge(cfg, onProgress) {
  if (!curseforgeConfigured(cfg)) {
    return {
      skipped: true,
      upToDate: true,
      source: 'curseforge',
      reason: 'curseforge_not_configured',
      message:
        'CurseForge project is empty in config.json — paste projectId, projectSlug, or projectUrl. Pack sync skipped.',
    };
  }

  if (!curseforgeHasApiKey(cfg)) {
    return {
      skipped: true,
      upToDate: true,
      source: 'curseforge',
      reason: 'curseforge_api_key_missing',
      message:
        'CurseForge API key missing. Create one at https://console.curseforge.com/ , then put it in installer/secrets.json (copy from secrets.example.json) or set CURSEFORGE_API_KEY. Do not ship the key inside public installers.',
    };
  }

  const apiKey = getCurseforgeApiKey(cfg);
  const ref = curseforgeRef(cfg);
  onProgress({ stage: 'check', message: `Checking CurseForge for updates (${ref})…` });

  const modId = await resolveCurseforgeModId(cfg, apiKey);
  const filesResp = await httpsJson(
    `https://api.curseforge.com/v1/mods/${modId}/files?pageSize=50`,
    { headers: { 'x-api-key': apiKey } }
  );

  const files = filesResp.data || [];
  if (files.length === 0) {
    return {
      skipped: false,
      upToDate: true,
      source: 'curseforge',
      reason: 'no_files_published',
      modId,
      message: `CurseForge project ${modId} has no published files yet. Upload a pack file, then Play will pick it up.`,
    };
  }

  const mcVer = cfg.minecraftVersion;
  const preferred =
    files.find((f) => {
      const versions = f.gameVersions || [];
      const isFabric = versions.some((v) => /fabric/i.test(v));
      const isMc = versions.some((v) => String(v) === String(mcVer));
      return isFabric && isMc && !f.isAlternate;
    }) ||
    files.find((f) => (f.gameVersions || []).includes(mcVer)) ||
    files[0];

  const local = readLocalManifest();
  if (local?.source === 'curseforge' && local?.versionId === String(preferred.id)) {
    return {
      skipped: false,
      upToDate: true,
      source: 'curseforge',
      modId,
      versionId: String(preferred.id),
      versionNumber: preferred.displayName || preferred.fileName,
      message: `Already on ${preferred.displayName || preferred.fileName}`,
    };
  }

  onProgress({
    stage: 'pending',
    message: `Update available on CurseForge: ${preferred.displayName || preferred.fileName} (zip/manifest install not wired yet)`,
  });

  // Download URL endpoint (no browser): GET /v1/mods/{modId}/files/{fileId}/download-url
  let downloadUrl = preferred.downloadUrl || null;
  try {
    const urlResp = await httpsJson(
      `https://api.curseforge.com/v1/mods/${modId}/files/${preferred.id}/download-url`,
      { headers: { 'x-api-key': apiKey } }
    );
    if (urlResp.data) downloadUrl = urlResp.data;
  } catch {
    // Some files disallow 3rd-party downloadUrl; note it for later install step
  }

  return {
    skipped: false,
    upToDate: false,
    needsInstall: true,
    source: 'curseforge',
    modId,
    versionId: String(preferred.id),
    versionNumber: preferred.displayName || preferred.fileName,
    fileName: preferred.fileName,
    downloadUrl,
    message: downloadUrl
      ? `Update available: ${preferred.displayName || preferred.fileName}. CF zip install pending (download URL resolved — no browser needed).`
      : `Update available: ${preferred.displayName || preferred.fileName}, but CurseForge returned no download URL (author may block 3rd-party downloads for this file).`,
  };
}

/**
 * Check the active pack host (config.pageDownload) for a newer pack version.
 * Full install (CF zip / MR .mrpack) is stubbed until files exist.
 */
async function checkForUpdates(onProgress = () => {}) {
  const cfg = loadConfig();
  const source = pageDownload(cfg);
  if (source === 'modrinth') return checkModrinth(cfg, onProgress);
  return checkCurseforge(cfg, onProgress);
}

module.exports = { checkForUpdates, readLocalManifest, writeLocalManifest };
