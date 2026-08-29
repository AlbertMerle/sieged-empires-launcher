const accountList = document.getElementById('account-list');
const btnLogin = document.getElementById('btn-login');
const btnLoginBrowser = document.getElementById('btn-login-browser');
const btnLogout = document.getElementById('btn-logout');
const btnAddAccount = document.getElementById('btn-add-account');
const btnDiscord = document.getElementById('btn-discord');
const btnWebsite = document.getElementById('btn-website');
const btnLauncherUpdateHere = document.getElementById('btn-launcher-update-here');
const btnPlay = document.getElementById('btn-play');
const loginActions = document.getElementById('login-actions');
const tagline = document.getElementById('tagline');
const userLine = document.getElementById('user-line');
const statusEl = document.getElementById('status');
const launcherUpdateBanner = document.getElementById('launcher-update-banner');
const progressWrap = document.getElementById('progress-wrap');
const progressPct = document.getElementById('progress-pct');
const progressBar = document.getElementById('progress-bar');
const progressNote = document.getElementById('progress-note');
const firstPlayHint = document.getElementById('first-play-hint');
const newsContent = document.getElementById('news-content');
const appVersionEl = document.getElementById('app-version');

const LOGIN_REQUIRED = 'You must sign into Microsoft to Download properly!';
const FIRST_PLAY_HINT_KEY = 'sieged-first-play-hint-shown';

let launcherOutdated = false;
let playLocked = false;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatNewsDate(dateStr) {
  const date = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function renderNewsItems(items) {
  if (!items?.length) {
    return '<p class="news-muted">No news updates!</p>';
  }
  const sorted = [...items].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  return sorted
    .map((item) => {
      const date = escapeHtml(item.date || '');
      const dateLabel = escapeHtml(formatNewsDate(item.date || ''));
      const title = item.title ? `<h3 class="news-title">${escapeHtml(item.title)}</h3>` : '';
      const body = escapeHtml(item.body || '');
      return `<article class="news-item">
        <time class="news-date" datetime="${date}">${dateLabel}</time>
        ${title}
        <p class="news-body">${body}</p>
      </article>`;
    })
    .join('');
}

function setIdleStatus() {
  statusEl.textContent = '';
  statusEl.classList.remove('status-error');
}

function setLauncherUpdateBanner(show) {
  if (!launcherUpdateBanner) return;
  if (show) launcherUpdateBanner.classList.remove('hidden');
  else launcherUpdateBanner.classList.add('hidden');
}

function playErrorMessage(err) {
  let msg = err?.message || String(err);
  msg = msg.replace(/^Error invoking remote method '[^']+':\s*/i, '').replace(/^Error:\s*/i, '');
  if (/EPERM|EACCES|EBUSY|copyfile/i.test(msg) && !/^Could not copy /i.test(msg)) {
    return (
      'Could not copy game files (permission denied). Close Minecraft if it is running, then press Play again. ' +
      'If this folder is on OneDrive, set it to "Always keep on this device".'
    );
  }
  return msg;
}

function setStatus(msg, isError = false) {
  if (msg) {
    statusEl.textContent = msg;
    if (isError) {
      statusEl.classList.add('status-error');
    } else {
      statusEl.classList.remove('status-error');
    }
    return;
  }
  setIdleStatus();
}

function setBusy(busy) {
  [
    btnLogin,
    btnLoginBrowser,
    btnLogout,
    btnPlay,
    btnAddAccount,
    btnDiscord,
    btnWebsite,
    btnLauncherUpdateHere,
  ].forEach((b) => {
    if (b) b.disabled = busy;
  });
}

function setProgress(percent, note) {
  const pct = Math.max(0, Math.min(100, Math.round(percent || 0)));
  progressWrap.classList.remove('hidden');
  progressPct.textContent = `${pct}%`;
  progressBar.style.width = `${pct}%`;
  if (note) progressNote.textContent = note;
}

function hideProgress() {
  progressWrap.classList.add('hidden');
}

function showFirstPlayHintIfNeeded() {
  if (!firstPlayHint) return;
  try {
    if (localStorage.getItem(FIRST_PLAY_HINT_KEY)) return;
    localStorage.setItem(FIRST_PLAY_HINT_KEY, '1');
  } catch {
    // If storage is blocked, still show the hint this session.
  }
  firstPlayHint.classList.remove('hidden');
}

function accountReady(account, accounts) {
  if (account?.playable) return true;
  return (accounts || []).some((a) => a.playable);
}

function updateLoginVisibility(ready) {
  if (ready) {
    loginActions.classList.add('hidden');
    btnAddAccount.classList.remove('hidden');
    tagline.textContent = 'Press Play to launch.';
  } else {
    loginActions.classList.remove('hidden');
    btnAddAccount.classList.add('hidden');
    tagline.textContent = 'Sign in, then press Play.';
  }
}

function renderAccounts(accounts) {
  accountList.innerHTML = '';
  if (!accounts?.length) {
    accountList.classList.add('empty');
    return;
  }
  accountList.classList.remove('empty');
  for (const acc of accounts) {
    const row = document.createElement('div');
    row.className = 'account-row' + (acc.active ? ' active' : '');

    const useBtn = document.createElement('button');
    useBtn.type = 'button';
    useBtn.className = 'btn account-btn';
    const mark = acc.playable ? '' : ' (sign-in needed)';
    useBtn.textContent = acc.active ? `${acc.name} ✓${mark}` : `${acc.name}${mark}`;
    useBtn.addEventListener('click', async () => {
      setBusy(true);
      try {
        const res = await window.sieged.selectAccount(acc.uuid);
        applyAccount(res.account, res.accounts);
        setStatus(res.account?.playable ? '' : LOGIN_REQUIRED);
        await refresh();
      } catch (err) {
        setStatus(err?.message || String(err));
      } finally {
        setBusy(false);
      }
    });

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn ghost account-remove';
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      setBusy(true);
      try {
        await window.sieged.removeAccount(acc.uuid);
        await refresh();
      } catch (err) {
        setStatus(err?.message || String(err));
      } finally {
        setBusy(false);
      }
    });

    row.appendChild(useBtn);
    row.appendChild(removeBtn);
    accountList.appendChild(row);
  }
}

