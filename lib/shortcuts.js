const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { launcherAppDir } = require('./paths');

function firstExisting(paths) {
  return paths.find((p) => p && fs.existsSync(p)) || null;
}

function iconPath(installDir, resourcesRoot) {
  const appDir = launcherAppDir(installDir);
  if (process.platform === 'win32') {
    const ico = firstExisting([
      path.join(appDir, 'assets', 'icon.ico'),
      path.join(resourcesRoot, 'assets', 'icon.ico'),
    ]);
    if (ico) return ico;
  }
  return (
    firstExisting([
      path.join(appDir, 'assets', 'icon-transparent.png'),
      path.join(resourcesRoot, 'assets', 'icon-transparent.png'),
      path.join(resourcesRoot, 'assets', 'icon.png'),
    ]) || path.join(resourcesRoot, 'assets', 'icon.png')
  );
}

function launcherExec(installDir) {
  const appDir = launcherAppDir(installDir);
  if (process.platform === 'win32') {
    const exe = fs.existsSync(appDir)
      ? fs.readdirSync(appDir).find((n) => n.endsWith('.exe') && !n.toLowerCase().includes('setup'))
      : null;
    if (exe) return path.join(appDir, exe);
    return path.join(appDir, 'sieged-empires.bat');
  }
  const unpacked = path.join(appDir, 'sieged-empires');
  if (fs.existsSync(unpacked)) return unpacked;
  return path.join(appDir, 'sieged-empires');
}

function createDesktopShortcut(installDir, resourcesRoot) {
  const execPath = launcherExec(installDir);
  const icon = iconPath(installDir, resourcesRoot);

  if (process.platform === 'win32') {
    return createWindowsShortcut(installDir, execPath, icon);
  }
  return createLinuxDesktopEntry(installDir, execPath, icon);
}

function createLinuxDesktopEntry(installDir, execPath, iconPath) {
  const desktopDir = path.join(os.homedir(), '.local', 'share', 'applications');
  fs.mkdirSync(desktopDir, { recursive: true });
  const desktopFile = path.join(desktopDir, 'sieged-empires.desktop');
  const content = `[Desktop Entry]
Type=Application
Name=Sieged Empires
Comment=Sieged Empires Minecraft launcher
Exec=${execPath}
Icon=${iconPath}
Terminal=false
Categories=Game;
StartupWMClass=Sieged Empires
`;
  fs.writeFileSync(desktopFile, content, 'utf8');
  try {
    fs.chmodSync(desktopFile, 0o755);
  } catch {
    /* ignore */
  }
  return { ok: true, path: desktopFile };
}

function createWindowsShortcut(installDir, execPath, iconPath) {
  const startMenu = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs');
  const desktop = path.join(process.env.USERPROFILE || os.homedir(), 'Desktop');
  fs.mkdirSync(startMenu, { recursive: true });

  const lnkPath = path.join(startMenu, 'Sieged Empires.lnk');
  const ps = `
$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut('${lnkPath.replace(/'/g, "''")}')
$Shortcut.TargetPath = '${execPath.replace(/'/g, "''")}'
$Shortcut.WorkingDirectory = '${path.dirname(execPath).replace(/'/g, "''")}'
$Shortcut.IconLocation = '${iconPath.replace(/'/g, "''")},0'
$Shortcut.Description = 'Sieged Empires Minecraft launcher'
$Shortcut.Save()
`;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', ps], { encoding: 'utf8' });
  if (r.status !== 0) {
    return { ok: false, error: r.stderr || 'Failed to create shortcut' };
  }

  if (fs.existsSync(desktop)) {
    const desktopLnk = path.join(desktop, 'Sieged Empires.lnk');
    const ps2 = `
$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut('${desktopLnk.replace(/'/g, "''")}')
$Shortcut.TargetPath = '${execPath.replace(/'/g, "''")}'
$Shortcut.WorkingDirectory = '${path.dirname(execPath).replace(/'/g, "''")}'
$Shortcut.IconLocation = '${iconPath.replace(/'/g, "''")},0'
$Shortcut.Description = 'Sieged Empires Minecraft launcher'
$Shortcut.Save()
`;
    spawnSync('powershell.exe', ['-NoProfile', '-Command', ps2], { encoding: 'utf8' });
  }

  return { ok: true, path: lnkPath };
}

module.exports = { createDesktopShortcut, launcherExec, iconPath };
