const path = require('path');
const fs = require('fs');
const { Client } = require('minecraft-launcher-core');
const { loadConfig } = require('./config');
const { getLaunchAuth } = require('./auth');
const { instanceDir, versionsDir, gameRoot } = require('./paths');

/**
 * Launch Minecraft with the installed instance.
 *
 * Fabric: MCLC launches a version id under versions/. Once Modrinth .mrpack
 * sync lands (or fabricLoaderVersion + installer is wired), the instance will
 * contain a proper fabric-loader-<ver>-<mc> profile. Until then we launch the
 * vanilla MC version number so auth + JVM path can be tested.
 */
async function launchGame(onEvent = () => {}) {
  const cfg = loadConfig();
  const auth = await getLaunchAuth();
  const root = gameRoot();
  const inst = instanceDir();
  fs.mkdirSync(inst, { recursive: true });
  fs.mkdirSync(versionsDir(), { recursive: true });

  const modsDir = path.join(inst, 'mods');
  if (!fs.existsSync(modsDir)) {
    onEvent({
      type: 'warn',
      message:
        'No mods folder yet. After Modrinth project id is set, Play will sync the pack here. You can also copy client/mods into the instance for local testing.',
    });
  }

  const launcher = new Client();

  launcher.on('debug', (e) => onEvent({ type: 'debug', message: String(e) }));
  launcher.on('data', (e) => onEvent({ type: 'log', message: String(e) }));
  launcher.on('progress', (e) =>
    onEvent({
      type: 'progress',
      message: `${e.type}: ${e.task} (${e.progress}/${e.total})`,
      raw: e,
    })
  );
  launcher.on('close', (code) => onEvent({ type: 'close', code }));

  const versionNumber = cfg.minecraftVersion || '26.2';
  const customFabric = (cfg.fabricLoaderVersion || '').trim()
    ? `fabric-loader-${cfg.fabricLoaderVersion}-${versionNumber}`
    : null;

  const opts = {
    authorization: auth,
    root: inst,
    version: {
      number: versionNumber,
      type: 'release',
      ...(customFabric ? { custom: customFabric } : {}),
    },
    memory: {
      max: cfg.memory?.max || '4096',
      min: cfg.memory?.min || '2048',
    },
  };

  onEvent({
    type: 'status',
    message: customFabric
      ? `Launching ${customFabric}…`
      : `Launching Minecraft ${versionNumber} (Fabric profile not pinned yet)…`,
  });

  await launcher.launch(opts);
  return { ok: true, gameDir: inst, root };
}

module.exports = { launchGame };