function applyAccount(account, accounts) {
  const ready = accountReady(account, accounts);
  updateLoginVisibility(ready);
  if (account?.name) {
    userLine.textContent = ready
      ? `Logged in as ${account.name}`
      : `Account ${account.name} — sign in once to play`;
    userLine.classList.remove('hidden');
  } else {
    userLine.textContent = '';
    userLine.classList.add('hidden');
  }
}

async function refresh() {
  const state = await window.sieged.getState();
  if (state.error) {
    setStatus(state.error);
    return;
  }
  renderAccounts(state.accounts || []);
  applyAccount(state.account, state.accounts);
  if (state.pack?.installedPackVersion) {
    setPackVersionLabel(state.pack.installedPackVersion);
  }
  setIdleStatus();
}

async function doLogin(mode) {
  setBusy(true);
  setStatus(mode === 'browser' ? 'Opening browser…' : 'Opening Microsoft sign-in…');
  try {
    const res =
      mode === 'browser' ? await window.sieged.loginBrowser() : await window.sieged.login();
    applyAccount(res.account, res.accounts);
    renderAccounts(res.accounts || []);
    setIdleStatus();
  } catch (err) {
    setStatus(err?.message || String(err));
  } finally {
    setBusy(false);
  }
}

btnLogin.addEventListener('click', () => doLogin('html'));
btnLoginBrowser.addEventListener('click', () => doLogin('browser'));
btnAddAccount.addEventListener('click', () => {
  loginActions.classList.remove('hidden');
  btnAddAccount.classList.add('hidden');
});

btnLogout.addEventListener('click', async () => {
  setBusy(true);
  try {
    await window.sieged.logout();
    applyAccount(null, []);
    renderAccounts([]);
    setIdleStatus();
  } catch (err) {
    setStatus(err?.message || String(err));
  } finally {
    setBusy(false);
  }
});

btnPlay.addEventListener('click', async () => {
  showFirstPlayHintIfNeeded();
  setBusy(true);
  hideProgress();
  setStatus('Preparing…');
  try {
    await window.sieged.play();
    playLocked = true;
    setBusy(true);
    setProgress(100, 'Launching Game...');
    setStatus('Launching Game...');
  } catch (err) {
    if (playLocked) return;
    playLocked = false;
    setBusy(false);
    hideProgress();
    const msg = playErrorMessage(err);
    if (msg.includes('sign into Microsoft')) {
      setStatus(LOGIN_REQUIRED, true);
      loginActions.classList.remove('hidden');
      btnAddAccount.classList.add('hidden');
    } else {
      setStatus('Game failed to Load please try again!', true);
    }
  } finally {
    if (!playLocked) setBusy(false);
  }
});

btnDiscord.addEventListener('click', async () => {
  setBusy(true);
  try {
    const res = await window.sieged.joinDiscord();
    if (res?.ok) {
      setIdleStatus();
    } else {
      setStatus('Invite copied — paste it in Discord if the app did not open.');
    }
  } catch (err) {
    setStatus(err?.message || 'Could not open Discord.');
  } finally {
    setBusy(false);
  }
});

