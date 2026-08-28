const loginPanel = document.getElementById('login-panel');
const playPanel = document.getElementById('play-panel');
const btnLogin = document.getElementById('btn-login');
const btnLogout = document.getElementById('btn-logout');
const btnPlay = document.getElementById('btn-play');
const userLine = document.getElementById('user-line');
const statusEl = document.getElementById('status');
const metaEl = document.getElementById('meta');

function setStatus(msg) {
  statusEl.textContent = msg || '';
}

function setBusy(busy) {
  btnLogin.disabled = busy;
  btnLogout.disabled = busy;
  btnPlay.disabled = busy;
}

function showLoggedIn(account) {
  loginPanel.classList.add('hidden');
  playPanel.classList.remove('hidden');
  userLine.textContent = account?.name ? `Logged in as ${account.name}` : 'Logged in';
}

function showLoggedOut() {
  playPanel.classList.add('hidden');
  loginPanel.classList.remove('hidden');
  userLine.textContent = '';
}

async function refresh() {
  const state = await window.sieged.getState();
  if (state.account) showLoggedIn(state.account);
  else showLoggedOut();

  const parts = [
    `MC ${state.minecraftVersion || '?'}`,
    `via ${state.pageDownload || '?'}`,
    state.packLabel || 'pack: not set',
  ];
  metaEl.textContent = parts.join(' · ');
}

btnLogin.addEventListener('click', async () => {
  setBusy(true);
  setStatus('Opening Microsoft login…');
  try {
    const res = await window.sieged.login();
    showLoggedIn(res.account);
    setStatus('Signed in.');
  } catch (err) {
    console.error(err);
    setStatus(err?.message || String(err));
  } finally {
    setBusy(false);
  }
});

btnLogout.addEventListener('click', async () => {
  setBusy(true);
  try {
    await window.sieged.logout();
    showLoggedOut();
    setStatus('Signed out.');
  } catch (err) {
    setStatus(err?.message || String(err));
  } finally {
    setBusy(false);
  }
});

btnPlay.addEventListener('click', async () => {
  setBusy(true);
  setStatus('Checking for updates…');
  try {
    await window.sieged.play();
    setStatus('Game launching…');
  } catch (err) {
    console.error(err);
    setStatus(err?.message || String(err));
  } finally {
    setBusy(false);
  }
});

window.sieged.onPackProgress((p) => {
  if (p?.message) setStatus(p.message);
});

window.sieged.onGameEvent((ev) => {
  if (ev?.type === 'status' || ev?.type === 'warn') setStatus(ev.message);
  if (ev?.type === 'progress' && ev.message) setStatus(ev.message);
  if (ev?.type === 'close') setStatus(`Game closed (code ${ev.code})`);
});

refresh().catch((err) => setStatus(err?.message || String(err)));
