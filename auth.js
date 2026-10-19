/* IEnergy Portal sign-in.
   - One account, the same one as the Attendance Tracker, and one session
     for everything on this site. Signing in here signs you into the
     tracker and the Employee Database too: same origin, same stored
     token, so no page asks a second time.
   - What you may see comes from your role on your own employee record,
     which only a super admin can change, in the tracker's Settings page.
   - Ten minutes without activity ends the session, which is the rule the
     tracker already applies. One session, one rule.

   What this replaced: two usernames and two passwords written in this
   file, which anybody could read by opening it. Everything below still
   runs in the browser and can still be read -- the difference is that it
   no longer holds the secret. The database decides what each account can
   do, and refuses the rest whatever this page believes. */
(function () {
  'use strict';

  const SUPABASE_URL = 'https://ednaedkurjsgvjrvayys.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVkbmFlZGt1cmpzZ3ZqcnZheXlzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE5ODIzNzYsImV4cCI6MjEwNzU1ODM3Nn0.VvBg4YtwZsjmgmTxbf3vin3Oq_WyNTeioz6m-FRQLzA';

  // The tracker's rule, applied here so one session cannot outlive the
  // other half of itself.
  const IDLE_MS = 10 * 60 * 1000;

  /* Four roles in the database, two answers here. A super admin and an
     admin see the same portal; the difference between them is what the
     tracker's Settings page lets them do. no_access means no portal. */
  const PORTAL_ROLE = {
    super_admin: 'admin',
    admin: 'admin',
    user: 'user',
    no_access: null,
  };

  const LEGACY_KEYS_TO_CLEAR = [
    'ienergy_portal_session_expiry_v2',
    'ienergy_portal_role_v2',
    'ienergy_portal_user_v2',
    'ienergy_portal_session_expiry_v1',
    'ienergy_home_authed_v1',
    'salary_query_authed_v1',
    'employee_db_authed_v1',
  ];

  function $(id) { return document.getElementById(id); }

  /* The old gate's leftovers. Harmless, but they are what "signed in"
     used to mean, and leaving them invites something to believe them. */
  function clearLegacy() {
    for (const k of LEGACY_KEYS_TO_CLEAR) {
      try { sessionStorage.removeItem(k); } catch (_) {}
      try { localStorage.removeItem(k); } catch (_) {}
    }
  }

  /* The client is fetched once, on first use. A page that never asks
     about the session never pays for it. */
  let clientPromise = null;
  function getClient() {
    if (!clientPromise) {
      clientPromise = import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm')
        .then(({ createClient }) =>
          createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
          }));
    }
    return clientPromise;
  }

  // Who is signed in, once we know. Null until then, and null is not the
  // same as "nobody" -- it also means "not asked yet".
  let profile = null;

  async function loadProfile() {
    const supabase = await getClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { profile = null; return null; }

    const { data, error } = await supabase
      .from('employees')
      .select('id, code, name, role')
      .eq('auth_user_id', user.id)
      .maybeSingle();

    if (error || !data) { profile = null; return null; }

    profile = {
      id: data.id,
      code: data.code,
      name: data.name,
      email: user.email,
      trackerRole: data.role,
      role: PORTAL_ROLE[data.role] ?? null,
    };
    return profile;
  }

  /* A username is the part before the @ on the company domain. Asking the
     database for that domain rather than assuming one means a wrong
     answer says so, instead of failing as "invalid credentials" and
     blaming the password. */
  async function resolveEmail(identifier) {
    const value = String(identifier ?? '').trim();
    if (!value || value.includes('@')) return value;
    const supabase = await getClient();
    const { data, error } = await supabase.rpc('default_email_domain');
    if (error || !data) throw new Error('Enter your full email address.');
    return `${value}@${data}`;
  }

  async function login(identifier, password) {
    clearLegacy();
    try {
      const supabase = await getClient();
      const email = await resolveEmail(identifier);
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password: String(password ?? ''),
      });
      if (error) {
        return {
          ok: false,
          message: error.message === 'Invalid login credentials'
            ? 'That username and password do not match an account.'
            : error.message,
        };
      }
      const who = await loadProfile();
      if (!who) {
        await logout();
        return {
          ok: false,
          message: 'That account signed in but is not linked to an employee record.',
        };
      }
      if (!who.role) {
        await logout();
        return {
          ok: false,
          message: 'Your account has no access. Ask a super admin to give you a role.',
        };
      }
      return { ok: true, role: who.role, user: who.name };
    } catch (err) {
      return { ok: false, message: err.message ?? String(err) };
    }
  }

  /* Ask the server to revoke, but never depend on it: what keeps somebody
     signed in is the stored token, so that goes whatever the server says. */
  async function logout() {
    profile = null;
    clearLegacy();
    try {
      const supabase = await getClient();
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    } catch (_) {
      try {
        const supabase = await getClient();
        await supabase.auth.signOut({ scope: 'local' });
      } catch (_) {}
    }
  }

  function isSessionValid() { return !!(profile && profile.role); }
  function getRole() { return profile ? profile.role || '' : ''; }
  function getUser() { return profile ? profile.name || '' : ''; }
  function getProfile() { return profile; }

  /* Ten minutes of nothing ends it. The listeners are passive and on the
     window, so they cost nothing on a page nobody is touching. */
  let idleTimer = null;
  function startIdleTimer(onIdle) {
    const events = ['mousedown', 'keydown', 'touchstart', 'scroll', 'focus'];
    const reset = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(onIdle, IDLE_MS);
    };
    for (const name of events) window.addEventListener(name, reset, { passive: true });
    reset();
  }

  /**
   * The page gate.
   *
   * Same shape as the one it replaces, so the pages calling it did not
   * have to change: it expects #auth and #app, and optionally
   * #accessDenied, #usernameInput, #passwordInput, #btnLogin, #authError.
   *
   * It is asynchronous now -- it has to ask the server who you are -- so
   * the login panel is what you see while it finds out, and onAuthed
   * fires once it knows. Callers already read the role inside onAuthed.
   */
  function ensureAuth(opts) {
    clearLegacy();

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
    const btnSwitchUser = $('btnSwitchUser');

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
      if (passInput) passInput.value = '';
      setTimeout(() => {
        if (userInput && !userInput.value) userInput.focus();
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
      try { window.location.href = homeHref; } catch (_) {}
    }

    function showApp() {
      if (authEl) authEl.style.display = 'none';
      if (deniedEl) deniedEl.hidden = true;
      if (appEl) appEl.hidden = false;

      startIdleTimer(async () => {
        await logout();
        window.location.reload();
      });

      if (onAuthed && !authedCallbackFired) {
        authedCallbackFired = true;
        try { onAuthed({ role: getRole(), user: getUser(), profile: getProfile() }); } catch (_) {}
      }
    }

    function settle() {
      if (!isSessionValid()) { showLogin(); return false; }
      if (!allowedRoles.includes(getRole())) { showDenied(); return false; }
      showApp();
      return true;
    }

    let busy = false;
    async function attemptLogin() {
      if (busy) return;
      busy = true;
      const label = btnLogin ? btnLogin.textContent : null;
      if (btnLogin) { btnLogin.disabled = true; btnLogin.textContent = 'Signing in…'; }
      showError('');
      try {
        const res = await login(
          userInput ? userInput.value : '',
          passInput ? passInput.value : '',
        );
        if (!res.ok) {
          showError(res.message || 'That username and password do not match an account.');
          if (passInput) passInput.value = '';
          if (userInput) userInput.focus();
          return;
        }
        if (passInput) passInput.value = '';
        settle();
      } finally {
        busy = false;
        if (btnLogin) { btnLogin.disabled = false; if (label) btnLogin.textContent = label; }
      }
    }

    if (btnLogin) btnLogin.addEventListener('click', attemptLogin);
    if (btnSwitchUser) {
      btnSwitchUser.addEventListener('click', async () => {
        await logout();
        showLogin();
      });
    }
    const onEnter = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); attemptLogin(); }
    };
    if (userInput) userInput.addEventListener('keydown', onEnter);
    if (passInput) passInput.addEventListener('keydown', onEnter);

    // Until the server answers, the login panel is what is on screen. It
    // is the honest thing to show: we do not yet know that anybody is
    // signed in.
    showLogin();
    return loadProfile().then(settle).catch(() => { showLogin(); return false; });
  }

  window.IEnergyAuth = {
    ensureAuth,
    login,
    logout,
    isSessionValid,
    getRole,
    getUser,
    getProfile,
    loadProfile,
    getClient,
    IDLE_MS,
    // Kept so older pages reading it do not trip over undefined. The
    // session now ends on inactivity rather than at a fixed time.
    AUTH_TTL_MS: IDLE_MS,
  };
})();
