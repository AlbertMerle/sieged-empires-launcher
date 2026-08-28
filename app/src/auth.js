const fs = require('fs');
const path = require('path');
const { Auth } = require('msmc');
const { savedLoginsPath, appConfigPath } = require('./paths');
const {
  findMinecraftLauncherAccounts,
  toMclcAccount,
  toRefreshableStub,
} = require('./mc-import');

const AZURE_NATIVE_REDIRECT =
  'https://login.microsoftonline.com/common/oauth2/nativeclient';

function loadAppConfig() {
  try {
    return JSON.parse(fs.readFileSync(appConfigPath(), 'utf8'));
  } catch {
    return {};
  }
}

function emptyStore() {
  return { accounts: [], activeUuid: null };
}

function normalizeUuid(uuid) {
  if (!uuid) return '';
  const bare = String(uuid).replace(/-/g, '').toLowerCase();
  if (bare.length !== 32) return String(uuid).toLowerCase();
  return `${bare.slice(0, 8)}-${bare.slice(8, 12)}-${bare.slice(12, 16)}-${bare.slice(16, 20)}-${bare.slice(20)}`;
}

function readStore() {
  try {
    const p = savedLoginsPath();
    if (!fs.existsSync(p)) return emptyStore();
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (data.account && !data.accounts) {
      const acc = data.account;
      return { accounts: acc?.uuid ? [acc] : [], activeUuid: acc?.uuid || null };
    }
    return {
      accounts: Array.isArray(data.accounts) ? data.accounts : [],
      activeUuid: data.activeUuid || data.accounts?.[0]?.uuid || null,
    };
  } catch {
    return emptyStore();
  }
}

function writeStore(store) {
  const p = savedLoginsPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(
    p,
    JSON.stringify({ savedAt: new Date().toISOString(), ...store }, null, 2),
    'utf8'
  );
}

function isRefreshable(account) {
  return Boolean(account?.msRefresh || account?.meta?.refresh);
}

function isPlayable(account) {
  return Boolean(account?.access_token) || isRefreshable(account);
}

function toPublicProfile(account) {
  if (!account) return null;
  return {
    name: account.name,
    uuid: account.uuid,
    type: account.meta?.type || 'msa',
    importedFrom: account.importedFrom || null,
    playable: isPlayable(account),
    refreshable: isRefreshable(account),
  };
}

function upsertAccount(account) {
  const store = readStore();
  const uuid = normalizeUuid(account.uuid);
  account.uuid = uuid;
  const idx = store.accounts.findIndex((a) => normalizeUuid(a.uuid) === uuid);
  if (idx >= 0) {
    // Keep existing refresh if the new write is missing it.
    const prev = store.accounts[idx];
    store.accounts[idx] = {
      ...prev,
      ...account,
      msRefresh: account.msRefresh || prev.msRefresh || null,
      msClientId: account.msClientId || prev.msClientId || null,
    };
  } else {
    store.accounts.push(account);
  }
  store.activeUuid = uuid;
  writeStore(store);
}

function readSavedAccount() {
  const store = readStore();
  if (!store.accounts.length) return null;
  const active = normalizeUuid(store.activeUuid);
  return (
    store.accounts.find((a) => normalizeUuid(a.uuid) === active) || store.accounts[0] || null
  );
}

function listAccounts() {
  const store = readStore();
  const active = normalizeUuid(store.activeUuid);
  return store.accounts.map((a) => ({
    ...toPublicProfile(a),
    active: normalizeUuid(a.uuid) === active,
    playable: isPlayable(a),
  }));
}

/** Import any playable / refreshable tokens from other launchers into savedlogins. */
function importFromMinecraftLauncher(force = false) {
  const found = findMinecraftLauncherAccounts(force);
  const imported = [];
  const needsLogin = [];

  for (const la of found) {
    const converted = toMclcAccount(la);
    if (converted) {
      upsertAccount(converted);
      imported.push(toPublicProfile(converted));
      continue;
    }

    const stub = toRefreshableStub(la);
    if (!stub) continue;

    const store = readStore();
    const id = normalizeUuid(stub.uuid);
    const existing = store.accounts.find((a) => normalizeUuid(a.uuid) === id);

    if (existing?.access_token || existing?.msRefresh) {
      // Merge MultIMC refresh onto a stub that only has a name.
      if (!existing.msRefresh && stub.msRefresh) {
        existing.msRefresh = stub.msRefresh;
        existing.msClientId = stub.msClientId;
        existing.importedFrom = stub.importedFrom;
        writeStore(store);
        imported.push(toPublicProfile(existing));
      } else if (isPlayable(existing)) {
        imported.push(toPublicProfile(existing));
      } else {
        needsLogin.push({
          name: stub.name,
          uuid: id,
          source: stub.importedFrom,
          playable: false,
        });
      }
      continue;
    }

    const idx = store.accounts.findIndex((a) => normalizeUuid(a.uuid) === id);
    if (idx >= 0) store.accounts[idx] = { ...store.accounts[idx], ...stub };
    else store.accounts.push(stub);
    if (!store.activeUuid) store.activeUuid = id;
    writeStore(store);

    if (isPlayable(stub)) {
      imported.push(toPublicProfile(stub));
    } else {
      needsLogin.push({
        name: stub.name,
        uuid: id,
        source: stub.importedFrom,
        playable: false,
      });
    }
  }

  return { imported, needsLogin, detected: found.map((a) => a.name) };
}

