const fs = require('fs');
const path = require('path');
const { Auth } = require('msmc');
const { loadConfig } = require('./config');
const { accountsPath } = require('./paths');

/**
 * Microsoft → Xbox → Minecraft OAuth via msmc.
 * Opens Microsoft's login UI in an Electron BrowserWindow (embedded).
 *
 * Production: register an Entra app, set azure.clientId in config.json, then
 * request Minecraft Services whitelist: https://aka.ms/mce-reviewappid
 * Reference: https://github.com/dscalzi/HeliosLauncher/blob/master/docs/MicrosoftAuth.md
 *
 * Until clientId is set, msmc uses Mojang's public desktop client id
 * (00000000402b5328) — fine for local testing, not ideal for shipping.
 */

const AZURE_NATIVE_REDIRECT =
  'https://login.microsoftonline.com/common/oauth2/nativeclient';

function readSavedAccount() {
  try {
    const p = accountsPath();
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function saveAccount(account) {
  const p = accountsPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(account, null, 2), 'utf8');
}

function clearAccount() {
  const p = accountsPath();
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

function toPublicProfile(account) {
  if (!account) return null;
  return {
    name: account.name,
    uuid: account.uuid,
    type: account.meta?.type || 'msa',
  };
}

function createAuth() {
  const cfg = loadConfig();
  const clientId = (cfg.azure?.clientId || '').trim();
  if (clientId) {
    return new Auth({
      client_id: clientId,
      redirect: AZURE_NATIVE_REDIRECT,
      prompt: 'select_account',
    });
  }
  return new Auth('select_account');
}

/**
 * @param {import('electron').BrowserWindow} parentWindow
 */
async function loginMicrosoft(parentWindow) {
  const auth = createAuth();

  const xbox = await auth.launch('electron', {
    width: 520,
    height: 700,
    title: 'Sign in — Sieged Empires',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    parent: parentWindow || undefined,
    modal: Boolean(parentWindow),
    resizable: false,
    backgroundColor: '#000000',
  });

  const mc = await xbox.getMinecraft();
  const mclcAuth = typeof mc.mclc === 'function' ? mc.mclc() : mc.mclc;

  const account = {
    name: mclcAuth.name,
    uuid: mclcAuth.uuid,
    access_token: mclcAuth.access_token,
    client_token: mclcAuth.client_token,
    user_properties: mclcAuth.user_properties || '{}',
    meta: mclcAuth.meta || { type: 'msa' },
    msRefresh: xbox?.msToken?.refresh_token || mclcAuth.meta?.refresh || null,
    savedAt: new Date().toISOString(),
  };

  saveAccount(account);
  return toPublicProfile(account);
}

async function getLaunchAuth() {
  const account = readSavedAccount();
  if (!account?.access_token) {
    throw new Error('Not logged in');
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
  getLaunchAuth,
  readSavedAccount,
  clearAccount,
  toPublicProfile,
  saveAccount,
};
