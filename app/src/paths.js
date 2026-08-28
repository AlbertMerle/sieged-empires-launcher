const fs = require('fs');
const path = require('path');
const { defaultInstallDir } = require('../../lib/paths');
const { copyFileRobust, copyTree, makeWritable, makeWritableTree } = require('../../lib/copy-file');

function bundledPackRoot() {
  const candidates = [
    process.resourcesPath ? path.join(process.resourcesPath, 'pack') : null,
    path.join(path.dirname(process.execPath), 'resources', 'pack'),
    path.join(__dirname, '..', '..', 'pack-payload'),
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'mods')) || fs.existsSync(path.join(c, 'pack-manifest.json'))) {
      return c;
    }
  }
  return null;
}

/** Ensure ~/Games/sieged-empires has config/options; SE override jars only (CDN mods via Play). */
function ensurePackInstalled(installDir) {
  const pack = bundledPackRoot();
  const mods = path.join(installDir, 'mods');

  fs.mkdirSync(installDir, { recursive: true });
  fs.mkdirSync(mods, { recursive: true });
  fs.mkdirSync(path.join(installDir, 'config'), { recursive: true });

  if (!pack) {
    return { seeded: false, reason: 'no_bundled_pack' };
  }

  // Always refresh config/options from payload; only seed SE jars if mods empty.
  if (fs.existsSync(path.join(pack, 'config'))) {
    copyTree(path.join(pack, 'config'), path.join(installDir, 'config'));
    makeWritableTree(path.join(installDir, 'config'));
  }
  if (fs.existsSync(path.join(pack, 'options.txt'))) {
    copyFileRobust(path.join(pack, 'options.txt'), path.join(installDir, 'options.txt'));
    makeWritable(path.join(installDir, 'options.txt'));
  }

  const jarCount = fs.existsSync(mods)
    ? fs.readdirSync(mods).filter((n) => n.endsWith('.jar')).length
    : 0;
  if (jarCount === 0 || process.env.SE_FORCE_PACK_SEED === '1') {
    // pack/mods contains SE overrides only — never third-party redistributes.
    if (fs.existsSync(path.join(pack, 'mods'))) {
      copyTree(path.join(pack, 'mods'), mods);
    }
    return { seeded: true, from: pack };
  }

  return { seeded: false, reason: 'already_present' };
}

function resolveInstallDir() {
  const fromEnv = (process.env.SE_INSTALL_DIR || '').trim();
  if (fromEnv) {
    fs.mkdirSync(fromEnv, { recursive: true });
    return path.resolve(fromEnv);
  }

  const candidates = [
    path.join(__dirname, '..', 'install-dir.json'),
    path.join(path.dirname(process.execPath), 'install-dir.json'),
    path.join(path.dirname(process.execPath), '..', 'install-dir.json'),
  ];

  for (const metaPath of candidates) {
    if (!fs.existsSync(metaPath)) continue;
    try {
      const j = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      if (j.installDir) {
        fs.mkdirSync(j.installDir, { recursive: true });
        return path.resolve(j.installDir);
      }
    } catch {
      /* ignore */
    }
  }

  const def = defaultInstallDir();
  fs.mkdirSync(def, { recursive: true });
  return def;
}

let cached = null;

function getInstallDir() {
  if (!cached) {
    cached = resolveInstallDir();
    ensurePackInstalled(cached);
  }
  return cached;
}

function savedLoginsPath() {
  return path.join(getInstallDir(), 'savedlogins.json');
}

function instanceDir() {
  // Game root = install dir so mods/, config/, options.txt are used by MCLC.
  return getInstallDir();
}

function modsDir() {
  return path.join(getInstallDir(), 'mods');
}

function configDir() {
  return path.join(getInstallDir(), 'config');
}

function appConfigPath() {
  return path.join(__dirname, '..', 'config.json');
}

module.exports = {
  getInstallDir,
  savedLoginsPath,
  instanceDir,
  modsDir,
  configDir,
  appConfigPath,
  ensurePackInstalled,
  bundledPackRoot,
  defaultInstallDir,
};
