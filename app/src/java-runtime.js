/**
 * Ensure Java 25 is available before launching Minecraft 26.2.
 * Linux (apt): pkexec apt-get install openjdk-25-jre
 * Fallback / other OS: download Temurin 25 JRE from Adoptium into install dir.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile, spawn } = require('child_process');
const { promisify } = require('util');
const https = require('https');
const http = require('http');
const { getInstallDir } = require('./paths');

const execFileAsync = promisify(execFile);
const REQUIRED_JAVA_MAJOR = 25;

const NOTE_CHECK = 'Checking Java 25…';
const NOTE_INSTALL_APT = 'Installing Java 25 (openjdk-25-jre)…';
const NOTE_DOWNLOAD = 'Downloading Java 25 from Adoptium…';

let resolvedJavaPath = null;

function javaMetaPath() {
  return path.join(getInstallDir(), 'java-runtime.json');
}

function loadSavedJavaPath() {
  try {
    const meta = JSON.parse(fs.readFileSync(javaMetaPath(), 'utf8'));
    const p = meta?.javaPath;
    if (p && fs.existsSync(p)) return p;
  } catch {
    /* ignore */
  }
  return null;
}

function saveJavaPath(javaPath, source) {
  fs.mkdirSync(getInstallDir(), { recursive: true });
  fs.writeFileSync(
    javaMetaPath(),
    JSON.stringify(
      {
        javaPath,
        source,
        major: REQUIRED_JAVA_MAJOR,
        updatedAt: new Date().toISOString(),
      },
      null,
      2
    ),
    'utf8'
  );
  resolvedJavaPath = javaPath;
}

function parseJavaMajor(stderr) {
  const text = String(stderr || '');
  const quoted = text.match(/version "([^"]+)"/);
  if (!quoted) return null;
  const parts = quoted[1].split(/[.+_-]/).map((p) => parseInt(p, 10));
  if (!parts.length || !Number.isFinite(parts[0])) return null;
  if (parts[0] === 1 && parts.length > 1) return parts[1];
  return parts[0];
}

function is64BitJava(stderr) {
  const text = String(stderr || '');
  if (/64-Bit|64-bit|x86_64|amd64|aarch64/i.test(text)) return true;
  if (/32-Bit|32-bit/i.test(text)) return false;
  return process.arch === 'x64' || process.arch === 'arm64';
}

async function probeJava(javaPath) {
  if (!javaPath || !fs.existsSync(javaPath)) return null;
  try {
    const { stderr } = await execFileAsync(javaPath, ['-version'], {
      timeout: 15000,
      windowsHide: true,
    });
    const major = parseJavaMajor(stderr);
    if (!major || major < REQUIRED_JAVA_MAJOR) return null;
    if (!is64BitJava(stderr)) return null;
    return { javaPath, major, stderr: String(stderr) };
  } catch {
    return null;
  }
}

function commonJavaCandidates() {
  const home = os.homedir();
  const installDir = getInstallDir();
  const list = [];

  if (process.platform === 'win32') {
    list.push(
      path.join(installDir, 'runtime', 'jre-25', 'bin', 'java.exe'),
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Eclipse Adoptium', 'jre-25.0.4.1-hotspot', 'bin', 'java.exe'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Eclipse Adoptium', 'jre-25.0.4.1-hotspot', 'bin', 'java.exe'),
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Java', 'jre-25', 'bin', 'java.exe')
    );
  } else if (process.platform === 'darwin') {
    list.push(
      path.join(installDir, 'runtime', 'jre-25', 'Contents', 'Home', 'bin', 'java'),
      path.join(installDir, 'runtime', 'jre-25', 'bin', 'java'),
      '/Library/Java/JavaVirtualMachines/temurin-25.jre/Contents/Home/bin/java',
      '/Library/Java/JavaVirtualMachines/temurin-25.jdk/Contents/Home/bin/java'
    );
    try {
      const { execFileSync } = require('child_process');
      const home = execFileSync('/usr/libexec/java_home', ['-v', '25'], {
        encoding: 'utf8',
        timeout: 5000,
      }).trim();
      if (home) list.unshift(path.join(home, 'bin', 'java'));
    } catch {
      /* no system Java 25 */
    }
  } else {
    list.push(
      path.join(installDir, 'runtime', 'jre-25', 'bin', 'java'),
      '/usr/lib/jvm/java-25-openjdk-amd64/bin/java',
      '/usr/lib/jvm/java-25-openjdk/bin/java',
      '/usr/lib/jvm/java-25-openjdk-arm64/bin/java',
      '/usr/bin/java'
    );
  }

  if (process.env.JAVA_HOME) {
    const bin =
      process.platform === 'win32'
        ? path.join(process.env.JAVA_HOME, 'bin', 'java.exe')
        : path.join(process.env.JAVA_HOME, 'bin', 'java');
    list.unshift(bin);
  }

  return [...new Set(list)];
}

