/* Salary Query
   - Password protected (10 min unlock): iEnergyS
   - Reads an Excel file in the browser (default: ../data/employees.xlsx)
   - Looks up an employee by EmployeeCode and displays key fields
*/
(function () {
  'use strict';

  // -----------------------------
  // Auth gate
  // -----------------------------
  const AUTH_PASSWORD = 'iEnergyS';
  const AUTH_TTL_MS = 10 * 60 * 1000; // 10 minutes
  const AUTH_KEY = 'ienergy_salary_query_unlocked_at';

  const elAuthGate = document.getElementById('authGate');
  const elAuthApp = document.getElementById('queryApp');
  const elPass = document.getElementById('sqPassword');
  const elPassBtn = document.getElementById('sqUnlock');
  const elPassMsg = document.getElementById('sqAuthMsg');

  function nowMs() { return Date.now(); }

  function isUnlocked() {
    const raw = localStorage.getItem(AUTH_KEY);
    const ts = raw ? Number(raw) : 0;
    if (!Number.isFinite(ts) || ts <= 0) return false;
    return (nowMs() - ts) <= AUTH_TTL_MS;
  }

  function setUnlocked() {
    localStorage.setItem(AUTH_KEY, String(nowMs()));
  }

  function showAuth() {
    if (elAuthGate) elAuthGate.classList.remove('hidden');
    if (elAuthApp) elAuthApp.classList.add('hidden');
    if (elPass) elPass.focus();
  }

  function showApp() {
    if (elAuthGate) elAuthGate.classList.add('hidden');
    if (elAuthApp) elAuthApp.classList.remove('hidden');
  }

  function unlockAttempt() {
    if (!elPass) return;
    const v = String(elPass.value || '').trim();
    if (v === AUTH_PASSWORD) {
      setUnlocked();
      if (elPassMsg) elPassMsg.textContent = '';
      elPass.value = '';
      showApp();
      // Best-effort preload
      loadEmployees();
    } else {
      if (elPassMsg) elPassMsg.textContent = 'Incorrect password.';
      elPass.focus();
      elPass.select();
    }
  }

  if (elPassBtn) elPassBtn.addEventListener('click', unlockAttempt);
  if (elPass) {
    elPass.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') unlockAttempt();
    });
  }

  // Initial gate decision
  if (isUnlocked()) {
    showApp();
  } else {
    showAuth();
  }

  // -----------------------------
  // Salary query logic
  // -----------------------------
  const elCode = document.getElementById('empCode');
  const elBtn = document.getElementById('btnSearch');
  const elStatus = document.getElementById('status');
  const elResult = document.getElementById('result');
  const elExcelFile = document.getElementById('excelFile');
  const elFileBox = document.getElementById('fileFallback');

  const rName = document.getElementById('rName');
  const rPosition = document.getElementById('rPosition');
  const rHiringDate = document.getElementById('rHiringDate');
  const rBasicGross = document.getElementById('rBasicGross');
  const rBasicSI = document.getElementById('rBasicSI');

  /** @type {Map<string, any>} */
  let employeeMap = new Map();
  let loaded = false;

  const nf = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

  function normalizeCode(v) {
    if (v === null || v === undefined) return '';
    return String(v).trim();
  }

  function toNumber(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return v;
    const s = String(v).replace(/,/g, '').trim();
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  function formatNumber(v) {
    const n = toNumber(v);
    return (n === null) ? '—' : nf.format(n);
  }

  function formatDate(v) {
    if (v === null || v === undefined || v === '') return '—';

    // Date object
    if (v instanceof Date && !Number.isNaN(v.getTime())) {
      return v.toISOString().slice(0, 10);
    }

    // Excel serial date number
    if (typeof v === 'number' && window.XLSX && XLSX.SSF && XLSX.SSF.parse_date_code) {
      const dc = XLSX.SSF.parse_date_code(v);
      if (dc && dc.y && dc.m && dc.d) {
        const mm = String(dc.m).padStart(2, '0');
        const dd = String(dc.d).padStart(2, '0');
        return `${dc.y}-${mm}-${dd}`;
      }
    }

    // String
    return String(v).trim() || '—';
  }

  function getField(row, keys) {
    for (const k of keys) {
      if (Object.prototype.hasOwnProperty.call(row, k) && row[k] !== '') return row[k];
    }
    return '';
  }

  function getRepoBasePrefix() {
    // For GitHub Project Pages, the site is served from /<repo-name>/...
    // For User Pages or custom domains, it is typically served from /.
    const parts = window.location.pathname.split('/').filter(Boolean);
    if (parts.length === 0) return '/';
    return `/${parts[0]}/`;
  }

  function buildExcelCandidates() {
    const candidates = [];

    // Most common layouts
    candidates.push(new URL('../data/employees.xlsx', window.location.href).toString()); // salary-query/ -> data/
    candidates.push(new URL('data/employees.xlsx', window.location.href).toString());   // if salary-query is root
    candidates.push(new URL('./data/employees.xlsx', window.location.href).toString()); // if current folder contains data/

    // GitHub Project Pages base path
    const repoBase = getRepoBasePrefix();
    candidates.push(new URL(repoBase + 'data/employees.xlsx', window.location.origin).toString());

    // If the repo contents were committed under an extra folder (common when uploading a zip folder)
    candidates.push(new URL(repoBase + 'Salary-Calculator-main/data/employees.xlsx', window.location.origin).toString());
    candidates.push(new URL('/Salary-Calculator-main/data/employees.xlsx', window.location.origin).toString());

    // User Pages / custom domain root
    candidates.push(new URL('/data/employees.xlsx', window.location.origin).toString());

    // De-duplicate while preserving order
    const seen = new Set();
    return candidates.filter((u) => (seen.has(u) ? false : (seen.add(u), true)));
  }

  async function fetchExcelWithFallback() {
    const urls = buildExcelCandidates();
    const attempts = [];

    for (const url of urls) {
      try {
        const resp = await fetch(url, { cache: 'no-store' });
        attempts.push({ url, status: resp.status, ok: resp.ok });

        if (!resp.ok) continue;

        const buf = await resp.arrayBuffer();
        if (!buf || buf.byteLength < 64) continue;

        return { buf, url, attempts };
      } catch (e) {
        attempts.push({ url, error: String(e) });
      }
    }

    const err = new Error('All Excel URL candidates failed.');
    err.attempts = attempts;
    throw err;
  }

  function parseExcelArrayBuffer(buf) {
    const wb = XLSX.read(buf, { type: 'array', cellDates: true });
    const first = wb.SheetNames[0];
    if (!first) throw new Error('Excel file has no sheets.');
    const ws = wb.Sheets[first];
    return XLSX.utils.sheet_to_json(ws, { defval: '' });
  }

  function loadFromRows(rows) {
    const map = new Map();
    for (const row of rows) {
      const code = normalizeCode(getField(row, ['EmployeeCode', 'Employee Code', 'EmpCode', 'Code', 'Employee_ID', 'EmployeeID']));
      if (!code) continue;
      map.set(code, row);
    }
    employeeMap = map;
    loaded = true;
    if (elStatus) {
      elStatus.textContent = `Loaded ${employeeMap.size} employees.`;
      setTimeout(() => {
        if (elStatus.textContent && elStatus.textContent.startsWith('Loaded')) elStatus.textContent = '';
      }, 1800);
    }
  }

  async function loadEmployees() {
    if (loaded) return;
    if (!window.XLSX) {
      if (elStatus) elStatus.textContent = 'Excel library did not load. Please refresh the page.';
      return;
    }

    try {
      if (elStatus) elStatus.textContent = 'Loading employees file…';

      const { buf, url, attempts } = await fetchExcelWithFallback();
      const rows = parseExcelArrayBuffer(buf);
      loadFromRows(rows);

      console.info('Employees loaded from:', url, attempts);
    } catch (err) {
      console.error(err);

      const attempts = err && err.attempts ? err.attempts : [];
      const lines = attempts.slice(0, 8).map((a) => {
        if (a.error) return `• ${a.url} → ${a.error}`;
        return `• ${a.url} → HTTP ${a.status}${a.ok ? ' (OK)' : ''}`;
      });

      if (elStatus) {
        elStatus.textContent = 'Unable to load employees.xlsx from the website. Confirm that data/employees.xlsx exists in the published output.';
      }

      if (elFileBox) elFileBox.classList.remove('hidden');

      if (lines.length) {
        console.info('Excel fetch attempts:\n' + lines.join('\n'));
      }
    }
  }

  async function loadEmployeesFromFile(file) {
    if (!file) return;
    if (!window.XLSX) {
      if (elStatus) elStatus.textContent = 'Excel library did not load. Please refresh the page.';
      return;
    }

    try {
      if (elStatus) elStatus.textContent = `Loading ${file.name}…`;
      const buf = await file.arrayBuffer();
      const rows = parseExcelArrayBuffer(buf);
      loaded = false;
      employeeMap = new Map();
      loadFromRows(rows);
    } catch (err) {
      console.error(err);
      if (elStatus) elStatus.textContent = 'Unable to read the selected Excel file. Please use a valid .xlsx file.';
    }
  }

  function showRow(row) {
    const name = getField(row, ['Name', 'EmployeeName', 'Employee Name']);
    const position = getField(row, ['Position', 'Title', 'JobTitle', 'Job Title']);
    const hiring = getField(row, ['HiringDate', 'Hiring Date', 'HireDate', 'Hire Date']);
    const gross = getField(row, ['BasicGrossSalary', 'Basic Gross Salary', 'BasicGross', 'Basic Gross']);
    const si = getField(row, ['BasicSocialInsuranceSalary', 'Basic Social Insurance Salary', 'BasicSISalary', 'Basic SI Salary', 'SocialInsuranceSalary']);

    if (rName) rName.textContent = name ? String(name) : '—';
    if (rPosition) rPosition.textContent = position ? String(position) : '—';
    if (rHiringDate) rHiringDate.textContent = formatDate(hiring);
    if (rBasicGross) rBasicGross.textContent = formatNumber(gross);
    if (rBasicSI) rBasicSI.textContent = formatNumber(si);

    if (elResult) elResult.classList.remove('hidden');
  }

  function clearResult() {
    if (elResult) elResult.classList.add('hidden');
    if (rName) rName.textContent = '—';
    if (rPosition) rPosition.textContent = '—';
    if (rHiringDate) rHiringDate.textContent = '—';
    if (rBasicGross) rBasicGross.textContent = '—';
    if (rBasicSI) rBasicSI.textContent = '—';
  }

  async function handleSearch() {
    if (!isUnlocked()) {
      showAuth();
      return;
    }

    clearResult();
    await loadEmployees();
    if (!loaded) return;

    const code = normalizeCode(elCode ? elCode.value : '');
    if (!code) {
      if (elStatus) elStatus.textContent = 'Please enter an employee code.';
      return;
    }

    const row = employeeMap.get(code);
    if (!row) {
      if (elStatus) elStatus.textContent = `No employee found for code: ${code}`;
      return;
    }

    if (elStatus) elStatus.textContent = '';
    showRow(row);
  }

  if (elBtn) elBtn.addEventListener('click', handleSearch);

  if (elCode) {
    elCode.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleSearch();
    });
  }

  if (elExcelFile) {
    elExcelFile.addEventListener('change', () => {
      const f = elExcelFile.files && elExcelFile.files[0];
      if (f) loadEmployeesFromFile(f);
    });
  }

  // Best-effort preload if already unlocked
  if (isUnlocked()) loadEmployees();
})();
