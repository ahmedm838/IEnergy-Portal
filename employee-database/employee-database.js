(function () {
  'use strict';

  const PASSWORD = 'iEnergyS26';
  const AUTH_KEY = 'employee_db_authed_v1';
  const AUTH_TTL_MS = 10 * 60 * 1000;    // 10 minutes

  function $(id) { return document.getElementById(id); }

  function showAuthError(show) {
    const el = $('authError');
    if (el) el.hidden = !show;
  }

  let lockTimer = null;

  function lockApp() {
    sessionStorage.removeItem(AUTH_KEY);
    const auth = $('auth');
    const app = $('app');
    if (app) app.hidden = true;
    if (auth) auth.style.display = 'grid';
    const input = $('passwordInput');
    if (input) { input.value = ''; input.focus(); }
  }

  function scheduleLock(expiryMs) {
    if (lockTimer) clearTimeout(lockTimer);
    const remaining = expiryMs - Date.now();
    if (remaining > 0) lockTimer = setTimeout(lockApp, remaining);
    else lockApp();
  }

  function unlockApp() {
    const auth = $('auth');
    const app = $('app');
    if (auth) auth.style.display = 'none';
    if (app) app.hidden = false;

    const expiry = Number(sessionStorage.getItem(AUTH_KEY) || '0');
    if (expiry) scheduleLock(expiry);
  }

  function handleLogin() {
    const input = $('passwordInput');
    const pwd = input ? input.value : '';
    if (pwd === PASSWORD) {
      const expiry = Date.now() + AUTH_TTL_MS;
      sessionStorage.setItem(AUTH_KEY, String(expiry));
      showAuthError(false);
      unlockApp();
    } else {
      showAuthError(true);
      if (input) input.focus();
    }
  }

  function ensureAuth() {
    const expiry = Number(sessionStorage.getItem(AUTH_KEY) || '0');
    if (expiry && expiry > Date.now()) {
      unlockApp();
      return;
    }
    lockApp();
  }

  document.addEventListener('DOMContentLoaded', () => {
    const btn = $('btnLogin');
    const pwd = $('passwordInput');
    if (btn) btn.addEventListener('click', handleLogin);
    if (pwd) pwd.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        handleLogin();
      }
    });
    ensureAuth();
  });
})();