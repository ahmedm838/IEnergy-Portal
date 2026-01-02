/* IEnergy Portal Auth (client-side convenience only)
   - Session lifetime: until tab closes (sessionStorage) OR 15 minutes max (whichever comes first)
   - Users:
     1) admin / iEnergy2023  -> role: admin (full access)
     2) employee / iEnergy  -> role: employee (limited access)
*/
(function () {
  'use strict';

  const AUTH_EXP_KEY = 'ienergy_portal_session_expiry_v2';
  const AUTH_ROLE_KEY = 'ienergy_portal_role_v2';
  const AUTH_USER_KEY = 'ienergy_portal_user_v2';

  const AUTH_TTL_MS = 15 * 60 * 1000; // 15 minutes max

  // Hardcoded users (client-side gate only)
  const USERS = {
    admin: { password: 'iEnergy2023', role: 'admin' },
    employee: { password: 'iEnergy', role: 'employee' }
  };

  const LEGACY_KEYS_TO_CLEAR = [
    'ienergy_portal_session_expiry_v1',
    'ienergy_home_authed_v1',
    'salary_query_authed_v1',
    'employee_db_authed_v1'
  ];

  function now() { return Date.now(); }
  function $(id) { return document.getElementById(id); }

  function clearLegacy() {
    for (const k of LEGACY_KEYS_TO_CLEAR) {
      try { sessionStorage.removeItem(k); } catch (_) {}
    }
  }

  function getExpiry() {
    return Number(sessionStorage.getItem(AUTH_EXP_KEY) || '0');
  }

  function getRole() {
    return String(sessionStorage.getItem(AUTH_ROLE_KEY) || '');
  }

  function getUser() {
    return String(sessionStorage.getItem(AUTH_USER_KEY) || '');
  }

  function isSessionValid() {
    const exp = getExpiry();
    return !!(exp && exp > now() && getRole());
  }

  function logout() {
    sessionStorage.removeItem(AUTH_EXP_KEY);
    sessionStorage.removeItem(AUTH_ROLE_KEY);
    sessionStorage.removeItem(AUTH_USER_KEY);
  }

  function login(username, password) {
    clearLegacy();
    const u = String(username || '').trim();
    const rec = USERS[u];
    if (!rec) return { ok: false };
    if (String(password || '') !== rec.password) return { ok: false };

    const exp = now() + AUTH_TTL_MS;
    sessionStorage.setItem(AUTH_EXP_KEY, String(exp));
    sessionStorage.setItem(AUTH_ROLE_KEY, rec.role);
    sessionStorage.setItem(AUTH_USER_KEY, u);
    return { ok: true, expiry: exp, role: rec.role, user: u };
  }

  // Page-level gate.
  // Expects the page to have:
  //   - #auth (login overlay)
  //   - #app (main app container)
  // Optional:
  //   - #accessDenied (overlay)
  //   - #usernameInput, #passwordInput, #btnLogin, #authError
  function ensureAuth(opts) {
    clearLegacy();

    const allowedRoles = (opts && Array.isArray(opts.allowedRoles) && opts.allowedRoles.length)
      ? opts.allowedRoles
      : ['admin', 'employee'];

    const homeHref = (opts && typeof opts.homeHref === 'string' && opts.homeHref)
      ? opts.homeHref
      : '../index.html';

    const onAuthed = (opts && typeof opts.onAuthed === 'function') ? opts.onAuthed : null;

    const authEl = $('auth');
    const appEl = $('app');
    const deniedEl = $('accessDenied');

    const userInput = $('usernameInput');
    const passInput = $('passwordInput');
    const btnLogin = $('btnLogin');
    const errEl = $('authError');

    let lockTimer = null;
    let authedCallbackFired = false;

    function showError(msg) {
      if (!errEl) return;
      errEl.textContent = msg || '';
      errEl.hidden = !msg;
    }

    function showLogin() {
      if (appEl) appEl.hidden = true;
      if (deniedEl) deniedEl.hidden = true;
      if (authEl) authEl.style.display = 'grid';
      if (userInput) userInput.value = '';
      if (passInput) passInput.value = '';
      showError('');
      setTimeout(() => {
        if (userInput) userInput.focus();
        else if (passInput) passInput.focus();
      }, 50);
    }

    function showDenied() {
      if (authEl) authEl.style.display = 'none';
      if (appEl) appEl.hidden = true;

      if (deniedEl) {
        deniedEl.hidden = false;
        deniedEl.style.display = 'grid';
        return;
      }

      // Fallback: redirect to home.
      try { window.location.href = homeHref; } catch (_) {}
    }

    function scheduleLock(expiryMs) {
      if (lockTimer) clearTimeout(lockTimer);
      const remaining = expiryMs - now();
      if (remaining > 0) {
        lockTimer = setTimeout(() => {
          logout();
          showLogin();
        }, remaining);
      } else {
        logout();
        showLogin();
      }
    }

    function showApp() {
      if (authEl) authEl.style.display = 'none';
      if (deniedEl) deniedEl.hidden = true;
      if (appEl) appEl.hidden = false;

      const exp = getExpiry();
      if (exp) scheduleLock(exp);

      if (onAuthed && !authedCallbackFired) {
        authedCallbackFired = true;
        try { onAuthed({ role: getRole(), user: getUser(), expiry: exp }); } catch (_) {}
      }
    }

    function enforceRole() {
      const role = getRole();
      if (!allowedRoles.includes(role)) {
        showDenied();
        return false;
      }
      return true;
    }

    function attemptLogin() {
      const u = userInput ? userInput.value : '';
      const p = passInput ? passInput.value : '';
      const res = login(u, p);
      if (!res.ok) {
        showError('Incorrect username or password.');
        if (userInput) userInput.focus();
        return;
      }

      showError('');

      if (!enforceRole()) return;
      showApp();
    }

    // Bind UI events (idempotent-ish)
    if (btnLogin) btnLogin.addEventListener('click', attemptLogin);

    const onEnter = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        attemptLogin();
      }
    };

    if (userInput) userInput.addEventListener('keydown', onEnter);
    if (passInput) passInput.addEventListener('keydown', onEnter);

    // Initial check
    if (isSessionValid()) {
      if (!enforceRole()) return;
      showApp();
      return;
    }

    // No valid session
    logout();
    showLogin();
  }

  window.IEnergyAuth = {
    ensureAuth,
    login,
    logout,
    isSessionValid,
    getRole,
    getUser,
    AUTH_TTL_MS
  };
})();