btnWebsite.addEventListener('click', async () => {
  setBusy(true);
  try {
    const res = await window.sieged.openWebsite();
    if (res?.ok) {
      setIdleStatus();
    } else {
      setStatus(res?.error || 'Could not open website.');
    }
  } catch (err) {
    setStatus(err?.message || 'Could not open website.');
  } finally {
    setBusy(false);
  }
});

btnLauncherUpdateHere?.addEventListener('click', async () => {
  try {
    const res = await window.sieged.openDownloadPage();
    if (!res?.ok) setStatus(res?.error || 'Could not open download page.', true);
  } catch (err) {
    setStatus(err?.message || 'Could not open download page.', true);
  }
});

window.sieged.onGameEvent((ev) => {
  if (ev?.type === 'pack-version' && ev.version) {
    setPackVersionLabel(ev.version);
    return;
  }
  if (ev?.type === 'game-exit') {
    playLocked = false;
    setBusy(false);
    hideProgress();
    if (ev.outcome === 'failed') {
      setStatus(ev.message || 'Game failed to Load please try again!', true);
    } else if (ev.outcome === 'crashed-10m') {
      setStatus(ev.message || 'Game Crashed! Report Bug to Owner', true);
    } else {
      // outcome === 'quit' (normal quit / closed window / exited tab)
      setIdleStatus();
      loadVersion();
    }
    return;
  }
  if (ev?.type === 'error') {
    playLocked = false;
    setBusy(false);
    hideProgress();
    const msg = ev.message || '';
    if (msg.includes('sign into Microsoft')) {
      setStatus(LOGIN_REQUIRED, true);
      loginActions.classList.remove('hidden');
      btnAddAccount.classList.add('hidden');
    } else {
      setStatus('Game failed to Load please try again!', true);
    }
    return;
  }
  if (ev?.type === 'progress') {
    setProgress(ev.percent ?? 0, ev.message);
    setStatus(ev.message || '');
    return;
  }
  if (ev?.type === 'started' || (ev?.type === 'status' && ev.message === 'Launching Game...')) {
    if (ev.type === 'started') playLocked = true;
    setBusy(true);
    setProgress(100, 'Launching Game...');
    setStatus('Launching Game...');
    return;
  }
  if (ev?.type === 'status' || ev?.type === 'warn') {
    if (typeof ev.percent === 'number') setProgress(ev.percent, ev.message);
    else setStatus(ev.message);
  }
});

async function loadNews() {
  if (!newsContent) return;
  newsContent.innerHTML = '<p class="news-muted">Loading newsletter…</p>';
  try {
    const res = await window.sieged.fetchNews();
    if (!res?.ok && !res?.items?.length) {
      newsContent.innerHTML = `<p class="news-muted">${escapeHtml(
        res?.error || 'Could not load newsletter. Check your internet connection.'
      )}</p>`;
      return;
    }
    newsContent.innerHTML = renderNewsItems(res.items || []);
  } catch (err) {
    newsContent.innerHTML = `<p class="news-muted">${escapeHtml(
      err?.message || 'Could not load newsletter.'
    )}</p>`;
  }
}

function formatPackVersion(version) {
  const v = String(version || '').trim().replace(/^v/i, '');
  return v ? `v${v}` : 'v1.0.1';
}

function setPackVersionLabel(version) {
  if (!appVersionEl) return;
  appVersionEl.textContent = formatPackVersion(version);
}

async function loadVersion() {
  if (!appVersionEl || !window.sieged.getPackVersion) return;
  try {
    const version = await window.sieged.getPackVersion();
    if (version) setPackVersionLabel(version);
  } catch {
    // keep hardcoded fallback in HTML
  }
}

async function checkForLauncherUpdate() {
  if (!window.sieged.fetchLauncherStream) return;
  try {
    const res = await window.sieged.fetchLauncherStream();
    launcherOutdated = Boolean(res?.needsLauncherUpdate);
  } catch {
    launcherOutdated = false;
  }
  setLauncherUpdateBanner(launcherOutdated);
  setIdleStatus();
}

loadVersion();
loadNews();
checkForLauncherUpdate()
  .then(() => refresh())
  .catch((err) => setStatus(err?.message || String(err)));

function initBackgroundVideo() {
  const video = document.getElementById('app-background-video');
  if (!video) return;

  video.playbackRate = 1;
  video.defaultPlaybackRate = 1;

  const play = () => {
    video.playbackRate = 1;
    video.play().catch(() => {});
  };

  video.addEventListener('loadeddata', play);
  video.addEventListener('ended', play);
  play();
}

initBackgroundVideo();
