/* IEnergy Portal Auth (client-side convenience only)
   - Session lifetime: until tab closes (sessionStorage) OR 15 minutes max (whichever comes first)
   - Users:
     1) admin / iEnergy2023  -> role: admin (full access)
     2) user  / iEnergy      -> role: user (limited access)
*/
(function () {
  'use strict';

  const AUTH_EXP_KEY = 'ienergy_portal_session_expiry_v2';
  const AUTH_ROLE_KEY = 'ienergy_portal_role_v2';
  const AUTH_USER_KEY = 'ienergy_portal_user_v2';

  // Used to distinguish tab-close from in-portal navigation.
  // Goal: when the user closes the tab, the session ends immediately.
  const NAV_FLAG_KEY = 'ienergy_portal_nav_in_progress_v2';

  const AUTH_TTL_MS = 15 * 60 * 1000; // 15 minutes max

  // Hardcoded users (client-side gate only)
  const USERS = {
    admin: { password: 'iEnergy2023', role: 'admin' },
    user: { password: 'iEnergy', role: 'user' }
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

  function markNavigation() {
    try { sessionStorage.setItem(NAV_FLAG_KEY, '1'); } catch (_) {}
  }

  function clearNavigationFlag() {
    try { sessionStorage.removeItem(NAV_FLAG_KEY); } catch (_) {}
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
    clearNavigationFlag();
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
    // New page load: this navigation is now complete.
    clearNavigationFlag();

    const allowedRoles = (opts && Array.isArray(opts.allowedRoles) && opts.allowedRoles.length)
      ? opts.allowedRoles
      : ['admin', 'user'];

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

  // ------------------------------------------------------------
  // Tab-close session end (best-effort)
  // ------------------------------------------------------------
  // sessionStorage normally clears on tab close, but browsers can restore it when
  // reopening a recently-closed tab. To ensure "tab close ends session immediately",
  // we explicitly logout on tab close while keeping in-portal navigation working.
  //
  // Mechanism:
  // - When the user clicks an in-portal link (or refreshes), we mark navigation.
  // - On beforeunload, if navigation was NOT marked, we treat it as tab close and logout.
  // - On next page load, ensureAuth clears the navigation flag.
  let lifecycleBound = false;
  function bindLifecycleGuards() {
    if (lifecycleBound) return;
    lifecycleBound = true;

    // Mark navigation for normal in-portal link clicks.
    document.addEventListener('click', (e) => {
      const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if (!a) return;
      if (a.target && String(a.target).toLowerCase() === '_blank') return;
      const href = a.getAttribute('href') || '';
      if (!href || href === '#' || href.startsWith('javascript:')) return;
      markNavigation();
    }, true);

    // Mark navigation for common refresh shortcuts.
    window.addEventListener('keydown', (e) => {
      const k = e.key;
      if (k === 'F5') markNavigation();
      if ((e.ctrlKey || e.metaKey) && (k === 'r' || k === 'R')) markNavigation();
    }, true);

    // If the page is being unloaded without a marked navigation, treat as tab close.
    window.addEventListener('beforeunload', () => {
      try {
        const nav = sessionStorage.getItem(NAV_FLAG_KEY);
        if (!nav) logout();
      } catch (_) {
        // If storage is unavailable, do nothing.
      }
    }, true);
  }

  bindLifecycleGuards();

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
