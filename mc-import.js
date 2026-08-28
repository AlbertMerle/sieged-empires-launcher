/**
 * Read Microsoft/Minecraft accounts from the official Minecraft Launcher
 * and MultiMC / Prism-family launchers (for MSA refresh tokens).
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

/** MultiMC / PolyMC / Prism-family Azure app IDs (refresh tokens are bound to these). */
const MULTIMC_MSA_CLIENT_ID = '499546d9-bbfe-4b9b-a086-eb3d75afb78f';
const PRISM_MSA_CLIENT_ID = 'c36a9fb6-a1f0-4ff0-8f89-5d2c8d1a8c1e';

function candidateMinecraftDirs() {
  const home = os.homedir();
  const dirs = [];

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    dirs.push(path.join(appData, '.minecraft'));
    dirs.push(path.join(appData, 'Minecraft'));
    dirs.push(path.join(local, 'Packages'));
  } else {
    dirs.push(path.join(home, '.minecraft'));
    dirs.push(path.join(home, 'snap', 'minecraft', 'common', '.minecraft'));
    const snap = path.join(home, 'snap');
    if (fs.existsSync(snap)) {
      for (const name of fs.readdirSync(snap)) {
        const p = path.join(snap, name);
        try {
          if (!fs.statSync(p).isDirectory()) continue;
        } catch {
          continue;
        }
        for (const sub of fs.readdirSync(p)) {
          const mc = path.join(p, sub, '.minecraft');
          if (fs.existsSync(mc)) dirs.push(mc);
        }
      }
    }
    dirs.push(path.join(home, '.var', 'app', 'com.mojang.Minecraft', 'data', '.minecraft'));
  }

  return dirs;
}

function accountFilesIn(dir) {
  const names = [
    'launcher_accounts.json',
    'launcher_accounts_microsoft_store.json',
  ];
  return names.map((n) => path.join(dir, n)).filter((p) => fs.existsSync(p));
}

function parseLauncherAccountsFile(filePath) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return [];
  }

  const out = [];
  const accounts = data.accounts || {};
  const clientToken = data.mojangClientToken || '';

  for (const [localId, raw] of Object.entries(accounts)) {
    const profile = raw.minecraftProfile || {};
    const name = profile.name || raw.username || null;
    const uuid = (profile.id || '').replace(/-/g, '');
    if (!name && !uuid) continue;

    const token = (raw.accessToken || '').trim();
    out.push({
      source: 'minecraft_launcher',
      sourceFile: filePath,
      localId,
      name: name || 'Unknown',
      uuid: uuid || localId,
      access_token: token || null,
      client_token: clientToken || localId,
      hasToken: Boolean(token),
      username: raw.username || null,
      type: raw.type || 'Xbox',
      expiresAt: raw.accessTokenExpiresAt || null,
      msRefresh: null,
      msClientId: null,
    });
  }
  return out;
}

function multimcStyleDirs() {
  const home = os.homedir();
  const dirs = [];

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    dirs.push(
      { dir: path.join(appData, 'PrismLauncher'), clientId: PRISM_MSA_CLIENT_ID },
      { dir: path.join(appData, 'PolyMC'), clientId: MULTIMC_MSA_CLIENT_ID },
      { dir: path.join(appData, 'MultiMC'), clientId: MULTIMC_MSA_CLIENT_ID },
      { dir: path.join(local, 'Programs', 'MultiMC'), clientId: MULTIMC_MSA_CLIENT_ID }
    );
  } else if (process.platform === 'darwin') {
    dirs.push(
      {
        dir: path.join(home, 'Library', 'Application Support', 'PrismLauncher'),
        clientId: PRISM_MSA_CLIENT_ID,
      },
      {
        dir: path.join(home, 'Library', 'Application Support', 'PolyMC'),
        clientId: MULTIMC_MSA_CLIENT_ID,
      },
      {
        dir: path.join(home, 'Library', 'Application Support', 'MultiMC'),
        clientId: MULTIMC_MSA_CLIENT_ID,
      }
    );
  } else {
    dirs.push(
      { dir: path.join(home, '.local', 'share', 'PrismLauncher'), clientId: PRISM_MSA_CLIENT_ID },
      { dir: path.join(home, '.local', 'share', 'pollymc'), clientId: PRISM_MSA_CLIENT_ID },
      { dir: path.join(home, '.local', 'share', 'PolyMC'), clientId: MULTIMC_MSA_CLIENT_ID },
      { dir: path.join(home, '.local', 'share', 'multimc'), clientId: MULTIMC_MSA_CLIENT_ID },
      { dir: path.join(home, '.local', 'share', 'MultiMC'), clientId: MULTIMC_MSA_CLIENT_ID }
    );
  }

  return dirs;
}

function formatUuid(bareOrDashed) {
  const bare = String(bareOrDashed || '').replace(/-/g, '').toLowerCase();
  if (bare.length !== 32) return String(bareOrDashed || '');
  return `${bare.slice(0, 8)}-${bare.slice(8, 12)}-${bare.slice(12, 16)}-${bare.slice(16, 20)}-${bare.slice(20)}`;
}