function setActiveAccount(uuid) {
  const store = readStore();
  const id = normalizeUuid(uuid);
  if (!store.accounts.some((a) => normalizeUuid(a.uuid) === id)) {
    throw new Error('Account not found');
  }
  store.activeUuid = id;
  writeStore(store);
  return toPublicProfile(store.accounts.find((a) => normalizeUuid(a.uuid) === id));
}

function removeAccount(uuid) {
  const store = readStore();
  const id = normalizeUuid(uuid);
  store.accounts = store.accounts.filter((a) => normalizeUuid(a.uuid) !== id);
  if (normalizeUuid(store.activeUuid) === id) {
    store.activeUuid = store.accounts[0]?.uuid || null;
  }
  writeStore(store);
}

function clearAccount() {
  writeStore(emptyStore());
}

function createAuth(clientIdOverride) {
  const cfg = loadAppConfig();
  const clientId = (clientIdOverride || cfg.azure?.clientId || '').trim();
  if (clientId) {
    return new Auth({
      client_id: clientId,
      redirect: AZURE_NATIVE_REDIRECT,
      prompt: 'select_account',
    });
  }
  return new Auth('select_account');
}

async function finishLogin(xbox, extras = {}) {
  const mc = await xbox.getMinecraft();
  const mclcAuth = typeof mc.mclc === 'function' ? mc.mclc(true) : mc.mclc;
  const account = {
    name: mclcAuth.name,
    uuid: mclcAuth.uuid,
    access_token: mclcAuth.access_token,
    client_token: mclcAuth.client_token,
    user_properties: mclcAuth.user_properties || '{}',
    meta: mclcAuth.meta || { type: 'msa' },
    msRefresh:
      xbox?.msToken?.refresh_token || mclcAuth.meta?.refresh || extras.msRefresh || null,
    msClientId: extras.msClientId || null,
    importedFrom: extras.importedFrom || null,
    savedAt: new Date().toISOString(),
  };
  upsertAccount(account);
  return toPublicProfile(account);
}

async function loginMicrosoft(parentWindow) {
  const auth = createAuth();
  const xbox = await auth.launch('electron', {
    width: 520,
    height: 720,
    title: 'Microsoft account — Sieged Empires',
    icon: process.platform === 'win32'
      ? path.join(__dirname, '..', 'assets', 'icon.ico')
      : path.join(__dirname, '..', 'assets', 'icon-transparent.png'),
    parent: parentWindow || undefined,
    modal: Boolean(parentWindow),
    resizable: true,
    backgroundColor: '#ffffff',
  });
  return finishLogin(xbox);
}

async function loginMicrosoftBrowser() {
  const auth = createAuth();
  const xbox = await auth.launch('raw', { width: 520, height: 720 });
  return finishLogin(xbox);
}

/**
 * Silently refresh MSA → Minecraft tokens using a stored refresh token.
 * Uses per-account Azure client ID when the token came from MultiMC/Prism.
 */
async function refreshAccount(account) {
  const refreshToken = account?.msRefresh || account?.meta?.refresh;
  if (!refreshToken) {
    throw new Error('You must sign into Microsoft to Download properly!');
  }
  const auth = createAuth(account.msClientId || undefined);
  const xbox = await auth.refresh(refreshToken);
  await finishLogin(xbox, {
    msClientId: account.msClientId || null,
    importedFrom: account.importedFrom || null,
    msRefresh: xbox?.msToken?.refresh_token || refreshToken,
  });
  return readSavedAccount();
}

function tokenLooksStale(account) {
  if (!account?.access_token) return true;
  const saved = Date.parse(account.savedAt || '');
  if (Number.isNaN(saved)) return false;
  // Minecraft access tokens last ~24h; refresh a bit early.
  return Date.now() - saved > 20 * 60 * 60 * 1000;
}

/**
 * Ensure we have a usable Minecraft access token for launch.
 * Prefer existing token; silent refresh when missing/stale; never opens a login window.
 */
async function getLaunchAuth() {
  // Re-scan other launchers in case MultiMC gained a refresh token since last open.
  try {
    importFromMinecraftLauncher();
  } catch {
    /* ignore */
  }

  let account = readSavedAccount();
  if (!account) {
    throw new Error('You must sign into Microsoft to Download properly!');
  }

  const needsRefresh = !account.access_token || tokenLooksStale(account);
  if (needsRefresh) {
    if (!isRefreshable(account)) {
      if (!account.access_token) {
        throw new Error('You must sign into Microsoft to Download properly!');
      }
    } else {
      try {
        account = await refreshAccount(account);
      } catch (err) {
        if (!account.access_token) {
          console.error('Silent token refresh failed:', err?.ts || err?.message || err);
          throw new Error('You must sign into Microsoft to Download properly!');
        }
        console.warn('Silent token refresh failed; using saved token:', err?.ts || err?.message || err);
      }
    }
  }

  account = readSavedAccount();
  if (!account?.access_token) {
    throw new Error('You must sign into Microsoft to Download properly!');
  }

  return {
    access_token: account.access_token,
    client_token: account.client_token,
    uuid: account.uuid,
    name: account.name,
    user_properties: account.user_properties || '{}',
    meta: account.meta || { type: 'msa' },
  };
}

module.exports = {
  loginMicrosoft,
  loginMicrosoftBrowser,
  getLaunchAuth,
  readSavedAccount,
  listAccounts,
  setActiveAccount,
  removeAccount,
  clearAccount,
  toPublicProfile,
  importFromMinecraftLauncher,
  savedLoginsPath,
  isPlayable,
};
