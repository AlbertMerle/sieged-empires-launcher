const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const {
  loginMicrosoft,
  readSavedAccount,
  clearAccount,
  toPublicProfile,
} = require('./auth');
const { checkForUpdates } = require('./updater');
const { launchGame } = require('./launcher');
const {
  loadConfig,
  pageDownload,
  activePackConfigured,
  activePackLabel,
} = require('./config');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 640,
    resizable: false,
    backgroundColor: '#000000',
    title: 'Sieged Empires',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
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

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('app:getState', async () => {
  const cfg = loadConfig();
  const account = toPublicProfile(readSavedAccount());
  return {
    account,
    appName: cfg.appName || 'Sieged Empires',
    minecraftVersion: cfg.minecraftVersion,
    pageDownload: pageDownload(cfg),
    packConfigured: activePackConfigured(cfg),
    packLabel: activePackLabel(cfg),
  };
});

ipcMain.handle('auth:login', async () => {
  const profile = await loginMicrosoft(mainWindow);
  return { ok: true, account: profile };
});

ipcMain.handle('auth:logout', async () => {
  clearAccount();
  return { ok: true };
});

ipcMain.handle('pack:checkUpdates', async () => {
  return checkForUpdates((p) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('pack:progress', p);
    }
  });
});

ipcMain.handle('game:play', async () => {
  const update = await checkForUpdates((p) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('pack:progress', p);
    }
  });

  if (update.needsInstall) {
    // Pack sync not fully implemented until Modrinth id exists / .mrpack installer lands
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('pack:progress', {
        stage: 'warn',
        message: update.message,
      });
    }
  }

  const result = await launchGame((ev) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('game:event', ev);
    }
  });

  return { ok: true, update, ...result };
});

ipcMain.handle('shell:openExternal', async (_e, url) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
    await shell.openExternal(url);
  }
});
