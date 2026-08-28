const welcomePanel = document.getElementById('panel-welcome');
const pathPanel = document.getElementById('panel-path');
const progressPanel = document.getElementById('panel-progress');
const donePanel = document.getElementById('panel-done');
const welcomeText = document.getElementById('welcome-text');
const installPath = document.getElementById('install-path');
const progressPct = document.getElementById('progress-pct');
const progressBar = document.getElementById('progress-bar');
const progressNote = document.getElementById('progress-note');
const progressTrack = progressPanel.querySelector('.progress-track');
const statusEl = document.getElementById('status');

const btnYes = document.getElementById('btn-yes');
const btnNo = document.getElementById('btn-no');
const btnBrowse = document.getElementById('btn-browse');
const btnInstall = document.getElementById('btn-install');
const btnBack = document.getElementById('btn-back');
const btnLaunch = document.getElementById('btn-launch');
const btnFinish = document.getElementById('btn-finish');

const NOTE_MODS = 'Downloading Mods from Official Websites...';
const NOTE_CONFIG = 'Installing Config and Settings...';

let chosenInstallDir = '';

function show(panel) {
  [welcomePanel, pathPanel, progressPanel, donePanel].forEach((p) => p.classList.add('hidden'));
  panel.classList.remove('hidden');
}

function setStatus(msg) {
  statusEl.textContent = msg || '';
}

function setBusy(busy) {
  [btnYes, btnNo, btnInstall, btnBrowse, btnBack, btnLaunch, btnFinish].forEach((b) => {
    if (b) b.disabled = busy;
  });
}

function setProgressUi(percent, note) {
  const pct = Math.max(0, Math.min(100, Math.round(percent || 0)));
  progressPct.textContent = `${pct}%`;
  progressBar.style.width = `${pct}%`;
  if (progressTrack) progressTrack.setAttribute('aria-valuenow', String(pct));
  if (note) progressNote.textContent = note;
}

function noteForStage(stage) {
  if (
    stage === 'config' ||
    stage === 'clean' ||
    stage === 'app' ||
    stage === 'shortcut' ||
    stage === 'meta' ||
    stage === 'done'
  ) {
    return NOTE_CONFIG;
  }
  return NOTE_MODS;
}

window.setup.onProgress((p) => {
  if (!p) return;
  const note = noteForStage(p.stage);
  let pct = 0;
  if (typeof p.percent === 'number') {
    pct = p.percent;
  } else if (p.total) {
    pct = Math.round((p.current / p.total) * 100);
  }
  setProgressUi(pct, note);
});

async function init() {
  const state = await window.setup.getState();
  chosenInstallDir = state.defaultInstallDir;
  installPath.value = chosenInstallDir;

  if (state.installEmpty) {
    welcomeText.textContent = 'Ready for a fresh install.';
  } else if (state.updateNeeded) {
    welcomeText.textContent = 'An update is available for your installation.';
  } else {
    welcomeText.textContent = 'Your installation looks up to date. You can reinstall to repair files.';
  }

  if (state.updateReason === 'manifest_error') {
    setStatus(state.error || 'Could not read pack manifest.');
  }
}

async function runInstallFlow() {
  if (!chosenInstallDir) {
    setStatus('Please choose an install folder.');
    show(pathPanel);
    return;
  }
  setBusy(true);
  show(progressPanel);
  setProgressUi(0, NOTE_MODS);
  setStatus('');
  try {
    await window.setup.runInstall(chosenInstallDir);
    setProgressUi(100, NOTE_CONFIG);
    show(donePanel);
    setStatus('');
  } catch (err) {
    console.error(err);
    show(pathPanel);
    setStatus(err?.message || String(err));
  } finally {
    setBusy(false);
  }
}

btnYes.addEventListener('click', () => {
  // Use the default (or last-chosen) install folder and start sync immediately.
  runInstallFlow();
});

btnNo.addEventListener('click', () => window.setup.quit());

btnBack.addEventListener('click', () => {
  show(welcomePanel);
  setStatus('');
});

btnBrowse.addEventListener('click', async () => {
  const res = await window.setup.browsePath();
  if (res.ok && res.path) {
    chosenInstallDir = res.path;
    installPath.value = res.path;
  }
});

installPath.addEventListener('input', () => {
  chosenInstallDir = installPath.value.trim();
});

btnInstall.addEventListener('click', () => {
  runInstallFlow();
});

btnLaunch.addEventListener('click', async () => {
  setBusy(true);
  const res = await window.setup.launchApp(chosenInstallDir);
  if (!res.ok) {
    setStatus(res.error || 'Could not launch.');
    setBusy(false);
  } else {
    window.setup.quit();
  }
});

btnFinish.addEventListener('click', () => window.setup.quit());

init().catch((err) => setStatus(err?.message || String(err)));
