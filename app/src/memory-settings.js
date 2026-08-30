const fs = require('fs');
const os = require('os');
const path = require('path');
const { getInstallDir } = require('./paths');

const SETTINGS_FILE = 'launcher-settings.json';
const MIN_GB = 2;
const OS_RESERVE_GB = 2;
const MAX_CAP_GB = 32;
const DEFAULT_TARGET_GB = 4;

function settingsPath() {
  return path.join(getInstallDir(), SETTINGS_FILE);
}

function getTotalSystemGb() {
  return os.totalmem() / (1024 ** 3);
}

function computeLimits() {
  const totalGb = getTotalSystemGb();
  const totalGbDisplay = Math.round(totalGb);
  const maxGb = Math.max(MIN_GB, Math.min(MAX_CAP_GB, Math.floor(totalGb - OS_RESERVE_GB)));
  return { minGb: MIN_GB, maxGb, totalGb: totalGbDisplay };
}

function readSettingsFile() {
  try {
    const p = settingsPath();
    if (!fs.existsSync(p)) return {};
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return {};
  }
}

function writeSettingsFile(patch) {
  const p = settingsPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const merged = { ...readSettingsFile(), ...patch };
  fs.writeFileSync(p, JSON.stringify(merged, null, 2), 'utf8');
}

function getDefaultRamGb(limits) {
  const preferred = Math.min(DEFAULT_TARGET_GB, limits.maxGb);
  return Math.max(limits.minGb, preferred);
}

function clampRamGb(gb, limits) {
  const n = Math.round(Number(gb));
  if (!Number.isFinite(n)) return getDefaultRamGb(limits);
  return Math.max(limits.minGb, Math.min(limits.maxGb, n));
}

function getRamGb() {
  const limits = computeLimits();
  const saved = readSettingsFile().ramGb;
  if (saved != null && saved !== '') {
    return clampRamGb(saved, limits);
  }
  return getDefaultRamGb(limits);
}

function setRamGb(gb) {
  const limits = computeLimits();
  const clamped = clampRamGb(gb, limits);
  writeSettingsFile({ ramGb: clamped });
  return clamped;
}

function memoryForLaunch(ramGb) {
  const maxMb = ramGb * 1024;
  const minMb = Math.max(1024, Math.floor(maxMb / 2));
  return { max: String(maxMb), min: String(minMb) };
}

function getMemoryState() {
  const limits = computeLimits();
  const ramGb = getRamGb();
  return {
    ramGb,
    minGb: limits.minGb,
    maxGb: limits.maxGb,
    totalSystemGb: limits.totalGb,
    memory: memoryForLaunch(ramGb),
  };
}

module.exports = {
  getMemoryState,
  setRamGb,
  memoryForLaunch,
  getRamGb,
};
