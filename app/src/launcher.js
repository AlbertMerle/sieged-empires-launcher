/**
 * After Minecraft starts: detach the game process, apply SE icon association,
 * and let the Electron app quit (do not reopen when the game closes).
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { Client } = require('minecraft-launcher-core');
const { getLaunchAuth } = require('./auth');
const { instanceDir, modsDir, configDir, appConfigPath, getInstallDir } = require('./paths');
const { getJavaPath } = require('./java-runtime');
const { getMemoryState } = require('./memory-settings');
const { makeWritable, makeWritableTree } = require('../../lib/copy-file');

function loadAppConfig() {
  try {
    return JSON.parse(fs.readFileSync(appConfigPath(), 'utf8'));
  } catch {
    return { minecraftVersion: '26.2', memory: { min: '2048', max: '4096' } };
  }
}

function resolveLaunchJavaPath(javaPath) {
  if (process.platform !== 'win32' || !javaPath) return javaPath;
  const javaw = javaPath.replace(/java\.exe$/i, 'javaw.exe');
  if (javaw !== javaPath && fs.existsSync(javaw)) return javaw;
  return javaPath;
}

function isGameWindowLog(text) {
  return /LWJGL|GLFW|OpenGL|Setting user:|Backend library|Opened .*window/i.test(
    String(text || '')
  );
}

function isFatalLaunchLog(text) {
  return /Could not create the Java Virtual Machine|Error: A fatal exception|Unable to locate Java|Invalid maximum heap size|Unable to lock JVM Memory/i.test(
    String(text || '')
  );
}

function processAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function gameLogPath(gameRoot) {
  return path.join(gameRoot, 'logs', 'latest.log');
}

function getLogMtime(gameRoot) {
  try {
    return fs.statSync(gameLogPath(gameRoot)).mtimeMs;
  } catch {
    return 0;
  }
}

function readCurrentSessionLog(gameRoot, spawnTime, initialMtime) {
  try {
    const p = gameLogPath(gameRoot);
    if (!fs.existsSync(p)) return '';
    const st = fs.statSync(p);
    // If log hasn't been modified since spawn and still has old mtime, game hasn't started logging yet
    if (st.mtimeMs <= initialMtime && st.mtimeMs < spawnTime - 500) {
      return '';
    }
    return fs.readFileSync(p, 'utf8');
  } catch {
    return '';
  }
}

/**
 * Spawn javaw/java with no pipes so Electron can monitor the child without
 * holding stdio streams open.
 */
function spawnDetachedMinecraft(javaPath, launchArguments, cwd) {
  const { spawn } = require('child_process');
  const proc = spawn(javaPath, launchArguments, {
    cwd,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: process.env,
  });
  // Allow Electron to exit without taking Minecraft down with it.
  if (typeof proc.unref === 'function') proc.unref();
  return proc;
}

function detectGameCrash(gameRoot, gameStartTime, exitCode, exitSignal) {
  if (exitCode !== null && exitCode !== undefined && exitCode !== 0) {
    return true;
  }
  if (exitSignal && ['SIGSEGV', 'SIGABRT', 'SIGILL', 'SIGBUS', 'SIGFPE', 'SIGKILL'].includes(exitSignal)) {
    return true;
  }

  try {
    const crashDir = path.join(gameRoot, 'crash-reports');
    if (fs.existsSync(crashDir)) {
      const files = fs.readdirSync(crashDir);
      for (const file of files) {
        if (file.endsWith('.txt')) {
          const st = fs.statSync(path.join(crashDir, file));
          if (st.mtimeMs >= gameStartTime - 2000) {
            return true;
          }
        }
      }
    }
  } catch {
    /* ignore */
  }

  try {
    const files = fs.readdirSync(gameRoot);
    for (const file of files) {
      if (/^hs_err_pid.*\.log$/i.test(file)) {
        const st = fs.statSync(path.join(gameRoot, file));
        if (st.mtimeMs >= gameStartTime - 2000) {
          return true;
        }
      }
    }
  } catch {
    /* ignore */
  }

  try {
    const logPath = path.join(gameRoot, 'logs', 'latest.log');
    if (fs.existsSync(logPath)) {
      const st = fs.statSync(logPath);
      if (st.mtimeMs >= gameStartTime - 2000) {
        const readLen = Math.min(st.size, 8192);
        if (readLen > 0) {
          const fd = fs.openSync(logPath, 'r');
          const buf = Buffer.alloc(readLen);
          fs.readSync(fd, buf, 0, readLen, Math.max(0, st.size - readLen));
          fs.closeSync(fd);
          const tail = buf.toString('utf8');
          if (
            /---- Minecraft Crash Report ----|This crash report has been saved to:|# A fatal error has been detected by the Java Runtime Environment:|Exception in thread "[^"]*" java\.lang\.|FATAL/i.test(
              tail
            ) &&
            !/Stopping!|Sound engine shut down/i.test(tail.slice(-500))
          ) {
            return true;
          }
        }
      }
    }
  } catch {
    /* ignore */
  }

  return false;
}

