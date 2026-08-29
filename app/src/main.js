const { app, BrowserWindow, ipcMain, shell, clipboard } = require('electron');
const { installCopyFilePatch } = require('../../lib/copy-file');

installCopyFilePatch();

// Enforce single instance lock across all platforms:
// Never allow more than 1 launcher open at a time.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.exit(0);
}

// Enable GPU hardware acceleration & rasterization for smooth 60fps WebM background playback
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('ignore-gpu-blocklist');

const NEWS_JSON_URL = 'https://www.siegedempires.com/news/news.json';
const NEWS_PAGE_URL = 'https://www.siegedempires.com/#news';
const DOWNLOAD_FILES_URL = 'https://www.siegedempires.com/downloads/files.json';
const DOWNLOAD_PAGE_URL = 'https://www.siegedempires.com/#download';

const DISCORD_INVITE_URL = 'https://discord.gg/JANcPMbV3';
const DISCORD_INVITE_PROTOCOL = 'discord://-/invite/JANcPMbV3';
const WEBSITE_URL = 'https://www.siegedempires.com';
const APP_VERSION = '1.0.1';

const LAUNCHER_PANEL_WIDTH = 460;
const LAUNCHER_PANEL_HEIGHT = 740;
const path = require('path');
const {
  loginMicrosoft,
  loginMicrosoftBrowser,
  readSavedAccount,
  listAccounts,
  setActiveAccount,
  removeAccount,
  clearAccount,
  toPublicProfile,
  importFromMinecraftLauncher,
  savedLoginsPath,
  getLaunchAuth,
} = require('./auth');
const { launchGame } = require('./launcher');
const { getInstallDir, ensurePackInstalled } = require('./paths');
const { syncGamePack, packStatus, readInstalledPackVersion } = require('./pack-sync');
const { ensureJava25 } = require('./java-runtime');
const { fetchLauncherStream } = require('./launcher-stream');

let mainWindow = null;
let isGameLaunching = false;
let isGameRunning = false;

app.on('second-instance', () => {
  // If game is launching or currently running, do not bring launcher to front or disrupt gameplay
  if (isGameLaunching || isGameRunning) {
    return;
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  }
});

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

function latestVersionFromDownloads(versions) {
  if (!Array.isArray(versions) || !versions.length) return null;
  let latest = null;
  for (const entry of versions) {
    const v = String(entry?.version || '').trim();
    if (!v) continue;
    if (!latest || compareVersions(v, latest) > 0) latest = v;
  }
  return latest;
}

function iconPath() {
  const ico = path.join(__dirname, '..', 'assets', 'icon.ico');
  if (process.platform === 'win32' && require('fs').existsSync(ico)) return ico;
  return path.join(__dirname, '..', 'assets', 'icon-transparent.png');
}

