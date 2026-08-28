const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

function loadConfig() {
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  return JSON.parse(raw);
}

/** @returns {'curseforge'|'modrinth'} */
function pageDownload(config = loadConfig()) {
  const v = String(config.pageDownload || 'modrinth').trim().toLowerCase();
  return v === 'curseforge' ? 'curseforge' : 'modrinth';
}

function modrinthConfigured(config = loadConfig()) {
  const id = (config.modrinth?.projectId || '').trim();
  const slug = (config.modrinth?.projectSlug || '').trim();
  return Boolean(id || slug);
}

function modrinthRef(config = loadConfig()) {
  return (config.modrinth?.projectId || config.modrinth?.projectSlug || '').trim();
}

function curseforgeConfigured(config = loadConfig()) {
  const id = String(config.curseforge?.projectId || '').trim();
  const slug = (config.curseforge?.projectSlug || '').trim();
  const url = (config.curseforge?.projectUrl || '').trim();
  return Boolean(id || slug || url);
}

function curseforgeHasApiKey(config = loadConfig()) {
  return Boolean(getCurseforgeApiKey(config));
}

/**
 * Resolve API key without baking secrets into shipped builds.
 * Order: CURSEFORGE_API_KEY env → installer/secrets.json → config.curseforge.apiKey (local only).
 */
function getCurseforgeApiKey(config = loadConfig()) {
  const fromEnv = (process.env.CURSEFORGE_API_KEY || '').trim();
  if (fromEnv) return fromEnv;

  try {
    const secretsPath = path.join(__dirname, '..', 'secrets.json');
    if (fs.existsSync(secretsPath)) {
      const secrets = JSON.parse(fs.readFileSync(secretsPath, 'utf8'));
      const k = (secrets.curseforgeApiKey || secrets.apiKey || '').trim();
      if (k && k !== 'PASTE_YOUR_KEY_HERE') return k;
    }
  } catch {
    /* ignore */
  }

  return (config.curseforge?.apiKey || '').trim();
}

/** Prefer numeric projectId; else slug; else slug parsed from projectUrl. */
function curseforgeRef(config = loadConfig()) {
  const id = String(config.curseforge?.projectId || '').trim();
  if (id) return id;
  const slug = (config.curseforge?.projectSlug || '').trim();
  if (slug) return slug;
  const url = (config.curseforge?.projectUrl || '').trim();
  if (!url) return '';
  // https://www.curseforge.com/minecraft/modpacks/some-slug
  const m = url.match(/curseforge\.com\/minecraft\/(?:modpacks|mc-mods)\/([^/?#]+)/i);
  return m ? m[1] : url;
}

function activePackConfigured(config = loadConfig()) {
  return pageDownload(config) === 'modrinth'
    ? modrinthConfigured(config)
    : curseforgeConfigured(config);
}

function activePackLabel(config = loadConfig()) {
  const src = pageDownload(config);
  if (src === 'modrinth') {
    return modrinthConfigured(config)
      ? `Modrinth: ${modrinthRef(config)}`
      : 'Modrinth: not set';
  }
  if (!curseforgeConfigured(config)) return 'CurseForge: not set';
  const ref = curseforgeRef(config);
  const key = curseforgeHasApiKey(config) ? 'key ok' : 'no apiKey';
  return `CurseForge: ${ref} (${key})`;
}

module.exports = {
  loadConfig,
  pageDownload,
  modrinthConfigured,
  modrinthRef,
  curseforgeConfigured,
  curseforgeHasApiKey,
  getCurseforgeApiKey,
  curseforgeRef,
  activePackConfigured,
  activePackLabel,
  CONFIG_PATH,
};
