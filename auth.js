/* iEnergy simple session gate (10-minute unlock).

   Usage:
   1) Add on <body>:
        data-app-key="salary-calculator" data-app-password="iEnergysal"
   2) Include this script:
        <script defer src="../auth.js"></script> (or "./auth.js" from root)
   3) Page must include elements with these IDs:
        lockScreen, protectedContent, passwordInput, unlockBtn, lockMsg
*/

(() => {
  const AUTH_DURATION_MS = 10 * 60 * 1000;

  const appKey = document.body.getAttribute('data-app-key');
  const expectedPassword = document.body.getAttribute('data-app-password');
  if (!appKey || !expectedPassword) return;

  const storageKey = `ienergy_auth_${appKey}`;

  const lockEl = document.getElementById('lockScreen');
  const contentEl = document.getElementById('protectedContent');
  const inputEl = document.getElementById('passwordInput');
  const btnEl = document.getElementById('unlockBtn');
  const msgEl = document.getElementById('lockMsg');

  const now = () => Date.now();

  function setMsg(text) {
    if (!msgEl) return;
    msgEl.textContent = text || '';
    msgEl.style.display = text ? 'block' : 'none';
  }

  function isUnlocked() {
    const ts = Number(sessionStorage.getItem(storageKey) || 0);
    return ts && (now() - ts) < AUTH_DURATION_MS;
  }

  function showUnlocked() {
    if (lockEl) lockEl.style.display = 'none';
    if (contentEl) contentEl.style.display = '';
  }

  function showLocked() {
    if (lockEl) lockEl.style.display = '';
    if (contentEl) contentEl.style.display = 'none';
  }

  function tryUnlock() {
    setMsg('');
    const val = String(inputEl?.value ?? '');
    if (!val) {
      setMsg('Please enter the password.');
      inputEl?.focus();
      return;
    }
    if (val === expectedPassword) {
      sessionStorage.setItem(storageKey, String(now()));
      if (inputEl) inputEl.value = '';
      showUnlocked();
      return;
    }
    setMsg('Incorrect password.');
    inputEl?.focus();
    inputEl?.select();
  }

  // Initial state
  if (isUnlocked()) showUnlocked();
  else showLocked();

  // Events
  btnEl?.addEventListener('click', tryUnlock);
  inputEl?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      tryUnlock();
    }
  });
})();
