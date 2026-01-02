/* Salary Query
   - Password protected (session unlock up to 15 minutes): iEnergy2026
   - Reads an Excel file in the browser (default: ./employees salaries.xlsx)
   - Looks up an employee by EmployeeCode and displays key fields
*/
(function () {
  'use strict';

  // -----------------------------
  // Auth gate (popup style)
  // -----------------------------
  const PASSWORDS = ["iEnergy2026", "iEnergyS26"];
  const AUTH_KEY = 'ienergy_portal_session_expiry_v1';
  const AUTH_TTL_MS = 15 * 60 * 1000; // 15 minutes (max)


  const LEGACY_KEYS = ["salary_query_authed_v1", "ienergy_home_authed_v1", "employee_db_authed_v1"];

  function migrateLegacyAuth() {
    let best = 0;
    for (const k of LEGACY_KEYS) {
      const v = Number(sessionStorage.getItem(k) || '0');
      if (v > best) best = v;
    }
    const cur = Number(sessionStorage.getItem(AUTH_KEY) || '0');
    if (best > cur) sessionStorage.setItem(AUTH_KEY, String(best));
    for (const k of LEGACY_KEYS) sessionStorage.removeItem(k);
  }

  function $(id) { return document.getElementById(id); }

  function showAuthError(show) {
    const el = $('authError');
    if (!el) return;
    el.hidden = !show;
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

    // Initialize the app once unlocked
    initQueryApp();

    // Ensure we re-lock after TTL
    const expiry = Number(sessionStorage.getItem(AUTH_KEY) || '0');
    if (expiry) scheduleLock(expiry);
  }

  function handleLogin() {
    const input = $('passwordInput');
    const pwd = input ? input.value : '';
    if (PASSWORDS.includes(pwd)) {
      migrateLegacyAuth();
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
    migrateLegacyAuth();
    const expiry = Number(sessionStorage.getItem(AUTH_KEY) || '0');
    if (expiry && expiry > Date.now()) {
      unlockApp();
      return;
    }
    lockApp();
  }

  // -----------------------------
  // Query logic
  // -----------------------------
  const DEFAULT_XLSX_PATH = './employees salaries.xlsx';
  const FALLBACK_XLSX_PATHS = [
    DEFAULT_XLSX_PATH,
    '../data/employees.xlsx', // legacy
    './employees.xlsx' // legacy
  ];

  // DOM
  const elEmpCode = $('empCode');
  const elBtnSearch = $('btnSearch');
  const elStatus = $('status');
  const elResult = $('result');

  const elName = $('rName');
  const elPosition = $('rPosition');
  const elHireDate = $('rHireDate');
  const elBasicGross = $('rBasicGross');
  const elInsurable = $('rInsurable');

  // Data cache
  let workbookLoaded = false;
  let rows = null;

  function setStatus(msg, isError) {
    if (!elStatus) return;
    elStatus.textContent = msg || '';
    elStatus.classList.toggle('status-error', !!isError);
  }

  function showResult(show) {
    if (!elResult) return;
    elResult.classList.toggle('hidden', !show);
  }

  function fmtNumber(n) {
    const x = Number(n);
    if (!isFinite(x)) return String(n ?? '');
    return x.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }

  function fmtDate(v) {
    if (!v) return '';
    // Accept ISO strings, Date, or Excel date serial (best-effort).
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === 'string') return v;
    if (typeof v === 'number') {
      // Excel serial (1900 system) best-effort
      const epoch = new Date(Date.UTC(1899, 11, 30));
      const d = new Date(epoch.getTime() + v * 86400000);
      return d.toISOString().slice(0, 10);
    }
    return String(v);
  }

  async function loadXlsxIfNeeded() {
    if (workbookLoaded && Array.isArray(rows)) return;

    // XLSX library is expected (loaded via CDN in earlier versions).
    // If missing, we fail gracefully.
    if (!window.XLSX) {
      throw new Error('XLSX library not found.');
    }

    let buf = null;
    let loadedFrom = null;

    for (const p of FALLBACK_XLSX_PATHS) {
      try {
        const resp = await fetch(encodeURI(p), { cache: 'no-store' });
        if (!resp.ok) continue;
        buf = await resp.arrayBuffer();
        loadedFrom = p;
        break;
      } catch (e) {
        // try next path
      }
    }

    if (!buf) {
      throw new Error('Unable to load the employee salaries file. Make sure it exists at salary-query/employees salaries.xlsx (preferred) or data/employees.xlsx (legacy), and is published to GitHub Pages.');
    }

    // Optional: show where we loaded from (useful for troubleshooting)
    if (loadedFrom && window.console) console.log('Salary Query loaded Excel from:', loadedFrom);

    const wb = XLSX.read(buf, { type: 'array' });
    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const json = XLSX.utils.sheet_to_json(ws, { defval: '' });

    rows = json;
    workbookLoaded = true;
  }

  function normalizeKey(s) {
    return String(s || '').trim().toLowerCase();
  }

  function findByEmployeeCode(code) {
    const target = normalizeKey(code);
    if (!target) return null;

    // Try common column names
    const codeCols = ['employeecode', 'employee code', 'code', 'empcode', 'emp code'];
    const getCode = (r) => {
      for (const k of Object.keys(r || {})) {
        if (codeCols.includes(normalizeKey(k))) return r[k];
      }
      // fallback: exact key
      return r.EmployeeCode ?? r.employeeCode ?? r.Code ?? '';
    };

    for (const r of rows || []) {
      const v = getCode(r);
      if (normalizeKey(v) === target) return r;
    }
    return null;
  }

  function pickField(row, candidates) {
    for (const key of candidates) {
      for (const k of Object.keys(row || {})) {
        if (normalizeKey(k) === normalizeKey(key)) return row[k];
      }
    }
    return '';
  }

  function renderRow(r) {
    const name = pickField(r, ['Name', 'EmployeeName', 'FullName']);
    const position = pickField(r, ['Position', 'Title', 'JobTitle']);
    const hireDate = pickField(r, ['HiringDate', 'HireDate', 'JoinDate', 'Hiring Date']);
    const basicGross = pickField(r, ['BasicGrossSalary', 'Basic Gross Salary', 'BasicGross', 'Basic Gross']);
    const insurable = pickField(r, ['BasicSocialInsuranceSalary', 'InsurableSalaryBase', 'Insurable Salary Base', 'Basic SI Salary']);

    if (elName) elName.textContent = name || '—';
    if (elPosition) elPosition.textContent = position || '—';
    if (elHireDate) elHireDate.textContent = fmtDate(hireDate) || '—';
    if (elBasicGross) elBasicGross.textContent = basicGross !== '' ? fmtNumber(basicGross) : '—';
    if (elInsurable) elInsurable.textContent = insurable !== '' ? fmtNumber(insurable) : '—';

    showResult(true);
  }

  async function handleSearch() {
    showResult(false);
    const code = elEmpCode ? elEmpCode.value : '';
    if (!code || !String(code).trim()) {
      setStatus('Please enter an employee code.', true);
      return;
    }

    try {
      setStatus('Loading data...', false);
      await loadXlsxIfNeeded();

      const r = findByEmployeeCode(code);
      if (!r) {
        setStatus('No employee found for this code.', true);
        return;
      }
      setStatus('Found.', false);
      renderRow(r);
    } catch (e) {
      setStatus(e && e.message ? e.message : 'Unexpected error.', true);
    }
  }

  function initQueryApp() {
    if (!elBtnSearch || !elEmpCode) return;

    elBtnSearch.addEventListener('click', handleSearch);
    elEmpCode.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        handleSearch();
      }
    });

    // Lazy-load XLSX from CDN if not present
    if (!window.XLSX) {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
      s.onload = () => {};
      document.head.appendChild(s);
    }
  }

  // -----------------------------
  // Boot
  // -----------------------------
  document.addEventListener('DOMContentLoaded', () => {
    const btnLogin = $('btnLogin');
    const pwd = $('passwordInput');

    if (btnLogin) btnLogin.addEventListener('click', handleLogin);
    if (pwd) pwd.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        handleLogin();
      }
    });

    ensureAuth();
  });
})();
