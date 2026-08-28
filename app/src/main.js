const { app, BrowserWindow, ipcMain, shell, clipboard } = require('electron');
const { installCopyFilePatch } = require('../../lib/copy-file');

installCopyFilePatch();

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
const APP_VERSION = '1.0.0';

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
const { syncGamePack, packStatus } = require('./pack-sync');
const { ensureJava25 } = require('./java-runtime');

let mainWindow = null;

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

/**
 * Force-close after Minecraft starts. app.quit() is not enough on Windows
 * when Java stdio is still piped. With detached + stdio ignore, exit works.
 */
function exitLauncherNow() {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.removeAllListeners();
      mainWindow.hide();
      mainWindow.destroy();
    }
  } catch {
    /* ignore */
  }
  mainWindow = null;
  app.exit(0);
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
    useContentSize: true,
    resizable: false,
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

ipcMain.handle('app:checkUpdate', async () => {
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
      };
    }
    const outdated = compareVersions(APP_VERSION, latest) < 0;
    return {
      ok: true,
      outdated,
      current: APP_VERSION,
      latest,
      pageUrl: DOWNLOAD_PAGE_URL,
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
    pack = packStatus();
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
 * This is our own launcher — never CurseForge.
 */
ipcMain.handle('game:play', async () => {
  try {
    send('game:event', { type: 'status', message: 'Checking account…', percent: 0 });
    await getLaunchAuth();
  } catch (err) {
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
    const msg = playErrorMessage(err);
    send('game:event', { type: 'error', message: msg });
    throw new Error(msg);
  }

  try {
    await syncGamePack((p) => {
      send('game:event', {
        type: 'progress',
        percent: 8 + Math.round(((p.percent ?? 0) / 100) * 87),
        message: p.message,
        stage: p.stage,
      });
    });
  } catch (err) {
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
    const result = await launchGame((ev) => send('game:event', ev));

    // Game is running detached — close the launcher. Do not reopen when Minecraft exits.
    if (result?.quitLauncher !== false) {
      send('game:event', {
        type: 'started',
        message: 'Launching Game...',
        percent: 100,
      });
      try {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
      } catch {
        /* ignore */
      }
      setImmediate(() => exitLauncherNow());
    }

    return { ok: true, ...result };
  } catch (err) {
    const msg = playErrorMessage(err);
    send('game:event', { type: 'error', message: msg });
    throw new Error(msg);
  }
});