async function findJavaOnPath() {
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  const arg = process.platform === 'win32' ? 'java' : 'java';
  try {
    const { stdout } = await execFileAsync(cmd, [arg], { timeout: 5000, windowsHide: true });
    const first = String(stdout)
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find(Boolean);
    if (first) return first;
  } catch {
    /* ignore */
  }
  return null;
}

async function findExistingJava25() {
  const saved = loadSavedJavaPath();
  if (saved) {
    const ok = await probeJava(saved);
    if (ok) return ok;
  }

  const pathJava = await findJavaOnPath();
  if (pathJava) {
    const ok = await probeJava(pathJava);
    if (ok) return ok;
  }

  for (const candidate of commonJavaCandidates()) {
    const ok = await probeJava(candidate);
    if (ok) return ok;
  }

  if (process.platform === 'linux') {
    try {
      const jvmRoot = '/usr/lib/jvm';
      if (fs.existsSync(jvmRoot)) {
        for (const name of fs.readdirSync(jvmRoot)) {
          if (!/java-25|openjdk-25|temurin-25/i.test(name)) continue;
          const bin = path.join(jvmRoot, name, 'bin', 'java');
          const ok = await probeJava(bin);
          if (ok) return ok;
        }
      }
    } catch {
      /* ignore */
    }
  }

  return null;
}

function hasCommand(name) {
  const dirs =
    process.platform === 'win32'
      ? (process.env.PATH || '').split(';')
      : (process.env.PATH || '').split(':');
  for (const dir of dirs) {
    const p =
      process.platform === 'win32'
        ? path.join(dir, `${name}.exe`)
        : path.join(dir, name);
    if (fs.existsSync(p)) return true;
  }
  return false;
}

function hasAptGet() {
  return fs.existsSync('/usr/bin/apt-get') || fs.existsSync('/bin/apt-get');
}

