const accountList = document.getElementById('account-list');
const btnLogin = document.getElementById('btn-login');
const btnLoginBrowser = document.getElementById('btn-login-browser');
const btnLogout = document.getElementById('btn-logout');
const btnAddAccount = document.getElementById('btn-add-account');
const btnPlay = document.getElementById('btn-play');
const loginActions = document.getElementById('login-actions');
const tagline = document.getElementById('tagline');
const userLine = document.getElementById('user-line');
const statusEl = document.getElementById('status');
const progressWrap = document.getElementById('progress-wrap');
const progressPct = document.getElementById('progress-pct');
const progressBar = document.getElementById('progress-bar');
const progressNote = document.getElementById('progress-note');

const LOGIN_REQUIRED = 'You must sign into Microsoft to Download properly!';

function setStatus(msg) {
  statusEl.textContent = msg || '';
}

function setBusy(busy) {
  [btnLogin, btnLoginBrowser, btnLogout, btnPlay, btnAddAccount].forEach((b) => {
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
        setStatus(res.account?.playable ? `Using ${res.account.name}` : LOGIN_REQUIRED);
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
  const ready = accountReady(state.account, state.accounts);
  if (state.pack?.updateNeeded) {
    setStatus(
      ready
        ? 'Ready — press Play to install/update and launch.'
        : 'Sign in, then press Play.'
    );
  } else if (ready) {
    setStatus('Ready to play.');
  } else {
    setStatus('Sign in with Microsoft to play.');
  }
}

async function doLogin(mode) {
  setBusy(true);
  setStatus(mode === 'browser' ? 'Opening browser…' : 'Opening Microsoft sign-in…');
  try {
    const res =
      mode === 'browser' ? await window.sieged.loginBrowser() : await window.sieged.login();
    applyAccount(res.account, res.accounts);
    renderAccounts(res.accounts || []);
    setStatus('Signed in. Press Play.');
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
    setStatus('Signed out.');
  } catch (err) {
    setStatus(err?.message || String(err));
  } finally {
    setBusy(false);
  }
});

btnPlay.addEventListener('click', async () => {
  setBusy(true);
  hideProgress();
  setStatus('Preparing…');
  try {
    await window.sieged.play();
    setStatus('Minecraft launching…');
  } catch (err) {
    const msg = err?.message || String(err);
    setStatus(msg.includes('sign into Microsoft') ? LOGIN_REQUIRED : msg);
    hideProgress();
    // Show login again if Play failed for auth.
    if (msg.includes('sign into Microsoft')) {
      loginActions.classList.remove('hidden');
      btnAddAccount.classList.add('hidden');
    }
  } finally {
    setBusy(false);
  }
});

window.sieged.onGameEvent((ev) => {
  if (ev?.type === 'error') {
    setStatus(ev.message || LOGIN_REQUIRED);
    return;
  }
  if (ev?.type === 'progress') {
    setProgress(ev.percent ?? 0, ev.message);
    setStatus(ev.message || '');
    return;
  }
  if (ev?.type === 'status' || ev?.type === 'warn') {
    if (typeof ev.percent === 'number') setProgress(ev.percent, ev.message);
    else setStatus(ev.message);
  }
  if (ev?.type === 'close') {
    hideProgress();
    setStatus(`Game closed (code ${ev.code})`);
  }
});

refresh().catch((err) => setStatus(err?.message || String(err)));
