const fs = require('fs');
const { installMetaPath } = require('./paths');

function readInstallMeta(installDir) {
  const p = installMetaPath(installDir);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function writeInstallMeta(installDir, data) {
  const p = installMetaPath(installDir);
  fs.mkdirSync(installDir, { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
}

function isInstallEmpty(installDir) {
  if (!fs.existsSync(installDir)) return true;
  const entries = fs.readdirSync(installDir).filter((e) => e !== '.DS_Store');
  return entries.length === 0;
}

function needsUpdate(installDir, manifestFingerprint) {
  const meta = readInstallMeta(installDir);
  if (!meta) return { needed: true, reason: 'fresh' };
  if (meta.manifestFingerprint !== manifestFingerprint) {
    return { needed: true, reason: 'outdated', previous: meta };
  }
  return { needed: false, meta };
}

module.exports = {
  readInstallMeta,
  writeInstallMeta,
  isInstallEmpty,
  needsUpdate,
};