/**
 * Wait until Minecraft has actually opened (log lines written after spawn).
 * If the JVM dies first, keep the launcher open so Play can show the error.
 */
function waitUntilMinecraftOpened(pid, gameRoot, onEvent) {
  return new Promise((resolve, reject) => {
    const initialMtime = getLogMtime(gameRoot);
    const startedAt = Date.now();
    const maxMs = 60000;
    let settled = false;

    const finish = (err) => {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      if (err) reject(err);
      else resolve();
    };

    const timer = setInterval(() => {
      const chunk = readCurrentSessionLog(gameRoot, startedAt, initialMtime);

      if (!processAlive(pid)) {
        if (isFatalLaunchLog(chunk)) {
          finish(
            new Error(chunk.trim().split(/\r?\n/).filter(Boolean).pop() || 'Minecraft failed to start.')
          );
          return;
        }
        finish(new Error('Minecraft exited before the game window opened.'));
        return;
      }

      if (isFatalLaunchLog(chunk)) {
        finish(
          new Error(chunk.trim().split(/\r?\n/).filter(Boolean).pop() || 'Minecraft failed to start.')
        );
        return;
      }
      if (isGameWindowLog(chunk)) {
        onEvent({ type: 'log', message: chunk.slice(-500) });
        finish();
        return;
      }
      if (Date.now() - startedAt > maxMs) {
        finish(
          new Error(
            'Minecraft did not open within 60 seconds. Check logs/latest.log in your install folder.'
          )
        );
      }
    }, 250);
  });
}

function resolveBrandingIcon() {
  const candidates = [
    process.resourcesPath
      ? path.join(process.resourcesPath, 'assets', 'icon-transparent.png')
      : null,
    process.resourcesPath ? path.join(process.resourcesPath, 'assets', 'icon.png') : null,
    path.join(__dirname, '..', 'assets', 'icon-transparent.png'),
    path.join(__dirname, '..', 'assets', 'icon.png'),
    path.join(getInstallDir(), 'icon.png'),
    '/usr/share/icons/hicolor/256x256/apps/sieged-empires.png',
    '/usr/share/icons/hicolor/1024x1024/apps/sieged-empires.png',
  ].filter(Boolean);
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * GNOME/KDE match the running Minecraft window to this .desktop via StartupWMClass
 * so the dock/hotbar shows the Sieged Empires icon instead of generic Java.
 */
function installGameIconDesktop(mcVersion) {
  if (process.platform !== 'linux') return;
  const icon = resolveBrandingIcon();
  if (!icon) return;

  const dir = path.join(os.homedir(), '.local', 'share', 'applications');
  fs.mkdirSync(dir, { recursive: true });

  // Early GLFW class uses the window title ("Minecraft* 26.2" / "Minecraft 26.2").
  // After our mod runs, title becomes "Sieged Empires".
  const classes = [
    'Sieged Empires',
    `Minecraft* ${mcVersion}`,
    `Minecraft ${mcVersion}`,
    'Minecraft',
  ];

  const launcherExecPath = fs.existsSync('/usr/bin/sieged-empires')
    ? '/usr/bin/sieged-empires'
    : path.join(getInstallDir(), 'run-launcher.sh');

  const lines = [
    '[Desktop Entry]',
    'Version=1.0',
    'Type=Application',
    'Name=Sieged Empires',
    'Comment=Sieged Empires (Minecraft)',
    `Exec=${launcherExecPath} %U`,
    `Icon=${icon}`,
    'Terminal=false',
    'Categories=Game;',
    'NoDisplay=true',
    'StartupNotify=true',
  ];

  // One file per WM class — desktop spec allows a single StartupWMClass each.
  classes.forEach((wm, i) => {
    const dest = path.join(dir, `sieged-empires-game-${i}.desktop`);
    fs.writeFileSync(dest, `${lines.join('\n')}\nStartupWMClass=${wm}\n`, 'utf8');
    try {
      fs.chmodSync(dest, 0o644);
    } catch {
      /* ignore */
    }
  });

  // Also point the visible launcher desktop at Sieged Empires so pinned icons stay branded.
  const userLauncher = path.join(dir, 'sieged-empires.desktop');
  if (fs.existsSync(userLauncher)) {
    let text = fs.readFileSync(userLauncher, 'utf8');
    if (!text.includes('StartupWMClass=')) {
      text = text.trimEnd() + '\nStartupWMClass=Sieged Empires\n';
    } else {
      text = text.replace(/StartupWMClass=.*/m, 'StartupWMClass=Sieged Empires');
    }
    if (icon && !text.includes(`Icon=${icon}`)) {
      text = text.replace(/^Icon=.*$/m, `Icon=${icon}`);
    }
    fs.writeFileSync(userLauncher, text, 'utf8');
  }

  try {
    const { execFileSync } = require('child_process');
    execFileSync('update-desktop-database', [dir], { stdio: 'ignore' });
  } catch {
    /* optional */
  }
}

function httpsGetJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'SiegedEmpiresLauncher/0.3.6' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          httpsGetJson(res.headers.location).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch (err) {
            reject(err);
          }
        });
      })
      .on('error', reject);
  });
}

