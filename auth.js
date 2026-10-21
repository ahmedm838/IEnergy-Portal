/* IEnergy Portal sign-in.
   - One account, the same one as the Attendance Tracker, and one session
     for everything on this site. Signing in here signs you into the
     tracker and the Employee Database too: same origin, same stored
     token, so no page asks a second time.
   - What you may see comes from your role on your own employee record,
     which only a super admin can change, in the tracker's Settings page.
   - Fifteen minutes without activity ends the session, everywhere. One
     session, one rule, and signing out of any page signs you out of all
     of them because there is only one session to end.

   What this replaced: two usernames and two passwords written in this
   file, which anybody could read by opening it. Everything below still
   runs in the browser and can still be read -- the difference is that it
   no longer holds the secret. The database decides what each account can
   do, and refuses the rest whatever this page believes. */
(function () {
  'use strict';

  const SUPABASE_URL = 'https://ednaedkurjsgvjrvayys.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVkbmFlZGt1cmpzZ3ZqcnZheXlzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE5ODIzNzYsImV4cCI6MjEwNzU1ODM3Nn0.VvBg4YtwZsjmgmTxbf3vin3Oq_WyNTeioz6m-FRQLzA';

  // Applied here and in the tracker, so one session cannot outlive the
  // other half of itself.
  const IDLE_MS = 15 * 60 * 1000;

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
  /* Deciding instantly, then confirming.

     The old order showed the sign-in panel first and asked the server
     afterwards, so every page load flashed a login screen at somebody
     who was already signed in -- for as long as it took to fetch the
     Supabase client from a CDN and make two API calls.

     Two things fix it. The token is in localStorage, so whether a
     session exists can be answered synchronously, before any network.
     And the profile behind it barely changes, so it is cached for the
     tab: a second page can draw itself immediately and check afterwards.

     The cache is a rendering shortcut, never a permission. Row level
     security decides what the database returns, so a tampered cache
     buys a tile that does not work. */
  const SESSION_KEY = 'sb-ednaedkurjsgvjrvayys-auth-token';
  const PROFILE_KEY = 'ienergy_portal_profile_v1';

  /* Is there a stored token that has not expired? No network, no client,
     no await -- it has to answer before the first paint to be useful. */
  function storedSessionLooksValid() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      const expiresAt = Number(parsed && parsed.expires_at);
      // No expiry recorded: let the server be the judge rather than
      // throwing away a session that may well be good.
      if (!Number.isFinite(expiresAt)) return true;
      return expiresAt * 1000 > Date.now();
    } catch (_) {
      return false;
    }
  }

  function cachedProfile() {
    try { return JSON.parse(sessionStorage.getItem(PROFILE_KEY)); } catch (_) { return null; }
  }

  function rememberProfile(who) {
    try {
      if (who) sessionStorage.setItem(PROFILE_KEY, JSON.stringify(who));
      else sessionStorage.removeItem(PROFILE_KEY);
    } catch (_) { /* private mode; the page still works, just slower */ }
  }

  /* Where this file lives, read while it is being executed, which is
     the only moment document.currentScript is set. Everything this
     script loads for itself hangs off here rather than off the page's
     own URL, which differs on every subfolder. */
  const SCRIPT_BASE = (function () {
    const self = document.currentScript && document.currentScript.src;
    return self ? self.replace(/[^/]*$/, '') : './';
  })();

  let clientPromise = null;
  function getClient() {
    if (!clientPromise) {
      /* Bundled and served from this origin rather than fetched from
         jsdelivr. The CDN copy arrived as seven requests in two
         waterfall stages -- an entry module that then named six more --
         and none of it could start until this file had loaded, so it
         landed around 2.6s into the page and finished near 3.5s. One
         same-origin file is 27 KB gzipped against roughly 41 KB over
         those seven, and costs no second DNS lookup or TLS handshake.

         The version is in the filename, so a new one is a new URL and
         the old can be cached forever. Rebuild it with:
           esbuild entry.js --bundle --format=esm --minify \
             --target=es2020 --outfile=vendor/supabase-js-<version>.js
         where entry.js is: export { createClient } from '@supabase/supabase-js'
      */
      clientPromise = import(SCRIPT_BASE + 'vendor/supabase-js-2.45.4.js')
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

  /* Three answers, not two.

     "The server says nobody is signed in" and "I could not ask the
     server" are different facts, and collapsing both into null is how a
     dropped request turned into a forced sign-out for somebody who was
     signed in the whole time. getUser() is a live GET /auth/v1/user on
     every page load, so every flaky second on a phone tether, every 5xx,
     every token rotating underneath us used to end the session.

     UNKNOWN means: ask again, and until then believe what we already
     knew. */
  const UNKNOWN = Symbol('profile unknown');

  async function loadProfile() {
    let supabase;
    try { supabase = await getClient(); } catch (_) { return UNKNOWN; }

    let user = null;
    try {
      const res = await supabase.auth.getUser();
      user = (res && res.data && res.data.user) || null;
      /* An error, or no user, while the token is still sitting in
         storage. supabase-js clears that token itself the moment it
         decides a session is dead, so a token that is still there means
         it has not decided that -- the request failed, not the session. */
      if (!user) {
        if (storedSessionLooksValid()) return UNKNOWN;
        profile = null;
        return null;
      }
    } catch (_) {
      return UNKNOWN;
    }

    const { data, error } = await supabase
      .from('employees')
      .select('id, code, name, title, role')
      .eq('auth_user_id', user.id)
      .maybeSingle();

    // A failed query is not an answer about who she is; a successful one
    // that finds nobody is.
    if (error) return UNKNOWN;
    if (!data) { profile = null; return null; }

    profile = {
      id: data.id,
      code: data.code,
      name: data.name,
      title: data.title,
      email: user.email,
      trackerRole: data.role,
      role: PORTAL_ROLE[data.role] ?? null,
    };
    rememberProfile(profile);
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
      if (who === UNKNOWN) {
        // The password was right; we just could not read the record back.
        // Signing out here would blame the credentials for a bad network.
        return { ok: false, message: 'Signed in, but could not reach the server to check your access. Try again.' };
      }
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
    rememberProfile(null);
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

  /* Signing out in one tab signs out the others.

     There is one session, so ending it anywhere ends it everywhere --
     but a tab already open does not find out on its own. It carries on
     showing a page the viewer is no longer entitled to until they click
     something, which on a shared machine is exactly the gap that
     matters.

     The browser fires a storage event in every OTHER tab of this origin
     when the token is written or removed, so each one reloads and meets
     the gate. The tab that did the signing out is not told, which is
     fine: it is already on its way to the sign-in page. */
  window.addEventListener('storage', function (event) {
    if (!event.key || !/^sb-.*-auth-token$/.test(event.key)) return;
    if (event.newValue) return;   // signed IN elsewhere; nothing to undo
    profile = null;
    window.location.reload();
  });

  /* Every page gets a way out.

     Seven of these pages had no sign-out on them at all, so signing out
     was only possible from the home page and the two apps. Injecting it
     here rather than editing each page is the reasoning theme.js already
     uses for its toggle: one copy to keep in step, and the sign-in gate
     replaces the body on some of these pages anyway.

     A page that already has one -- the home page, which puts it in its
     page bar -- is left alone. */

  /* The temporary password.

     A super admin creating an account gives it one and sets the flag
     must_set_password on it. Until now only the tracker acted on that
     flag, and the tracker is no longer where anybody signs in: the
     sign-in moved to the portal, so somebody with a temporary password
     reached the main page, used it, and was asked to choose a real one
     at some unrelated later moment -- whenever they first happened to
     open the tracker.

     Asking here puts the question where the sign-in is, on every page
     that uses this gate, the moment there is a session. The panel is
     built in script rather than written into each page for the same
     reason the sign-out button is: one copy to keep in step. */
  async function needsPasswordChange() {
    try {
      const supabase = await getClient();
      const { data: { session } } = await supabase.auth.getSession();
      const meta = session && session.user && session.user.user_metadata;
      return !!(meta && meta.must_set_password === true);
    } catch (_) {
      /* Unreadable is not the same as "needs one". Erring the other way
         would put every page behind a panel nobody can dismiss. */
      return false;
    }
  }

  async function setPassword(newPassword) {
    const supabase = await getClient();
    /* Clearing the flag in the same call that sets the password means
       the two cannot disagree: no account is left able to sign in and
       still be sent back here. */
    const { error } = await supabase.auth.updateUser({
      password: newPassword,
      data: { must_set_password: false },
    });
    if (error) throw error;
  }

  /* The same eye the sign-in field has, built rather than copied. */
  function eyeButton(input) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pw-toggle";
    btn.tabIndex = -1;
    btn.setAttribute("aria-pressed", "false");
    btn.setAttribute("aria-label", "Show password");
    btn.title = "Show password";
    btn.innerHTML =
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z" />' +
      '<circle cx="12" cy="12" r="2.8" />' +
      '<path class="pw-slash" d="M4 20 20 4" /></svg>';
    btn.addEventListener("click", function () {
      const showing = input.type === "text";
      input.type = showing ? "password" : "text";
      const slash = btn.querySelector(".pw-slash");
      if (slash) slash.style.display = showing ? "" : "none";
      btn.setAttribute("aria-pressed", String(!showing));
      const label = showing ? "Show password" : "Hide password";
      btn.setAttribute("aria-label", label);
      btn.title = label;
    });
    return btn;
  }

  function passwordField(labelText, id) {
    const label = document.createElement("label");
    label.className = "field";
    const span = document.createElement("span");
    span.textContent = labelText;
    const wrap = document.createElement("span");
    wrap.className = "pw-wrap";
    const input = document.createElement("input");
    input.type = "password";
    input.id = id;
    input.autocomplete = "new-password";
    wrap.appendChild(input);
    wrap.appendChild(eyeButton(input));
    label.appendChild(span);
    label.appendChild(wrap);
    return { label: label, input: input };
  }

  let passwordGateShown = false;
  async function mountPasswordGate() {
    if (passwordGateShown) return false;
    if (!(await needsPasswordChange())) return false;
    passwordGateShown = true;

    const overlay = document.createElement("div");
    overlay.className = "pw-gate";
    overlay.id = "pwGate";

    const card = document.createElement("div");
    card.className = "pw-gate-card";

    const heading = document.createElement("h2");
    heading.textContent = "Choose your password";
    const lead = document.createElement("p");
    lead.textContent =
      "You signed in with a temporary password. Set one of your own to carry on, " +
      "at least 8 characters.";

    const first = passwordField("New password", "pwGateNew");
    const again = passwordField("Repeat password", "pwGateAgain");

    const err = document.createElement("div");
    err.className = "auth-error";
    err.hidden = true;

    const actions = document.createElement("div");
    actions.className = "auth-actions";
    const save = document.createElement("button");
    save.className = "btn primary";
    save.type = "button";
    save.textContent = "Save password";
    actions.appendChild(save);

    card.appendChild(heading);
    card.appendChild(lead);
    card.appendChild(first.label);
    card.appendChild(again.label);
    card.appendChild(err);
    card.appendChild(actions);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    setTimeout(function () { first.input.focus(); }, 50);

    const fail = function (text) { err.textContent = text; err.hidden = false; };

    let busy = false;
    async function submit() {
      if (busy) return;
      err.hidden = true;
      if (first.input.value.length < 8) { fail("Use at least 8 characters."); return; }
      if (first.input.value !== again.input.value) {
        fail("The two passwords do not match.");
        return;
      }
      busy = true;
      save.disabled = true;
      save.textContent = "Saving...";
      try {
        await setPassword(first.input.value);
        overlay.remove();
      } catch (e) {
        fail((e && e.message) || "Could not set the password. Try again.");
        busy = false;
        save.disabled = false;
        save.textContent = "Save password";
      }
    }
    save.addEventListener("click", submit);
    [first.input, again.input].forEach(function (input) {
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); submit(); }
      });
    });
    return true;
  }
  function mountSignOut(homeHref) {
    if (document.getElementById('logoutBtn')) return null;

    var bar = document.querySelector('.top-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'top-bar';
      document.body.appendChild(bar);
      // Loose on the page the toggle anchors itself; inside a bar it
      // should sit in the flow, like the button beside it.
      var toggle = document.querySelector('.theme-toggle');
      if (toggle) bar.appendChild(toggle);
    }

    var btn = document.createElement('button');
    btn.id = 'logoutBtn';
    btn.type = 'button';
    btn.className = 'btn logout-btn';
    btn.textContent = 'Sign out';
    btn.hidden = true;            // until we know somebody is signed in
    btn.addEventListener('click', function () {
      btn.disabled = true;
      btn.textContent = 'Signing out…';
      signOutAndLeave(homeHref);
    });
    bar.appendChild(btn);
    return btn;
  }


  /* Sign out, then leave -- in that order.
   *
   * logout() is asynchronous: it revokes the token with the server and,
   * whatever the server says, clears the stored one. Navigating without
   * waiting for it lets the page reload while the token is still in
   * storage, so the gate finds a session and signs the person straight
   * back in. That is precisely what the home page's own handler did.
   *
   * It lives here so there is one copy of the order of operations rather
   * than one per button.
   */
  async function signOutAndLeave(href) {
    await logout();
    window.location.replace(href || 'index.html');
  }

  function isSessionValid() { return !!(profile && profile.role); }
  function getRole() { return profile ? profile.role || '' : ''; }
  function getUser() { return profile ? profile.name || '' : ''; }
  function getProfile() { return profile; }

  /* Fifteen minutes of nothing ends it. The listeners are passive and on
     the window, so they cost nothing on a page nobody is touching.

     Activity is shared with the attendance tracker through the key the
     tracker already writes. There is one session across these pages, so
     there has to be one clock: otherwise a portal tab left open while
     somebody works in the tracker reaches fifteen minutes on its own,
     signs out, and takes the tracker with it. The tracker counts
     mousemove and wheel as activity, so this does too -- reading a
     dashboard is using it. */
  const ACTIVITY_KEY = 'attendance-last-activity';
  const SHARE_THROTTLE_MS = 5000;

  function lastActivity() {
    try {
      const value = Number(localStorage.getItem(ACTIVITY_KEY));
      return Number.isFinite(value) && value > 0 ? value : 0;
    } catch (_) { return 0; }
  }

  let idleTimer = null;
  function startIdleTimer(onIdle) {
    const events = ['mousedown', 'mousemove', 'keydown', 'touchstart', 'wheel', 'scroll', 'focus'];
    let mine = Date.now();
    let sharedAt = 0;

    const check = () => {
      // The newest action anywhere, not just in this tab.
      const newest = Math.max(mine, lastActivity());
      const left = IDLE_MS - (Date.now() - newest);
      if (left <= 0) { onIdle(); return; }
      idleTimer = setTimeout(check, left);
    };

    const reset = () => {
      const now = Date.now();
      mine = now;
      if (now - sharedAt > SHARE_THROTTLE_MS) {
        sharedAt = now;
        try { localStorage.setItem(ACTIVITY_KEY, String(now)); } catch (_) {}
      }
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(check, IDLE_MS);
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

      // A temporary password is asked about before anything else: it is
      // the one thing that has to happen before the session is used.
      mountPasswordGate();

      // There is somebody to sign out now, so offer it.
      const out = $('logoutBtn');
      if (out) { out.hidden = false; out.style.display = ''; }

      startIdleTimer(async () => {
        // The idle rule and the button do the same thing and land in the
        // same place: the sign-in page.
        await logout();
        window.location.replace(homeHref);
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

    // Pages that do not carry a sign-out get one, hidden until there is
    // a session to end.
    mountSignOut(homeHref);

    /* Decide now from what is already on this machine, then confirm.

       Showing the sign-in panel first and asking afterwards is what made
       every page flash a login screen at somebody already signed in. The
       panel now appears only when we know there is no session -- which
       localStorage can answer with no network at all. */
    const hasToken = storedSessionLooksValid();
    const known = hasToken ? cachedProfile() : null;

    if (!hasToken) {
      // Nothing stored: the panel is the right answer, immediately.
      showLogin();
    } else if (known && known.role && allowedRoles.includes(known.role)) {
      // Seen before in this tab. Draw the page straight away; the check
      // below still runs and will correct it if anything has changed.
      profile = known;
      showApp();
    } else {
      /* A token but nothing cached -- the first page of the session.
         Neither panel is right yet, so show neither: a blank moment is
         honest, where a login screen would be a lie about to be undone. */
      if (authEl) authEl.style.display = 'none';
      if (appEl) appEl.hidden = true;
    }

    /* Confirm, and be willing not to know.

       A confirmation that fails must not be able to sign anybody out.
       If the page is already drawn from a cached profile, an
       inconclusive answer leaves it drawn -- that is what the cache is
       for. Only an answer, or nothing to fall back on, closes the page. */
    function confirm(who, isRetry) {
      if (who === UNKNOWN) {
        if (profile && allowedRoles.includes(getRole())) return true;  // leave it up
        if (!isRetry) return loadProfile().then((again) => confirm(again, true));
        showLogin();
        return false;
      }
      /* If the optimistic draw was wrong about the role -- someone
         changed it, or the session belongs to a different person now --
         the page was built for the wrong one. Start it again rather
         than patch it. */
      if (known && who && who.role !== known.role) {
        window.location.reload();
        return false;
      }
      return settle();
    }

    return loadProfile()
      .then((who) => confirm(who, false))
      .catch(() => confirm(UNKNOWN, true));
  }

  window.IEnergyAuth = {
    ensureAuth,
    login,
    logout,
    signOutAndLeave,
    isSessionValid,
    getRole,
    getUser,
    getProfile,
    loadProfile,
    needsPasswordChange,
    setPassword,
    getClient,
    IDLE_MS,
    // Kept so older pages reading it do not trip over undefined. The
    // session now ends on inactivity rather than at a fixed time.
    AUTH_TTL_MS: IDLE_MS,
  };
})();
