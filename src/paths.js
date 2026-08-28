const path = require('path');
const { app } = require('electron');
const { loadConfig } = require('./config');

function gameRoot() {
  const cfg = loadConfig();
  const name = cfg.gameDirName || 'sieged-empires';
  return path.join(app.getPath('userData'), name);
}

function instanceDir() {
  return path.join(gameRoot(), 'instance');
}

function accountsPath() {
  return path.join(gameRoot(), 'account.json');
}

function versionsDir() {
  return path.join(gameRoot(), 'versions');
}

module.exports = { gameRoot, instanceDir, accountsPath, versionsDir };