async function ensureFabric(gameRoot, mcVersion, pinnedLoader, onEvent) {
  let loaderVersion = (pinnedLoader || '').trim();
  if (!loaderVersion) {
    onEvent({ type: 'status', message: 'Looking up Fabric loader…' });
    const list = await httpsGetJson(
      `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(mcVersion)}`
    );
    const stable = list.find((e) => e.loader?.stable) || list[0];
    loaderVersion = stable?.loader?.version;
    if (!loaderVersion) throw new Error(`No Fabric loader found for Minecraft ${mcVersion}`);
  }

  const versionId = `fabric-loader-${loaderVersion}-${mcVersion}`;
  const versionDir = path.join(gameRoot, 'versions', versionId);
  const jsonPath = path.join(versionDir, `${versionId}.json`);

  if (fs.existsSync(jsonPath)) {
    onEvent({ type: 'status', message: `Fabric ${loaderVersion} already installed.` });
    return versionId;
  }

  onEvent({
    type: 'status',
    message: `Installing Fabric ${loaderVersion} for Minecraft ${mcVersion}…`,
  });
  const profile = await httpsGetJson(
    `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(mcVersion)}/${encodeURIComponent(loaderVersion)}/profile/json`
  );
  fs.mkdirSync(versionDir, { recursive: true });
  fs.writeFileSync(jsonPath, JSON.stringify(profile, null, 2), 'utf8');
  onEvent({ type: 'status', message: `Fabric ${loaderVersion} profile ready.` });
  return versionId;
}

