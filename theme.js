/* Light/dark theme for the portal.

   Loaded synchronously in <head> on every page so the saved choice is on
   the <html> element before anything paints. Deferring it would show a
   dark flash to someone who picked light, which is the one thing a theme
   switch must not do.

   The button is injected rather than written into each page's markup:
   ten pages would otherwise each need the same block kept in step, and
   the sign-in gate on some of them replaces the body content anyway.
*/
(function () {
  'use strict';

  var KEY = 'ienergy_portal_theme';
  var root = document.documentElement;

  function stored() {
    // Private mode and blocked site data both throw here rather than
    // returning null, and a theme is not worth an error page.
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }

  function remember(value) {
    try { localStorage.setItem(KEY, value); } catch (e) { /* not fatal */ }
  }

  function systemPrefersLight() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
  }

  /* What the person chose: light, dark, or follow the machine.
     Anything else stored -- nothing yet, or a value from an older
     version -- counts as system. */
  function choice() {
    var saved = stored();
    return saved === 'light' || saved === 'dark' ? saved : 'system';
  }

  /* What is actually on screen, which for 'system' is whatever the
     machine says right now. */
  function current() {
    return root.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  }

  function resolve(pick) {
    return pick === 'system' ? (systemPrefersLight() ? 'light' : 'dark') : pick;
  }

  function apply(theme) {
    if (resolve(theme) === 'light') root.setAttribute('data-theme', 'light');
    else root.removeAttribute('data-theme');
  }

  // Runs now, at parse time, before the body exists.
  apply(choice());

  /* On 'system', follow the machine while the page is open -- that is
     the whole point of the setting, and a page that only noticed at
     load would sit in yesterday's theme until reloaded. */
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: light)');
    var onSystemChange = function () {
      if (choice() !== 'system') return;
      apply('system');
      var btn = document.querySelector('.theme-toggle');
      if (btn) label(btn);
    };
    if (mq.addEventListener) mq.addEventListener('change', onSystemChange);
    else if (mq.addListener) mq.addListener(onSystemChange);
  }

  /* The same two icons the tracker draws, as inline SVG rather than a
     glyph: a moon rendered from a font lands at a different size and
     baseline on every machine, which is why this one looked nothing like
     the tracker's.

     The button names the theme it is CURRENTLY on, matching the tracker.
     The old one named what it would switch to, so the two apps labelled
     the same state with opposite words. */
  var SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  var MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
  var SYSTEM = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>';

  var ICON = { light: SUN, dark: MOON, system: SYSTEM };
  var LABEL = { light: 'Light', dark: 'Dark', system: 'System' };
  var NEXT = { light: 'dark', dark: 'system', system: 'light' };

  /* The button names the theme it is on, and its title says what a click
     will do. Same wording as the tracker, so the two never describe the
     same state differently. */
  function label(btn) {
    var pick = choice();
    btn.querySelector('.theme-toggle-icon').innerHTML = ICON[pick];
    btn.querySelector('.theme-toggle-label').textContent = LABEL[pick];
    var suffix = pick === 'system' ? ' (currently ' + current() + ')' : '';
    btn.setAttribute('title', 'Theme: ' + LABEL[pick] + suffix + ' — click for ' + LABEL[NEXT[pick]]);
    btn.setAttribute('aria-label', 'Theme: ' + LABEL[pick] + '. Switch to ' + LABEL[NEXT[pick]] + '.');
  }

  function mount() {
    if (document.querySelector('.theme-toggle')) return;

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'theme-toggle';
    btn.innerHTML = '<span class="theme-toggle-icon"></span><span class="theme-toggle-label"></span>';

    btn.addEventListener('click', function () {
      var next = NEXT[choice()];
      apply(next);
      // 'system' is stored as itself, so the choice survives a reload
      // rather than freezing at whatever the machine said at the time.
      remember(next);
      label(btn);
    });

    label(btn);

    // A page with a control bar says where this goes; anything else
    // keeps it at the top right of the document.
    var slot = document.getElementById('themeSlot');
    (slot || document.body).appendChild(btn);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }

  // Follow the operating system until someone makes a choice of their own.
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: light)');
    var onChange = function (e) {
      if (stored()) return;
      apply(e.matches ? 'light' : 'dark');
      var btn = document.querySelector('.theme-toggle');
      if (btn) label(btn);
    };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }
})();