function runProcess(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      ...opts,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => {
      stdout += d;
    });
    child.stderr?.on('data', (d) => {
      stderr += d;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} exited ${code}: ${stderr || stdout}`.trim()));
    });
  });
}

async function installJavaViaApt(onProgress) {
  if (!hasAptGet()) return null;
  onProgress({ stage: 'java', percent: 2, message: NOTE_INSTALL_APT });

  const script =
    'set -e; export DEBIAN_FRONTEND=noninteractive; ' +
    'apt-get update -qq; apt-get install -y openjdk-25-jre';

  const runners = [];
  if (hasCommand('pkexec')) {
    runners.push(() => runProcess('pkexec', ['bash', '-c', script]));
  }
  if (hasCommand('sudo')) {
    runners.push(() => runProcess('sudo', ['bash', '-c', script]));
  }

  let lastErr = null;
  for (const run of runners) {
    try {
      await run();
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (lastErr) {
    throw new Error(
      `Could not install openjdk-25-jre (${lastErr.message}). Approve the password prompt or install Java 25 manually.`
    );
  }

  return findExistingJava25();
}

function adoptiumOs() {
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'darwin') return 'mac';
  return 'linux';
}

function adoptiumArch() {
  if (process.arch === 'arm64') return 'aarch64';
  return 'x64';
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib
      .get(url, { headers: { 'User-Agent': 'SiegedEmpiresLauncher/1.0' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          fetchJson(res.headers.location).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
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

function downloadFile(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib
      .get(url, { headers: { 'User-Agent': 'SiegedEmpiresLauncher/1.0' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          downloadFile(res.headers.location, destPath, onProgress).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        const total = Number(res.headers['content-length']) || 0;
        let received = 0;
        const file = fs.createWriteStream(destPath);
        res.on('data', (chunk) => {
          received += chunk.length;
          if (onProgress && total > 0) onProgress(received, total);
        });
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve(destPath)));
        file.on('error', (err) => {
          fs.unlink(destPath, () => reject(err));
        });
      })
      .on('error', reject);
  });
}

async function findJavaInTree(rootDir) {
  const binName = process.platform === 'win32' ? 'java.exe' : 'java';
  const stack = [rootDir];
  while (stack.length) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === 'bin') {
          const candidate = path.join(full, binName);
          const ok = await probeJava(candidate);
          if (ok) return ok;
        }
        stack.push(full);
      }
    }
  }
  return null;
}

async function extractArchive(archivePath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const lower = archivePath.toLowerCase();
  if (lower.endsWith('.zip')) {
    if (process.platform === 'win32') {
      await runProcess('powershell', [
        '-NoProfile',
        '-Command',
        `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`,
      ]);
    } else {
      await execFileAsync('tar', ['-xf', archivePath, '-C', destDir]);
    }
    return;
  }
  await execFileAsync('tar', ['-xzf', archivePath, '-C', destDir]);
}

async function installJavaViaAdoptium(onProgress) {
  onProgress({ stage: 'java', percent: 2, message: NOTE_DOWNLOAD });

  const apiUrl =
    `https://api.adoptium.net/v3/assets/latest/${REQUIRED_JAVA_MAJOR}/hotspot` +
    `?architecture=${adoptiumArch()}&image_type=jre&os=${adoptiumOs()}&vendor=eclipse`;

  const assets = await fetchJson(apiUrl);
  const asset = Array.isArray(assets) ? assets[0] : null;
  const link = asset?.binary?.package?.link;
  const name = asset?.binary?.package?.name;
  if (!link || !name) {
    throw new Error('Adoptium did not return a Java 25 JRE download.');
  }

  const runtimeRoot = path.join(getInstallDir(), 'runtime');
  const staging = path.join(runtimeRoot, 'downloads');
  fs.mkdirSync(staging, { recursive: true });
  const archivePath = path.join(staging, name);

  await downloadFile(link, archivePath, (received, total) => {
    const frac = total ? received / total : 0;
    onProgress({
      stage: 'java',
      percent: Math.round(2 + frac * 5),
      message: NOTE_DOWNLOAD,
    });
  });

  const extractDir = path.join(runtimeRoot, 'jre-25-extract');
  if (fs.existsSync(extractDir)) {
    fs.rmSync(extractDir, { recursive: true, force: true });
  }
  await extractArchive(archivePath, extractDir);

  const finalRoot = path.join(runtimeRoot, 'jre-25');
  if (fs.existsSync(finalRoot)) {
    fs.rmSync(finalRoot, { recursive: true, force: true });
  }

  const entries = fs.readdirSync(extractDir);
  if (entries.length === 1) {
    fs.renameSync(path.join(extractDir, entries[0]), finalRoot);
  } else {
    fs.mkdirSync(finalRoot, { recursive: true });
    for (const name of entries) {
      fs.renameSync(path.join(extractDir, name), path.join(finalRoot, name));
    }
  }
  fs.rmSync(extractDir, { recursive: true, force: true });

  try {
    fs.unlinkSync(archivePath);
  } catch {
    /* ignore */
  }

  // Gatekeeper quarantine on downloaded binaries blocks spawn from Electron on macOS.
  if (process.platform === 'darwin') {
    try {
      await execFileAsync('xattr', ['-cr', finalRoot]);
    } catch {
      /* optional — user may need to allow Java in Privacy & Security */
    }
  }

  const verified = await findJavaInTree(finalRoot);
  if (!verified) {
    throw new Error('Downloaded Java 25 JRE but could not find java binary.');
  }
  return verified;
}

async function ensureJava25(onProgress = () => {}) {
  if (resolvedJavaPath && fs.existsSync(resolvedJavaPath)) {
    const ok = await probeJava(resolvedJavaPath);
    if (ok) return resolvedJavaPath;
  }

  onProgress({ stage: 'java', percent: 0, message: NOTE_CHECK });
  const existing = await findExistingJava25();
  if (existing) {
    saveJavaPath(existing.javaPath, 'existing');
    onProgress({ stage: 'java', percent: 8, message: 'Java 25 ready.' });
    return existing.javaPath;
  }

  let installed = null;
  if (process.platform === 'linux' && hasAptGet()) {
    try {
      installed = await installJavaViaApt(onProgress);
    } catch (err) {
      onProgress({
        stage: 'java',
        percent: 1,
        message: `${err.message} Trying Adoptium download…`,
      });
    }
  }

  if (!installed) {
    installed = await installJavaViaAdoptium(onProgress);
  }

  saveJavaPath(installed.javaPath, process.platform === 'linux' && hasAptGet() ? 'apt-or-adoptium' : 'adoptium');
  onProgress({ stage: 'java', percent: 8, message: 'Java 25 ready.' });
  return installed.javaPath;
}

function getJavaPath() {
  return resolvedJavaPath || loadSavedJavaPath();
}

module.exports = {
  ensureJava25,
  getJavaPath,
  probeJava,
  findExistingJava25,
  REQUIRED_JAVA_MAJOR,
  NOTE_CHECK,
  NOTE_INSTALL_APT,
  NOTE_DOWNLOAD,
};
