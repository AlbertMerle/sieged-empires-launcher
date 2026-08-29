/**
 * Live launcher config from GitHub Gist "launcherStream1".
 * https://gist.github.com/AlbertMerle/ded1819babff02627ba66261ed08e9d4
 */
const LAUNCHER_STREAM_GIST_ID = 'ded1819babff02627ba66261ed08e9d4';
const LAUNCHER_STREAM_FILENAME = 'launcherStream1';
const LAUNCHER_STREAM_RAW_URL = `https://gist.githubusercontent.com/AlbertMerle/${LAUNCHER_STREAM_GIST_ID}/raw/${LAUNCHER_STREAM_FILENAME}`;

function parseLauncherStream(text) {
  const config = {};
  for (const line of String(text || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key) config[key] = value;
  }
  return config;
}

function parseTruthy(value) {
  const s = String(value ?? '')
    .trim()
    .toLowerCase();
  return s === 'true' || s === '1' || s === 'yes' || s === 'on';
}

async function fetchLauncherStream() {
  try {
    const res = await fetch(LAUNCHER_STREAM_RAW_URL, {
      headers: { 'User-Agent': 'SiegedEmpires-Launcher/1.0' },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const config = parseLauncherStream(text);
    return {
      ok: true,
      config,
      needsLauncherUpdate: parseTruthy(config['needs-launcher-update']),
      sourceUrl: LAUNCHER_STREAM_RAW_URL,
    };
  } catch (err) {
    return {
      ok: false,
      config: {},
      needsLauncherUpdate: false,
      sourceUrl: LAUNCHER_STREAM_RAW_URL,
      error: err?.message || String(err),
    };
  }
}

module.exports = {
  LAUNCHER_STREAM_RAW_URL,
  parseLauncherStream,
  parseTruthy,
  fetchLauncherStream,
};
