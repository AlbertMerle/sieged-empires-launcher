const path = require('path');
const os = require('os');

/**
 * Default install roots per platform.
 * Linux: ~/Games/sieged-empires  (capital G — Linux paths are case-sensitive)
 * Windows: %APPDATA%/sieged-empires
 * macOS: ~/Library/Application Support/sieged-empires
 */
function defaultInstallDir() {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'sieged-empires');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'sieged-empires');
  }
  return path.join(os.homedir(), 'Games', 'sieged-empires');
}

function launcherAppDir(installDir) {
  return path.join(installDir, 'Sieged Empires');
}

function installMetaPath(installDir) {
  return path.join(installDir, 'install-meta.json');
}

function savedLoginsPath(installDir) {
  return path.join(installDir, 'savedlogins.json');
}

function packManifestPath(installDir) {
  return path.join(installDir, 'pack-manifest.json');
}

function instanceDir(installDir) {
  return path.join(installDir, 'instance');
}

function modsDir(installDir) {
  return path.join(installDir, 'mods');
}

function configDir(installDir) {
  return path.join(installDir, 'config');
}

module.exports = {
  defaultInstallDir,
  launcherAppDir,
  installMetaPath,
  savedLoginsPath,
  packManifestPath,
  instanceDir,
  modsDir,
  configDir,
};
