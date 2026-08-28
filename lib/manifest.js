const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function bundledManifestPath(resourcesRoot) {
  return path.join(resourcesRoot, 'files', 'manifest.json');
}

function bundledOverridesDir(resourcesRoot) {
  return path.join(resourcesRoot, 'files', 'mods');
}

function bundledConfigDir(resourcesRoot) {
  return path.join(resourcesRoot, 'files', 'config');
}

function loadManifest(resourcesRoot) {
  const p = bundledManifestPath(resourcesRoot);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function manifestFingerprint(manifest) {
  return crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
}

/** All mod paths the client pack should have (relative to install root). */
function expectedModPaths(manifest) {
  const paths = new Set();
  for (const entry of manifest.files || []) {
    if (entry.path && entry.path.startsWith('mods/')) paths.add(entry.path);
  }
  for (const entry of manifest.overrides || []) {
    if (entry.path && entry.path.startsWith('mods/')) paths.add(entry.path);
  }
  return paths;
}

function expectedModFilenames(manifest) {
  const names = new Set();
  for (const rel of expectedModPaths(manifest)) {
    names.add(path.basename(rel));
  }
  return names;
}

module.exports = {
  bundledManifestPath,
  bundledOverridesDir,
  bundledConfigDir,
  loadManifest,
  manifestFingerprint,
  expectedModPaths,
  expectedModFilenames,
};
