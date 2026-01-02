/* Employee Database
   - Role protected (Admin only)
   - Reads an Excel file in the browser (default: ./IEnergy Employees Database.xlsx)
   - Search by Employee Code (exact) or Employee Name (contains)
   - Displays all columns for the selected employee row
*/
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  let appInited = false;

  function initOnce() {
    if (appInited) return;
    appInited = true;
    initApp();
  }

// -----------------------------
  // Excel loading + search
  // -----------------------------
  const EXCEL_PASSWORD = 'iEnergy25'; // Excel workbook open password
  const DEFAULT_XLSX_PATH = './IEnergy Employees Database.xlsx';
  const FALLBACK_XLSX_PATHS = [
    DEFAULT_XLSX_PATH,
    './IEnergy%20Employees%20Database.xlsx',
    './employees-database.xlsx',
    './employees-database.xls',
    '../data/employees.xlsx',
    './employees.xlsx'
  ];

  let rows = [];
  let index = [];
  let headerOrder = []; // { row, code, name, normCode, normName }
  let loadedFrom = null;

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // (Legacy) Name suggestions via browser-native datalist.
  // The portal uses the Matches panel instead, so this is a no-op unless a
  // datalist is reintroduced.
  function updateNameSuggestions() {
    const dl = $('nameSuggestions');
    if (!dl) return;

    const names = index.map(it => it.name).filter(Boolean);
    const uniq = Array.from(new Set(names)).sort((a, b) => a.localeCompare(b));
    dl.innerHTML = uniq.map(n => `<option value="${escapeHtml(n)}"></option>`).join('');
  }

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

  // Resolve a header (which may have different whitespace/newlines) to the actual key used in the parsed row object.
  function resolveHeaderKey(row, header) {
    if (!row || !header) return header;
    const target = normKey(header);
    const keys = Object.keys(row);
    const exact = keys.find(k0 => normKey(k0) === target);
    return exact || header;
  }

  // Use a clean label for display (Excel headers sometimes include newlines).
  function prettyHeaderLabel(header) {
    return normStr(header) || '';
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
      k === 'sino' ||
      k === 'sijobcode'
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
    // Prefer XlsxPopulate for password-protected workbooks; fall back to SheetJS for unencrypted workbooks.
    const hasEnsurePop = typeof window.__ensureXlsxPopulate === 'function';
    const hasEnsureXLSX = typeof window.__ensureXLSX === 'function';

    if (hasEnsurePop) {
      try { await window.__ensureXlsxPopulate(); } catch (e) { /* ignore */ }
    }
    if (hasEnsureXLSX) {
      try { await window.__ensureXLSX(); } catch (e) { /* ignore */ }
    }

    const hasPop = !!(window.XlsxPopulate && window.XlsxPopulate.fromDataAsync);
    const hasSheetJS = !!window.XLSX;

    if (!hasPop && !hasSheetJS) throw new Error('Unable to load Excel parser libraries (XlsxPopulate / SheetJS).');

    setStatus('Excel: loading…');

    let lastErr = null;
    loadedFrom = null;

    for (const p of FALLBACK_XLSX_PATHS) {
      try {
        const resp = await fetch(encodeURI(p), { cache: 'no-store' });
        if (!resp.ok) throw new Error('HTTP ' + resp.status + ' for ' + p);
        const buf = await resp.arrayBuffer();

        // 1) Try XlsxPopulate (supports password-protected workbooks)
        if (hasPop) {
          try {
            // First try with password. If the file is not encrypted, this also works.
            const wb = await window.XlsxPopulate.fromDataAsync(buf, { password: EXCEL_PASSWORD });

            const sheet = wb.sheet(0);
            if (!sheet) throw new Error('No worksheets found in Excel file.');

            const used = sheet.usedRange();
            const aoa = used ? used.value() : [];
            const hdr = Array.isArray(aoa) && aoa.length ? aoa[0] : [];

            headerOrder = (hdr || [])
              .map(h => (h === null || h === undefined) ? '' : String(h).trim())
              .filter(h => h);

            const data = [];
            const cols = headerOrder.length;

            for (let r = 1; r < (aoa || []).length; r++) {
              const rowArr = aoa[r] || [];
              const obj = {};
              let any = false;

              for (let c = 0; c < cols; c++) {
                const key = headerOrder[c];
                const v = (c < rowArr.length) ? rowArr[c] : '';
                obj[key] = (v === undefined ? '' : v);
                if (v !== null && v !== undefined && String(v).trim() !== '') any = true;
              }

              if (any) data.push(obj);
            }

            buildIndex(data);
            updateNameSuggestions();

            loadedFrom = p;
            setStatus('Excel: loaded (' + index.length.toLocaleString() + ' row(s))');
            setHint('Loaded ' + index.length.toLocaleString() + ' employee row(s).', false);
            return true;
          } catch (ePop) {
            // fall through to SheetJS or next path
            lastErr = ePop;
          }
        }

        // 2) Fallback: SheetJS (works for unencrypted xlsx only)
        if (hasSheetJS) {
          const wb = XLSX.read(buf, { type: 'array', cellDates: true });
          const sheetName = wb.SheetNames && wb.SheetNames[0];
          if (!sheetName) throw new Error('No worksheets found in Excel file.');
          const ws = wb.Sheets[sheetName];

          // Capture header order exactly as in the sheet (first row)
          try {
            const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });
            const hdr = Array.isArray(aoa) && aoa.length ? aoa[0] : [];
            headerOrder = (hdr || []).map(h => (h === null || h === undefined) ? '' : String(h).trim()).filter(h => h);
          } catch (e) {
            headerOrder = [];
          }

          const json = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });
          buildIndex(json);
          updateNameSuggestions();

          loadedFrom = p;
          setStatus('Excel: loaded (' + index.length.toLocaleString() + ' row(s))');
          setHint('Loaded ' + index.length.toLocaleString() + ' employee row(s).', false);
          return true;
        }

        throw new Error('Excel file could not be parsed.');
      } catch (e) {
        lastErr = e;
      }
    }

    setStatus('Excel: not loaded');
    const msg =
      'Unable to load the employee database Excel file.\n\n' +
      'Expected file path: ' + DEFAULT_XLSX_PATH + '\n' +
      'Ensure the file exists and is published to GitHub Pages.\n\n' +
      'If the workbook is password-protected, the portal must load XlsxPopulate with encryption support.\n\n' +
      'Details: ' + (lastErr ? lastErr.message : 'Unknown error');
    throw new Error(msg);
  }

  function normalizeCode(s) {
    return normKey(s).replace(/\s+/g, '');
  }

  function findExact(q) {
    const qName = normKey(q);
    const qCode = normalizeCode(q);
    if (!qName) return null;

    // Prefer exact code match, then exact name match.
    const codeHits = index.filter(it => it.normCode && it.normCode === qCode);
    if (codeHits.length === 1) return { type: 'code', item: codeHits[0] };
    if (codeHits.length > 1) return { type: 'code', items: codeHits };

    const nameHits = index.filter(it => it.normName && it.normName === qName);
    if (nameHits.length === 1) return { type: 'name', item: nameHits[0] };
    if (nameHits.length > 1) return { type: 'name', items: nameHits };

    return null;
  }

  function findMatches(q, limit = 10) {
    const qName = normKey(q);
    const qCode = normalizeCode(q);
    if (!qName) return [];

    /** @type {Array<{item:any, score:number}>} */
    const scored = [];

    for (const it of index) {
      const nCode = it.normCode;
      const nName = it.normName;
      if (!nCode && !nName) continue;

      let score = 0;
      if (nCode && qCode && nCode === qCode) score = 1000;
      else {
        if (nCode && qCode && nCode.startsWith(qCode)) score = Math.max(score, 320);
        else if (nCode && qCode && nCode.includes(qCode)) score = Math.max(score, 220);

        if (nName && nName.startsWith(qName)) score = Math.max(score, 180);
        else if (nName && nName.includes(qName)) score = Math.max(score, 120);

        const pos = normKey(pickField(it.row, ['Position', 'Job Title', 'Title']));
        const dept = normKey(pickField(it.row, ['Department', 'Dept', 'Section']));
        if (pos && pos.includes(qName)) score = Math.max(score, 60);
        if (dept && dept.includes(qName)) score = Math.max(score, 60);
      }

      if (score > 0) scored.push({ item: it, score });
    }

    scored.sort((a, b) => b.score - a.score || (a.item.name || '').localeCompare(b.item.name || ''));
    return scored.slice(0, limit).map(s => s.item);
  }

  function selectItem(it) {
    if (!it) return;
    renderResult(it);
    const input = $('searchInput');
    if (input) input.value = it.name || it.code || '';
    hideMatches();
    if (input) input.focus();
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
      btn.addEventListener('click', () => selectItem(it));

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
        tdK.textContent = prettyHeaderLabel(k);

        const tdV = document.createElement('td');
        const v = row[resolveHeaderKey(row, k)];
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

    if (!q) {
      hideMatches();
      hideResult();
      setHint('Please type an employee name or code.', true);
      return;
    }

    if (!index.length) {
      hideMatches();
      hideResult();
      setHint('Excel data is not loaded yet. Click Reload Excel.', true);
      return;
    }

    const exact = findExact(q);
    if (exact && exact.item) {
      setHint('1 match found.', false);
      hideMatches();
      selectItem(exact.item);
      return;
    }
    if (exact && exact.items && exact.items.length) {
      hideResult();
      setHint(exact.items.length.toLocaleString() + ' exact matches found. Please choose one.', false);
      showMatches(exact.items.slice(0, 50));
      return;
    }

    const matches = findMatches(q, 10);
    if (!matches.length) {
      hideMatches();
      hideResult();
      setHint('No employee found matching: ' + q, true);
      return;
    }

    // If the user pressed Search, selecting the first match is faster.
    if (matches.length === 1) {
      setHint('1 match found.', false);
      hideMatches();
      selectItem(matches[0]);
      return;
    }

    setHint(matches.length.toLocaleString() + ' match(es) found. Select from the list below.', false);
    showMatches(matches);
  }

  function handleTyping() {
    const input = $('searchInput');
    const q = input ? normStr(input.value) : '';

    if (!q) {
      hideMatches();
      hideResult();
      setHint('', false);
      return;
    }

    if (!index.length) {
      hideMatches();
      hideResult();
      setHint('Excel data is not loaded yet. Click Reload Excel.', true);
      return;
    }

    const exact = findExact(q);
    if (exact && exact.item) {
      setHint('1 match found.', false);
      hideMatches();
      selectItem(exact.item);
      return;
    }

    hideResult();
    const matches = (exact && exact.items && exact.items.length)
      ? exact.items.slice(0, 10)
      : findMatches(q, 10);

    if (!matches.length) {
      hideMatches();
      setHint('No matches yet. Keep typing.', true);
      return;
    }

    setHint('Select from the Matches list, or press Enter.', false);
    showMatches(matches);
  }

  async function initApp() {
    // UI wiring
    const bSearch = $('btnSearch');
    const bReload = $('btnReload');
    const bClear = $('btnClear');
    const input = $('searchInput');

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
      // Ensure browser-native autocomplete does not show.
      input.setAttribute('autocomplete', 'off');
      input.removeAttribute('list');

      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          // Enter selects exact match; otherwise selects the first match.
          const q = normStr(input.value);
          const exact = findExact(q);
          if (exact && exact.item) {
            setHint('1 match found.', false);
            selectItem(exact.item);
            return;
          }
          const matches = findMatches(q, 10);
          if (matches.length > 0) {
            setHint('Selected first match.', false);
            selectItem(matches[0]);
            return;
          }
          runSearch();
        }
      });

      // Typeahead suggestions (name or code) using the Matches panel.
      let typingTimer = null;
      input.addEventListener('input', () => {
        if (typingTimer) clearTimeout(typingTimer);
        typingTimer = setTimeout(handleTyping, 120);
      });
    }

    // Initial UI state
    if (input) input.placeholder = 'Type employee name or code...';
    hideMatches();
    hideResult();
    setHint('', false);

    // Auto-load
    try {
      await loadXlsx();
    } catch (e) {
      setHint(e.message || 'Failed to load Excel.', true);
    }
  }
// -----------------------------
  // Boot
  // -----------------------------
  document.addEventListener('DOMContentLoaded', () => {
    const y = $('year');
    if (y) y.textContent = String(new Date().getFullYear());

    // Public page (no auth gate)
    const app = $('app');
    if (app) app.hidden = false;

    initOnce();
  });
})();
