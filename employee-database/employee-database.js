/* Employee Database
   - Password protected (10 min unlock): iEnergyS26
   - Reads an Excel file in the browser (default: ./employees-database.xls)
   - Search by Employee Code (exact) or Employee Name (contains)
   - Displays all columns for the selected employee row
*/
(function () {
  'use strict';

  // -----------------------------
  // Auth gate (popup style)
  // -----------------------------
  const PASSWORD = 'iEnergyS26';
  const AUTH_KEY = 'employee_db_authed_v1';
  const AUTH_TTL_MS = 10 * 60 * 1000; // 10 minutes

  function $(id) { return document.getElementById(id); }

  function showAuthError(show) {
    const el = $('authError');
    if (el) el.hidden = !show;
  }

  let lockTimer = null;
  let appInited = false;

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

    if (!appInited) {
      appInited = true;
      initApp();
    }
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

  // -----------------------------
  // Excel loading + search
  // -----------------------------
  const DEFAULT_XLSX_PATH = './employees-database.xlsx';
  const FALLBACK_XLSX_PATHS = [
    DEFAULT_XLSX_PATH,
    './employees-database.xlsx',
    './IEnergy Employees Database.xlsx',
    './IEnergy Employees Database.xls',
    '../data/employees.xlsx',
    './employees.xlsx'
  ];

  let rows = [];
  let index = [];
  let headerOrder = []; // { row, code, name, normCode, normName }
  let loadedFrom = null;

  let mode = 'code'; // 'code' | 'name'

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // NOTE: We intentionally do not use browser-native autocomplete (datalist) for names.
  // The UI uses the custom "Matches" list instead.

  function setHint(msg, isError) {
    const el = $('hint');
    if (!el) return;
    el.textContent = msg || '';
    el.classList.toggle('error', !!isError);
  }

  function setStatus(msg) {
    const el = $('xlsxStatus');
    if (el) el.textContent = msg;
  }

  function normStr(v) {
    if (v === null || v === undefined) return '';
    return String(v).replace(/\s+/g, ' ').trim();
  }

  function normKey(v) {
    return normStr(v).toLowerCase();
  }

  function pickField(row, candidates) {
    // Try exact keys first
    for (const c of candidates) {
      if (Object.prototype.hasOwnProperty.call(row, c) && normStr(row[c])) return row[c];
    }
    // Try fuzzy keys
    const keys = Object.keys(row || {});
    for (const c of candidates) {
      const cNorm = normKey(c);
      const k = keys.find(k0 => normKey(k0) === cNorm);
      if (k && normStr(row[k])) return row[k];
    }
    // Try contains
    for (const c of candidates) {
      const cNorm = normKey(c);
      const k = keys.find(k0 => normKey(k0).includes(cNorm));
      if (k && normStr(row[k])) return row[k];
    }
    return '';
  }

  function pickFieldKey(row, candidates) {
    // Same matching strategy as pickField(), but returns the matched column name (key).
    if (!row) return '';

    // Try exact keys first
    for (const c of candidates) {
      if (Object.prototype.hasOwnProperty.call(row, c) && normStr(row[c])) return c;
    }

    // Try fuzzy keys
    const keys = Object.keys(row || {});
    for (const c of candidates) {
      const cNorm = normKey(c);
      const k = keys.find(k0 => normKey(k0) === cNorm);
      if (k && normStr(row[k])) return k;
    }

    // Try contains
    for (const c of candidates) {
      const cNorm = normKey(c);
      const k = keys.find(k0 => normKey(k0).includes(cNorm));
      if (k && normStr(row[k])) return k;
    }

    return '';
  }

  function excelDateToJsDate(serial) {
    // Excel 1900 system (best-effort)
    const s = Number(serial);
    if (!Number.isFinite(s)) return null;
    // 25569 = days between 1899-12-30 and 1970-01-01
    const utc = (s - 25569) * 86400 * 1000;
    const d = new Date(utc);
    if (Number.isNaN(d.getTime())) return null;
    return d;
  }

  function looksLikeDateKey(key) {
    const k = normKey(key);
    return /date|dob|birth|hiring|joining|start|end|issue|expiry|expiration/i.test(k);
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  function formatDateDDMMYYYY(d) {
    if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '—';
    const dd = pad2(d.getDate());
    const mm = pad2(d.getMonth() + 1);
    const yy = d.getFullYear();
    return dd + '/' + mm + '/' + yy;
  }

  function isNoCommaField(key) {
    const k = normKey(key).replace(/[^a-z0-9]/g, '');
    // Exact field names requested (allow for punctuation/spaces): ID No., Mobile No., Sec. Mobile No., SI No.
    return (
      k === 'idno' ||
      k === 'mobileno' ||
      k === 'secmobileno' ||
      k === 'sino'
    );
  }

  function isMobileField(key) {
    const k = normKey(key).replace(/[^a-z0-9]/g, '');
    return (k === 'mobileno' || k === 'secmobileno');
  }

  function formatMobileNumber(val) {
    if (val === null || val === undefined) return '—';

    let s = '';
    if (typeof val === 'number' && Number.isFinite(val)) {
      s = String(Math.round(val));
    } else {
      s = normStr(val);
    }

    // Remove any formatting and keep digits only.
    s = s.replace(/,/g, '').replace(/\s+/g, '').replace(/[^0-9]/g, '');
    if (!s) return '—';

    // Add leading zero if missing.
    if (s[0] !== '0') s = '0' + s;
    return s;
  }

  function tryParseDateString(s) {
    const t = normStr(s);
    if (!t) return null;

    // ISO-like: YYYY-MM-DD or YYYY/MM/DD
    let m = t.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})(?:\s|T|$)/);
    if (m) {
      const y = Number(m[1]), mo = Number(m[2]), da = Number(m[3]);
      const d = new Date(y, mo - 1, da);
      if (!Number.isNaN(d.getTime())) return d;
    }

    // D/M/YYYY or DD/MM/YYYY (treat as day-first)
    m = t.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})(?:\s|$)/);
    if (m) {
      const da = Number(m[1]), mo = Number(m[2]), y = Number(m[3]);
      const d = new Date(y, mo - 1, da);
      if (!Number.isNaN(d.getTime())) return d;
    }

    return null;
  }

  function formatValue(key, val) {
    if (val === null || val === undefined) return '—';
    if (val === '') return '—';

    // Mobile fields must always be shown as digits without separators, and with a leading 0.
    if (isMobileField(key)) {
      return formatMobileNumber(val);
    }

    if (val instanceof Date && !Number.isNaN(val.getTime())) {
      return formatDateDDMMYYYY(val);
    }

    if (typeof val === 'number' && Number.isFinite(val)) {
      // Heuristic: treat as date serial if key indicates a date and value is in plausible range
      if (looksLikeDateKey(key) && val > 20000 && val < 70000) {
        const d = excelDateToJsDate(val);
        if (d) return formatDateDDMMYYYY(d);
      }
      const isInt = Math.abs(val - Math.round(val)) < 1e-9;
      if (isNoCommaField(key)) return String(Math.round(val));
      if (isInt) return Math.round(val).toLocaleString();
      return val.toLocaleString(undefined, { maximumFractionDigits: 4 });
    }

    const s = normStr(val);
    if (looksLikeDateKey(key)) {
      const d = tryParseDateString(s);
      if (d) return formatDateDDMMYYYY(d);
    }
    if (isNoCommaField(key)) {
      return s.replace(/,/g, '') || '—';
    }
    return s || '—';
  }

  function makeKeySort(keys) {
    // Keep code/name/position/department close to the top, then alphabetical.
    const pri = [
      'employeecode', 'employee code', 'code', 'emp code',
      'name', 'employee name', 'employee', 'fullname', 'full name',
      'position', 'job title', 'title',
      'department', 'dept', 'section'
    ].map(normKey);

    function score(k) {
      const kn = normKey(k);
      const hit = pri.findIndex(p => kn === p || kn.includes(p));
      return hit === -1 ? 999 : hit;
    }

    return keys.sort((a, b) => {
      const sa = score(a), sb = score(b);
      if (sa !== sb) return sa - sb;
      return normKey(a).localeCompare(normKey(b));
    });
  }

  function buildIndex(data) {
    rows = Array.isArray(data) ? data : [];
    index = [];

    for (const r of rows) {
      const code = pickField(r, ['EmployeeCode', 'EmpCode', 'Employee Code', 'Code', 'ID', 'Employee ID', 'Emp ID']);
      const name = pickField(r, ['EmployeeName', 'Name', 'Full Name', 'FullName', 'Employee', 'Employee Name']);
      const normCode = normKey(code).replace(/\s+/g, '');
      const normName = normKey(name);

      if (!normCode && !normName) continue;

      index.push({ row: r, code: normStr(code), name: normStr(name), normCode, normName });
    }

    // Refresh name suggestions for the autocomplete list.
    updateNameSuggestions();
  }

  async function loadXlsx() {
    // Ensure XLSX is present (loader is in HTML)
    if (window.__ensureXLSX) {
      const ok = await window.__ensureXLSX();
      if (!ok || !window.XLSX) throw new Error('Unable to load XLSX library.');
    }
    if (!window.XLSX) throw new Error('XLSX library not found.');

    setStatus('Excel: loading…');

    let lastErr = null;
    loadedFrom = null;

    for (const p of FALLBACK_XLSX_PATHS) {
      try {
        const resp = await fetch(encodeURI(p), { cache: 'no-store' });
        if (!resp.ok) throw new Error('HTTP ' + resp.status + ' for ' + p);
        const buf = await resp.arrayBuffer();
        // SheetJS can detect formats from buffer
        const wb = XLSX.read(buf, { type: 'array', cellDates: true });
        const sheetName = wb.SheetNames && wb.SheetNames[0];
        if (!sheetName) throw new Error('No worksheets found in Excel file.');
        const ws = wb.Sheets[sheetName];
        // Capture header order exactly as in the sheet (first row)
        try {
          const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });
          const hdr = Array.isArray(aoa) && aoa.length ? aoa[0] : [];
          headerOrder = (hdr || []).map(h => normStr(h)).filter(h => h);
        } catch (e) {
          headerOrder = [];
        }
        const json = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });
        buildIndex(json);
        // Keep search index ready; name selection is handled via the custom Matches list.
        loadedFrom = p;
        setStatus('Excel: loaded (' + index.length.toLocaleString() + ' row(s))');
        setHint('Loaded ' + index.length.toLocaleString() + ' employee row(s).', false);
        return true;
      } catch (e) {
        lastErr = e;
      }
    }

    setStatus('Excel: not loaded');
    const msg =
      'Unable to load the employee database Excel file.\n\n' +
      'Expected file path: ' + DEFAULT_XLSX_PATH + '\n' +
      'Ensure the file exists and is published to GitHub Pages.\n\n' +
      'Details: ' + (lastErr ? lastErr.message : 'Unknown error');
    throw new Error(msg);
  }

  function setMode(next) {
    mode = next === 'name' ? 'name' : 'code';
    const bCode = $('modeCode');
    const bName = $('modeName');
    if (bCode) { bCode.classList.toggle('active', mode === 'code'); bCode.setAttribute('aria-selected', String(mode === 'code')); }
    if (bName) { bName.classList.toggle('active', mode === 'name'); bName.setAttribute('aria-selected', String(mode === 'name')); }

    const input = $('searchInput');
    if (input) {
      input.value = '';
      input.placeholder = mode === 'code'
        ? 'Enter employee code (exact)...'
        : 'Type employee name (partial)...';

      input.focus();
    }

    hideMatches();
    hideResult();
    setHint('', false);
  }

  function hideMatches() {
    const m = $('matches');
    const list = $('matchesList');
    if (list) list.innerHTML = '';
    if (m) m.hidden = true;
  }

  function showMatches(items) {
    const m = $('matches');
    const list = $('matchesList');
    if (!m || !list) return;

    list.innerHTML = '';
    for (const it of items) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'match-item';
      btn.addEventListener('click', () => {
        hideMatches();
        renderResult(it);
      });

      const top = document.createElement('div');
      top.className = 'match-top';

      const name = document.createElement('div');
      name.className = 'match-name';
      name.textContent = it.name || '—';

      const code = document.createElement('div');
      code.className = 'match-code';
      code.textContent = it.code || '—';

      top.appendChild(name);
      top.appendChild(code);

      const sub = document.createElement('div');
      sub.className = 'match-sub';
      const pos = pickField(it.row, ['Position', 'Job Title', 'Title']);
      const dept = pickField(it.row, ['Department', 'Dept', 'Section']);
      sub.textContent = [normStr(pos), normStr(dept)].filter(Boolean).join(' • ') || '—';

      btn.appendChild(top);
      btn.appendChild(sub);

      list.appendChild(btn);
    }

    m.hidden = false;
  }

  function hideResult() {
    const r = $('result');
    const body = $('fieldsBody');
    if (body) body.innerHTML = '';
    if (r) r.hidden = true;
  }

  function renderResult(item) {
    const r = $('result');
    if (!r) return;

    const row = item.row || {};

    // Summary fields (kept at the top)
    const codeKey = pickFieldKey(row, ['EmployeeCode', 'EmpCode', 'Employee Code', 'Code', 'ID', 'Employee ID', 'Emp ID']);
    const nameKey = pickFieldKey(row, ['EmployeeName', 'Name', 'Full Name', 'FullName', 'Employee', 'Employee Name']);
    const posKey  = pickFieldKey(row, ['Position', 'Job Title', 'Title']);
    const deptKey = pickFieldKey(row, ['Department', 'Dept', 'Section']);

    const code = item.code || normStr(codeKey ? row[codeKey] : pickField(row, ['EmployeeCode', 'EmpCode', 'Code', 'ID', 'Employee ID']));
    const name = item.name || normStr(nameKey ? row[nameKey] : pickField(row, ['EmployeeName', 'Name', 'Full Name', 'FullName']));
    const pos  = normStr(posKey ? row[posKey] : pickField(row, ['Position', 'Job Title', 'Title']));
    const dept = normStr(deptKey ? row[deptKey] : pickField(row, ['Department', 'Dept', 'Section']));

    const subtitleBits = [];
    if (loadedFrom) subtitleBits.push('Source: ' + loadedFrom.replace('./',''));
    subtitleBits.push('Sheet row: ' + (index.indexOf(item) + 1).toLocaleString());

    $('rCode').textContent = code || '—';
    $('rName').textContent = name || '—';
    $('rPosition').textContent = pos || '—';
    $('rDept').textContent = dept || '—';

    const sub = $('rSubtitle');
    if (sub) sub.textContent = subtitleBits.join(' • ');

    const excludeDetailKeys = new Set([codeKey, nameKey, posKey, deptKey].filter(Boolean).map(normKey));

    const keys = (Array.isArray(headerOrder) && headerOrder.length)
      ? headerOrder
      : makeKeySort(Object.keys(row || {}));
    const body = $('fieldsBody');
    if (body) {
      body.innerHTML = '';
      for (const k of keys) {
        // Remove the already-shown summary fields from the details table.
        if (excludeDetailKeys.has(normKey(k))) continue;
        const tr = document.createElement('tr');

        const tdK = document.createElement('td');
        tdK.textContent = k;

        const tdV = document.createElement('td');
        const v = row[k];
        tdV.textContent = formatValue(k, v);

        tr.appendChild(tdK);
        tr.appendChild(tdV);
        body.appendChild(tr);
      }
    }

    r.hidden = false;
  }

  function runSearch() {
    const input = $('searchInput');
    const q = input ? normStr(input.value) : '';
    hideMatches();
    hideResult();

    if (!q) {
      setHint('Please enter a value to search.', true);
      return;
    }

    if (!index.length) {
      setHint('Excel data is not loaded yet. Click Reload Excel.', true);
      return;
    }

    const qKey = normKey(q);
    if (mode === 'code') {
      const qCode = qKey.replace(/\s+/g, '');
      const hits = index.filter(it => it.normCode && it.normCode === qCode);

      if (!hits.length) {
        setHint('No employee found for code: ' + q, true);
        return;
      }
      if (hits.length === 1) {
        setHint('1 match found.', false);
        renderResult(hits[0]);
        return;
      }
      setHint(hits.length.toLocaleString() + ' matches found. Please choose one.', false);
      showMatches(hits.slice(0, 50));
      return;
    }

    // Name search (contains, case-insensitive)
    const hits = index.filter(it => it.normName && it.normName.includes(qKey));
    if (!hits.length) {
      setHint('No employee found matching name: ' + q, true);
      return;
    }
    if (hits.length === 1) {
      setHint('1 match found.', false);
      renderResult(hits[0]);
      return;
    }

    setHint(hits.length.toLocaleString() + ' matches found. Showing top ' + Math.min(50, hits.length) + '.', false);
    showMatches(hits.slice(0, 50));
  }

  function findNameMatches(q, limit = 8) {
    const query = normKey(q);
    if (!query) return [];

    const starts = [];
    const contains = [];

    for (const it of index) {
      if (!it.normName) continue;
      if (it.normName.startsWith(query)) starts.push(it);
      else if (it.normName.includes(query)) contains.push(it);
      if (starts.length + contains.length >= limit) {
        // keep scanning a little to prefer startsWith matches (already gathered first)
        // but break once we have enough.
        break;
      }
    }

    return starts.concat(contains).slice(0, limit);
  }

  function handleNameTyping() {
    if (mode !== 'name') return;
    const input = $('searchInput');
    const q = input ? normStr(input.value) : '';

    if (!q) {
      hideMatches();
      hideResult();
      setHint('', false);
      return;
    }

    // If the user typed an exact full name, show it immediately (same behavior as Contacts List).
    const qKey = normKey(q);
    const exact = index.filter(it => it.normName === qKey);
    if (exact.length === 1) {
      hideMatches();
      setHint('1 match found.', false);
      renderResult(exact[0]);
      return;
    }

    hideResult();
    const matches = findNameMatches(q, 8);
    if (!matches.length) {
      hideMatches();
      setHint('No employee found matching this name yet. Keep typing.', true);
      return;
    }
    setHint('Select a name from the list, or press Search.', false);
    showMatches(matches);
  }

  async function initApp() {
    // UI wiring
    const bCode = $('modeCode');
    const bName = $('modeName');
    const bSearch = $('btnSearch');
    const bReload = $('btnReload');
    const bClear = $('btnClear');
    const input = $('searchInput');

    if (bCode) bCode.addEventListener('click', () => setMode('code'));
    if (bName) bName.addEventListener('click', () => setMode('name'));
    if (bSearch) bSearch.addEventListener('click', runSearch);
    if (bClear) bClear.addEventListener('click', () => {
      const i = $('searchInput');
      if (i) i.value = '';
      hideMatches();
      hideResult();
      setHint('', false);
      if (i) i.focus();
    });

    if (bReload) bReload.addEventListener('click', async () => {
      try {
        await loadXlsx();
      } catch (e) {
        setHint(e.message || 'Failed to load Excel.', true);
      }
    });

    if (input) {
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          runSearch();
        }
      });

      // Typeahead suggestions in Name mode.
      let typingTimer = null;
      input.addEventListener('input', () => {
        if (typingTimer) clearTimeout(typingTimer);
        typingTimer = setTimeout(handleNameTyping, 120);
      });
    }

    // Default mode
    setMode('name');

    // Auto-load
    try {
      await loadXlsx();
    } catch (e) {
      setHint(e.message || 'Failed to load Excel.', true);
    }
  }

  // -----------------------------
  // Bootstrap
  // -----------------------------
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
