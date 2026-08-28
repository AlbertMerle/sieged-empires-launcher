const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { defaultInstallDir } = require('../../lib/paths');
const { loadManifest, manifestFingerprint } = require('../../lib/manifest');
const { isInstallEmpty, needsUpdate } = require('../../lib/install-meta');
const { syncPack, launchInstalledApp, resolveResourcesRoot } = require('../../lib/sync');
const { createDesktopShortcut } = require('../../lib/shortcuts');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 520,
    height: 620,
    resizable: false,
    backgroundColor: '#000000',
    title: 'Sieged Empires Setup',
    icon: process.platform === 'win32' && require('fs').existsSync(path.join(__dirname, '..', '..', 'assets', 'icon.ico'))
      ? path.join(__dirname, '..', '..', 'assets', 'icon.ico')
      : path.join(__dirname, '..', '..', 'assets', 'icon-transparent.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'ui', 'index.html'));
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function sendProgress(p) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('setup:progress', p);
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('setup:getState', async () => {
  const installDir = defaultInstallDir();
  const resourcesRoot = resolveResourcesRoot();
  let manifest = null;
  let fingerprint = null;
  let updateState = { needed: true, reason: 'unknown' };
  let empty = true;

  try {
    manifest = loadManifest(resourcesRoot);
    fingerprint = manifestFingerprint(manifest);
    empty = isInstallEmpty(installDir);
    updateState = needsUpdate(installDir, fingerprint);
  } catch (err) {
    updateState = { needed: true, reason: 'manifest_error', error: err.message };
  }

  return {
    platform: process.platform,
    defaultInstallDir: installDir,
    installEmpty: empty,
    updateNeeded: updateState.needed,
    updateReason: updateState.reason,
    manifestName: manifest?.name || 'Sieged Empires',
    modCount: (manifest?.files?.length || 0) + (manifest?.overrides?.length || 0),
  };
});

ipcMain.handle('setup:browsePath', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose install folder',
    defaultPath: defaultInstallDir(),
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths?.[0]) return { ok: false };
  return { ok: true, path: result.filePaths[0] };
});

ipcMain.handle('setup:runInstall', async (_e, installDir) => {
  if (!installDir || typeof installDir !== 'string') {
    throw new Error('Invalid install path');
  }
  const target = path.resolve(installDir);
  sendProgress({
    stage: 'mods',
    percent: 0,
    message: 'Downloading Mods from Official Websites...',
  });
  const result = await syncPack(target, sendProgress);
  sendProgress({
    stage: 'shortcut',
    percent: 99,
    message: 'Installing Config and Settings...',
  });
  const shortcut = createDesktopShortcut(target, resolveResourcesRoot());
  sendProgress({
    stage: 'done',
    percent: 100,
    message: 'Installing Config and Settings...',
  });
  return { ok: true, installDir: target, ...result, shortcut };
});

ipcMain.handle('setup:launchApp', async (_e, installDir) => launchInstalledApp(installDir));

ipcMain.handle('setup:quit', async () => {
  app.quit();
});
