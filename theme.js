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

  function current() {
    return root.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  }

  function apply(theme) {
    if (theme === 'light') root.setAttribute('data-theme', 'light');
    else root.removeAttribute('data-theme');
  }

  // Runs now, at parse time, before the body exists.
  var saved = stored();
  apply(saved === 'light' || saved === 'dark' ? saved : (systemPrefersLight() ? 'light' : 'dark'));

  function label(btn) {
    var light = current() === 'light';
    // The button says what it will do, not what the page currently is.
    btn.querySelector('.theme-toggle-icon').textContent = light ? '☽' : '☀';
    btn.querySelector('.theme-toggle-label').textContent = light ? 'Dark' : 'Light';
    btn.setAttribute('aria-label', light ? 'Switch to dark theme' : 'Switch to light theme');
    btn.setAttribute('title', light ? 'Switch to dark theme' : 'Switch to light theme');
  }

  function mount() {
    if (document.querySelector('.theme-toggle')) return;

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'theme-toggle';
    btn.innerHTML = '<span class="theme-toggle-icon"></span><span class="theme-toggle-label"></span>';

    btn.addEventListener('click', function () {
      var next = current() === 'light' ? 'dark' : 'light';
      apply(next);
      remember(next);
      label(btn);
    });

    label(btn);

    document.body.appendChild(btn);
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