async function launchGame(onEvent = () => {}, onGameExit = () => {}) {
  const gameStartTime = Date.now();
  const cfg = loadAppConfig();
  const auth = await getLaunchAuth();
  const gameRoot = instanceDir();
  const mods = modsDir();

  fs.mkdirSync(gameRoot, { recursive: true });
  fs.mkdirSync(path.join(gameRoot, 'versions'), { recursive: true });
  makeWritableTree(configDir());
  makeWritable(path.join(gameRoot, 'options.txt'));

  if (!fs.existsSync(mods) || fs.readdirSync(mods).filter((n) => n.endsWith('.jar')).length === 0) {
    onEvent({
      type: 'warn',
      message: 'No mods yet — pack sync should run before launch. Press Play again if the game fails.',
    });
  }

  const versionNumber = cfg.minecraftVersion || '26.2';
  installGameIconDesktop(versionNumber);

  const fabricId = await ensureFabric(
    gameRoot,
    versionNumber,
    cfg.fabricLoaderVersion,
    onEvent
  );

  let lastProgressPercent = -1;
  let lastProgressTime = 0;

  const launcher = new Client();
  launcher.on('debug', (e) => onEvent({ type: 'debug', message: String(e) }));
  launcher.on('data', (e) => onEvent({ type: 'log', message: String(e) }));
  launcher.on('progress', (e) => {
    const task = Number(e.task) || 0;
    const total = Number(e.total) || 0;
    const frac = total > 0 ? Math.min(1, Math.max(0, task / total)) : 0;
    const ranges = {
      assets: [5, 75],
      'assets-copy': [75, 82],
      classes: [82, 92],
      'classes-maven-custom': [82, 92],
      natives: [92, 98],
    };
    const [lo, hi] = ranges[e.type] || [0, 100];
    const percent = Math.round(lo + frac * (hi - lo));
    const now = Date.now();
    if (percent === lastProgressPercent && now - lastProgressTime < 80) return;
    lastProgressPercent = percent;
    lastProgressTime = now;

    const label =
      e.type === 'assets'
        ? `Downloading Minecraft assets (${task}/${total})…`
        : e.type === 'natives'
          ? `Downloading natives (${task}/${total})…`
          : e.type === 'classes' || e.type === 'classes-maven-custom'
            ? `Downloading libraries (${task}/${total})…`
            : `${e.type}: ${task}/${total}`;
    onEvent({
      type: 'progress',
      percent,
      message: label,
      raw: e,
    });
  });
  launcher.on('download-status', (e) => {
    const current = Number(e.current) || 0;
    const total = Number(e.total) || 0;
    if (total > 0 && total > 1024 * 1024) {
      const frac = Math.min(1, current / total);
      const percent = Math.round(82 + frac * 10);
      const now = Date.now();
      if (percent === lastProgressPercent && now - lastProgressTime < 80) return;
      lastProgressPercent = percent;
      lastProgressTime = now;
      onEvent({
        type: 'progress',
        percent,
        message: `Downloading ${e.name || 'Minecraft'}…`,
        raw: e,
      });
    }
  });

  onEvent({
    type: 'status',
    message: `Downloading Minecraft (${fabricId})…`,
    percent: 5,
  });

  const javaPath = resolveLaunchJavaPath(getJavaPath());
  if (!javaPath) {
    throw new Error('Java 25 is not available. Press Play again to install it.');
  }

  // MCLC always pipes Java stdout; spawn with stdio ignored for clean background execution.
  launcher.startMinecraft = function startMinecraft(launchArguments) {
    onEvent({
      type: 'status',
      percent: 100,
      message: 'Launching Game...',
    });
    return spawnDetachedMinecraft(javaPath, launchArguments, gameRoot);
  };

  // MCLC only adds -XstartOnFirstThread when parseInt(version.split('.')[1]) > 12.
  // MC 26.x has minor segment "2", so macOS launches without it and GLFW never opens a window.
  const customArgs =
    process.platform === 'darwin' ? ['-XstartOnFirstThread'] : undefined;

  const launchMemory = getMemoryState().memory;

  let child;
  try {
    child = await launcher.launch({
      authorization: auth,
      root: gameRoot,
      version: {
        number: versionNumber,
        type: 'release',
        custom: fabricId,
      },
      memory: {
        max: launchMemory.max,
        min: launchMemory.min,
      },
      javaPath,
      customArgs,
      overrides: {
        detached: true,
      },
    });
  } catch (err) {
    const msg = err?.message || String(err);
    onEvent({ type: 'error', message: `Launch failed: ${msg}` });
    throw new Error(`Launch failed: ${msg}`);
  }

  if (!child || !child.pid) {
    throw new Error('Minecraft did not start.');
  }

  onEvent({
    type: 'status',
    percent: 100,
    message: 'Launching Game...',
  });

  let gameLoadedSuccessfully = false;

  // Process monitoring and exit handling for launcher re-open and error messages
  let exitHandled = false;
  const handleGameExit = (code, signal) => {
    if (exitHandled) return;
    exitHandled = true;
    if (pollInterval) clearInterval(pollInterval);

    const durationMs = Date.now() - gameStartTime;
    const TEN_MINUTES_MS = 10 * 60 * 1000;
    const crashed = detectGameCrash(gameRoot, gameStartTime, code, signal);

    let outcome = 'quit';
    let message = '';
    if (!gameLoadedSuccessfully) {
      outcome = 'failed';
      message = 'Game failed to Load please try again!';
    } else if (crashed) {
      if (durationMs >= TEN_MINUTES_MS) {
        outcome = 'crashed-10m';
        message = 'Game Crashed! Report Bug to Owner';
      } else {
        outcome = 'failed';
        message = 'Game failed to Load please try again!';
      }
    } else {
      outcome = 'quit';
      message = '';
    }

    onGameExit({
      outcome,
      message,
      durationMs,
      exitCode: code,
      exitSignal: signal,
      gameLoadedSuccessfully,
    });
  };

  child.on('exit', (code, signal) => handleGameExit(code, signal));
  child.on('close', (code, signal) => handleGameExit(code, signal));
  child.on('error', () => handleGameExit(1, null));

  const pollInterval = setInterval(() => {
    if (!processAlive(child.pid)) {
      handleGameExit(null, null);
    }
  }, 1000);

  try {
    await waitUntilMinecraftOpened(child.pid, gameRoot, onEvent);
    gameLoadedSuccessfully = true;
  } catch (err) {
    handleGameExit(1, null);
    const msg = err?.message || String(err);
    onEvent({ type: 'error', message: `Launch failed: ${msg}` });
    throw new Error(`Launch failed: ${msg}`);
  }

  // Game is running — stop exit monitoring so the launcher can quit cleanly.
  if (pollInterval) clearInterval(pollInterval);
  exitHandled = true;
  try {
    child.removeAllListeners('exit');
    child.removeAllListeners('close');
    child.removeAllListeners('error');
    if (typeof child.unref === 'function') child.unref();
  } catch {
    /* ignore */
  }

  onEvent({
    type: 'started',
    percent: 100,
    message: 'Launching Game...',
  });

  return {
    ok: true,
    gameDir: gameRoot,
    modsDir: mods,
    configDir: configDir(),
    fabricId,
  };
}

module.exports = { launchGame, ensureFabric, installGameIconDesktop };
