/* IEnergy Portal Auth (client-side convenience only)
   - Session lifetime: until tab closes (sessionStorage) OR 15 minutes max (whichever comes first)
   - Users:
     1) admin / iEnergy2023  -> role: admin (full access)
     2) user / iEnergy  -> role: employee (limited access)
*/
(function () {
  'use strict';

  // v3: hardened storage + cross-page persistence
  // - Primary store: sessionStorage (clears when tab closes)
  // - Secondary store: localStorage (used to restore a session across page loads / tabs)
  //   NOTE: localStorage is best-effort and still governed by the same 15-minute expiry.

  const AUTH_EXP_KEY = 'ienergy_portal_session_expiry_v3';
  const AUTH_ROLE_KEY = 'ienergy_portal_role_v3';
  const AUTH_USER_KEY = 'ienergy_portal_user_v3';

  const AUTH_TTL_MS = 15 * 60 * 1000; // 15 minutes max

  // Hardcoded users (client-side gate only)
  const USERS = {
    admin: { password: 'iEnergy2023', role: 'admin' },
    user: { password: 'iEnergy', role: 'employee' }
  };

  const LEGACY_KEYS_TO_CLEAR = [
    // Older portal keys
    'ienergy_portal_session_expiry_v1',
    'ienergy_portal_role_v2',
    'ienergy_portal_user_v2',
    'ienergy_portal_session_expiry_v2',

    // Older per-page auth keys
    'ienergy_home_authed_v1',
    'salary_query_authed_v1',
    'employee_db_authed_v1'
  ];

  function now() { return Date.now(); }
  function $(id) { return document.getElementById(id); }

  function safeStorage(kind) {
    // Returns a storage-like object or null (if unavailable or blocked).
    try {
      const k = '__ienergy_test__';
      kind.setItem(k, '1');
      kind.removeItem(k);
      return kind;
    } catch (_) {
      return null;
    }
  }

  const S = safeStorage(window.sessionStorage);
  const L = safeStorage(window.localStorage);

  function sGet(key) {
    try { return S ? S.getItem(key) : null; } catch (_) { return null; }
  }
  function sSet(key, val) {
    try { if (S) S.setItem(key, val); } catch (_) {}
  }
  function sDel(key) {
    try { if (S) S.removeItem(key); } catch (_) {}
  }

  function lGet(key) {
    try { return L ? L.getItem(key) : null; } catch (_) { return null; }
  }
  function lSet(key, val) {
    try { if (L) L.setItem(key, val); } catch (_) {}
  }
  function lDel(key) {
    try { if (L) L.removeItem(key); } catch (_) {}
  }

  function readAuthFrom(storeGet) {
    const exp = Number(storeGet(AUTH_EXP_KEY) || '0');
    const role = String(storeGet(AUTH_ROLE_KEY) || '');
    const user = String(storeGet(AUTH_USER_KEY) || '');
    return { exp, role, user };
  }

  function writeAuth(exp, role, user) {
    // Persist to both stores when possible.
    sSet(AUTH_EXP_KEY, String(exp));
    sSet(AUTH_ROLE_KEY, String(role));
    sSet(AUTH_USER_KEY, String(user));

    lSet(AUTH_EXP_KEY, String(exp));
    lSet(AUTH_ROLE_KEY, String(role));
    lSet(AUTH_USER_KEY, String(user));
  }

  function clearAuth() {
    sDel(AUTH_EXP_KEY);
    sDel(AUTH_ROLE_KEY);
    sDel(AUTH_USER_KEY);

    lDel(AUTH_EXP_KEY);
    lDel(AUTH_ROLE_KEY);
    lDel(AUTH_USER_KEY);
  }

  function clearLegacy() {
    for (const k of LEGACY_KEYS_TO_CLEAR) {
      try { if (S) S.removeItem(k); } catch (_) {}
      try { if (L) L.removeItem(k); } catch (_) {}
    }
  }

  function getExpiry() {
    // Prefer session storage, fall back to local.
    const ses = readAuthFrom(sGet);
    if (ses.exp) return ses.exp;
    const loc = readAuthFrom(lGet);
    return loc.exp || 0;
  }

  function getRole() {
    const ses = readAuthFrom(sGet);
    if (ses.role) return ses.role;
    const loc = readAuthFrom(lGet);
    return loc.role || '';
  }

  function getUser() {
    const ses = readAuthFrom(sGet);
    if (ses.user) return ses.user;
    const loc = readAuthFrom(lGet);
    return loc.user || '';
  }

  function isSessionValid() {
    const ses = readAuthFrom(sGet);
    if (ses.exp && ses.exp > now() && ses.role) return true;

    // Restore from localStorage if valid.
    const loc = readAuthFrom(lGet);
    if (loc.exp && loc.exp > now() && loc.role) {
      // Rehydrate sessionStorage for this tab.
      writeAuth(loc.exp, loc.role, loc.user);
      return true;
    }
    return false;
  }

  function logout() {
    clearAuth();
  }

  function login(username, password) {
    clearLegacy();
    // Make username handling more forgiving (case-insensitive + trim).
    const u = String(username || '').trim().toLowerCase();
    const rec = USERS[u];
    if (!rec) return { ok: false };
    if (String(password || '') !== rec.password) return { ok: false };

    const exp = now() + AUTH_TTL_MS;
    writeAuth(exp, rec.role, u);
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