function send(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

function playErrorMessage(err) {
  let msg = err?.message || String(err);
  msg = msg.replace(/^Error invoking remote method '[^']+':\s*/i, '').replace(/^Error:\s*/i, '');
  if (/EPERM|EACCES|EBUSY|copyfile/i.test(msg) && !/^Could not copy /i.test(msg)) {
    return (
      'Could not copy game files (permission denied). Close Minecraft if it is running, then press Play again. ' +
      'If this folder is on OneDrive, set it to "Always keep on this device".'
    );
  }
  return msg;
}

function createWindow() {
  try {
    ensurePackInstalled(getInstallDir());
  } catch (err) {
    console.error('Pack seed failed:', err);
  }

  try {
    importFromMinecraftLauncher();
  } catch (err) {
    console.error('MC launcher import failed:', err);
  }

  mainWindow = new BrowserWindow({
    width: LAUNCHER_PANEL_WIDTH * 2,
    height: LAUNCHER_PANEL_HEIGHT,
    minWidth: LAUNCHER_PANEL_WIDTH * 2,
    minHeight: LAUNCHER_PANEL_HEIGHT,
    useContentSize: true,
    resizable: true,
    backgroundColor: '#0a0a0a',
    title: 'Sieged Empires',
    icon: iconPath(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  app.setName('Sieged Empires');
  if (process.platform === 'linux') {
    mainWindow.setTitle('Sieged Empires');
  }
  // Never open CurseForge / Overwolf / random external apps from this window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const u = String(url || '').toLowerCase();
    if (
      u.includes('curseforge') ||
      u.includes('overwolf') ||
      u.startsWith('curseforge:') ||
      u.startsWith('cfauth:')
    ) {
      return { action: 'deny' };
    }
    if (u.startsWith('https://') || u.startsWith('http://')) {
      shell.openExternal(url).catch(() => {});
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const u = String(url || '').toLowerCase();
    if (u.startsWith('file:')) return;
    event.preventDefault();
    if (u.includes('curseforge') || u.includes('overwolf')) return;
    if (u.startsWith('https://') || u.startsWith('http://')) {
      shell.openExternal(url).catch(() => {});
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'ui', 'index.html'));
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.setName('Sieged Empires');

app.whenReady().then(createWindow);

// macOS: re-create the window when the dock icon is clicked and no windows remain.
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  } else if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('discord:join', async () => {
  clipboard.writeText(DISCORD_INVITE_URL);
  try {
    await shell.openExternal(DISCORD_INVITE_PROTOCOL);
    return { ok: true, copied: true, opened: 'app' };
  } catch {
    try {
      await shell.openExternal(DISCORD_INVITE_URL);
      return { ok: true, copied: true, opened: 'browser' };
    } catch (err) {
      return {
        ok: false,
        copied: true,
        error: err?.message || String(err),
      };
    }
  }
});

ipcMain.handle('website:open', async () => {
  try {
    await shell.openExternal(WEBSITE_URL);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
});

ipcMain.handle('download:open', async () => {
  try {
    await shell.openExternal(DOWNLOAD_PAGE_URL);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
});

ipcMain.handle('news:fetch', async () => {
  try {
    const res = await fetch(NEWS_JSON_URL, {
      headers: { 'User-Agent': 'SiegedEmpires-Launcher/1.0' },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const items = Array.isArray(data) ? data : [];
    return { ok: true, items, pageUrl: NEWS_PAGE_URL };
  } catch (err) {
    return {
      ok: false,
      error: err?.message || String(err),
      items: [],
      pageUrl: NEWS_PAGE_URL,
    };
  }
});

ipcMain.handle('app:getVersion', async () => APP_VERSION);

ipcMain.handle('app:getPackVersion', async () => readInstalledPackVersion());

ipcMain.handle('app:fetchLauncherStream', async () => {
  const stream = await fetchLauncherStream();
  return {
    ...stream,
    downloadPageUrl: DOWNLOAD_PAGE_URL,
  };
});

ipcMain.handle('app:checkUpdate', async () => {
  const stream = await fetchLauncherStream();
  if (stream.ok) {
    return {
      ok: true,
      outdated: stream.needsLauncherUpdate,
      current: APP_VERSION,
      latest: null,
      pageUrl: DOWNLOAD_PAGE_URL,
      source: 'gist',
      config: stream.config,
    };
  }
  try {
    const res = await fetch(DOWNLOAD_FILES_URL, {
      headers: { 'User-Agent': 'SiegedEmpires-Launcher/1.0' },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const latest = latestVersionFromDownloads(data);
    if (!latest) {
      return {
        ok: true,
        outdated: false,
        current: APP_VERSION,
        latest: null,
        pageUrl: DOWNLOAD_PAGE_URL,
        source: 'files.json',
      };
    }
    const outdated = compareVersions(APP_VERSION, latest) < 0;
    return {
      ok: true,
      outdated,
      current: APP_VERSION,
      latest,
      pageUrl: DOWNLOAD_PAGE_URL,
      source: 'files.json',
    };
  } catch (err) {
    return {
      ok: false,
      outdated: false,
      current: APP_VERSION,
      latest: null,
      pageUrl: DOWNLOAD_PAGE_URL,
      error: err?.message || String(err),
    };
  }
});

ipcMain.handle('app:getState', async () => {
  let installDir = '';
  let pack = { modCount: 0, updateNeeded: true };
  try {
    installDir = getInstallDir();
    // Re-import so MultiMC / official launcher accounts show as playable without re-login.
    try {
      importFromMinecraftLauncher();
    } catch (err) {
      console.warn('MC launcher re-import:', err?.message || err);
    }
    pack = await packStatus();
  } catch (err) {
    return { error: err.message, account: null, accounts: [], pack: null };
  }
  return {
    account: toPublicProfile(readSavedAccount()),
    accounts: listAccounts(),
    installDir,
    savedLoginsFile: savedLoginsPath(),
    pack,
    appName: 'Sieged Empires',
  };
});

ipcMain.handle('auth:login', async () => {
  const profile = await loginMicrosoft(mainWindow);
  return { ok: true, account: profile, accounts: listAccounts() };
});

ipcMain.handle('auth:loginBrowser', async () => {
  const profile = await loginMicrosoftBrowser();
  return { ok: true, account: profile, accounts: listAccounts() };
});

ipcMain.handle('auth:select', async (_e, uuid) => {
  const profile = setActiveAccount(uuid);
  return { ok: true, account: profile, accounts: listAccounts() };
});

ipcMain.handle('auth:remove', async (_e, uuid) => {
  removeAccount(uuid);
  return { ok: true, account: toPublicProfile(readSavedAccount()), accounts: listAccounts() };
});

ipcMain.handle('auth:logout', async () => {
  clearAccount();
  return { ok: true };
});

ipcMain.handle('auth:reimport', async () => {
  const result = importFromMinecraftLauncher(true);
  return {
    ok: true,
    ...result,
    accounts: listAccounts(),
    account: toPublicProfile(readSavedAccount()),
  };
});

/**
 * Play = require login → sync pack (progress) → launch Minecraft + Fabric + mods.
 * When the game window opens, quit the launcher (Minecraft keeps running).
 * If launch fails, keep the launcher open with an error message.
 */
ipcMain.handle('game:play', async () => {
  isGameLaunching = true;
  try {
    send('game:event', { type: 'status', message: 'Checking account…', percent: 0 });
    await getLaunchAuth();
  } catch (err) {
    isGameLaunching = false;
    const msg = playErrorMessage(err);
    send('game:event', { type: 'error', message: msg });
    throw new Error(msg);
  }

  send('game:event', { type: 'status', message: 'Preparing install…', percent: 0 });

  try {
    await ensureJava25((p) => {
      send('game:event', {
        type: 'progress',
        percent: Math.min(8, p.percent ?? 0),
        message: p.message,
        stage: p.stage || 'java',
      });
    });
  } catch (err) {
    isGameLaunching = false;
    const msg = playErrorMessage(err);
    send('game:event', { type: 'error', message: msg });
    throw new Error(msg);
  }

  send('game:event', { type: 'status', message: 'Checking for updates…', percent: 0 });

  try {
    await syncGamePack((p) => {
      send('game:event', {
        type: 'progress',
        percent: 8 + Math.round(((p.percent ?? 0) / 100) * 87),
        message: p.message,
        stage: p.stage,
        packVersion: p.packVersion,
        installedPackVersion: p.installedPackVersion,
      });
      if (p.installedPackVersion) {
        send('game:event', {
          type: 'pack-version',
          version: p.installedPackVersion,
        });
      }
    });
  } catch (err) {
    isGameLaunching = false;
    const msg = playErrorMessage(err);
    send('game:event', { type: 'error', message: msg });
    throw new Error(msg);
  }

  try {
    send('game:event', {
      type: 'status',
      message: 'Downloading Minecraft…',
      percent: 5,
    });

    const result = await launchGame(
      (ev) => send('game:event', ev),
      (exitInfo) => {
        isGameRunning = false;
        isGameLaunching = false;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
          mainWindow.restore();
          mainWindow.focus();
        }
        send('game:event', {
          type: 'game-exit',
          outcome: exitInfo?.outcome || 'quit',
          message: exitInfo?.message || '',
        });
      }
    );

    isGameLaunching = false;
    isGameRunning = false;
    send('game:event', {
      type: 'started',
      message: 'Launching Game...',
      percent: 100,
    });

    // Close the launcher once Minecraft is running (do not hide + re-open on exit).
    app.quit();

    return { ok: true, ...result };
  } catch (err) {
    isGameLaunching = false;
    isGameRunning = false;
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.restore();
      mainWindow.focus();
    }
    const msg = playErrorMessage(err);
    send('game:event', { type: 'error', message: msg });
    throw new Error(msg);
  }
});