function parseMultimcAccountsFile(filePath, defaultClientId) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return [];
  }

  const list = Array.isArray(data.accounts) ? data.accounts : [];
  const out = [];

  for (const raw of list) {
    if ((raw.type || '').toUpperCase() === 'OFFLINE') continue;
    const profile = raw.profile || {};
    const name = profile.name || null;
    const uuid = (profile.id || '').replace(/-/g, '');
    if (!name && !uuid) continue;

    const msa = raw.msa || {};
    const ygg = raw.ygg || {};
    const refresh = (msa.refresh_token || '').trim();
    const yggToken = (ygg.token || '').trim();
    const clientId = (raw.msaClientID || raw.msaClientId || defaultClientId || '').trim();

    out.push({
      source: 'multimc_family',
      sourceFile: filePath,
      localId: uuid || name,
      name: name || 'Unknown',
      uuid: uuid || name,
      access_token: yggToken || null,
      client_token: uuid || name,
      hasToken: Boolean(yggToken),
      expiresAt: ygg.exp ? new Date(ygg.exp * 1000).toISOString() : null,
      msRefresh: refresh || null,
      msClientId: clientId || null,
      username: null,
      type: 'MSA',
    });
  }

  return out;
}

/** Scan disk for launcher accounts (does not write anything). */
function findMinecraftLauncherAccounts() {
  const seen = new Set();
  const found = [];

  for (const dir of candidateMinecraftDirs()) {
    if (!fs.existsSync(dir)) continue;

    const files = accountFilesIn(dir);
    if (process.platform === 'win32' && path.basename(dir) === 'Packages') {
      try {
        for (const pkg of fs.readdirSync(dir)) {
          if (!/Minecraft/i.test(pkg)) continue;
          const nested = path.join(dir, pkg, 'LocalCache', 'Local', '.minecraft');
          files.push(...accountFilesIn(nested));
        }
      } catch {
        /* ignore */
      }
    }

    for (const file of files) {
      for (const acc of parseLauncherAccountsFile(file)) {
        const key = (acc.uuid || acc.name).toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        found.push(acc);
      }
    }
  }

  for (const { dir, clientId } of multimcStyleDirs()) {
    const file = path.join(dir, 'accounts.json');
    if (!fs.existsSync(file)) continue;
    for (const acc of parseMultimcAccountsFile(file, clientId)) {
      const key = (acc.uuid || acc.name).toLowerCase();
      const existing = found.find((a) => (a.uuid || a.name).toLowerCase() === key);
      if (existing) {
        // Prefer MultIMC refresh when official launcher has no usable token.
        if (!existing.msRefresh && acc.msRefresh) {
          existing.msRefresh = acc.msRefresh;
          existing.msClientId = acc.msClientId;
          existing.source = `${existing.source}+multimc_family`;
        }
        if (!existing.hasToken && acc.hasToken) {
          existing.access_token = acc.access_token;
          existing.hasToken = true;
          existing.expiresAt = acc.expiresAt;
        }
        continue;
      }
      seen.add(key);
      found.push(acc);
    }
  }

  return found;
}

/**
 * Convert a launcher account with a live accessToken into MCLC auth shape.
 * Returns null if token missing/expired (caller may still use msRefresh).
 */
function toMclcAccount(launcherAcc) {
  if (!launcherAcc?.hasToken || !launcherAcc.access_token) return null;
  if (launcherAcc.expiresAt) {
    const exp = Date.parse(launcherAcc.expiresAt);
    if (!Number.isNaN(exp) && exp < Date.now() - 60_000) return null;
  }
  return {
    name: launcherAcc.name,
    uuid: formatUuid(launcherAcc.uuid),
    access_token: launcherAcc.access_token,
    client_token: launcherAcc.client_token,
    user_properties: '{}',
    meta: { type: 'msa' },
    msRefresh: launcherAcc.msRefresh || null,
    msClientId: launcherAcc.msClientId || null,
    importedFrom: launcherAcc.source,
    savedAt: new Date().toISOString(),
  };
}

/** Stub / refresh-capable account when live MC token is missing. */
function toRefreshableStub(launcherAcc) {
  if (!launcherAcc?.msRefresh && !launcherAcc?.name) return null;
  return {
    name: launcherAcc.name,
    uuid: formatUuid(launcherAcc.uuid),
    access_token: null,
    client_token: launcherAcc.client_token || launcherAcc.uuid,
    user_properties: '{}',
    meta: { type: 'msa' },
    msRefresh: launcherAcc.msRefresh || null,
    msClientId: launcherAcc.msClientId || null,
    importedFrom: launcherAcc.source,
    savedAt: new Date().toISOString(),
  };
}

module.exports = {
  findMinecraftLauncherAccounts,
  toMclcAccount,
  toRefreshableStub,
  MULTIMC_MSA_CLIENT_ID,
  PRISM_MSA_CLIENT_ID,
};
