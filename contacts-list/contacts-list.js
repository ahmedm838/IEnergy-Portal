/* Contacts List
   - Reads an Excel file in the browser (default: ../data/contacts-list.xlsx)
   - Autocomplete by Employee Name, then displays contact details
*/
(function () {
  'use strict';

  const elName = document.getElementById('nameInput');
  const elSuggestions = document.getElementById('nameSuggestions');
  const elHint = document.getElementById('hintMsg');
  const elMatches = document.getElementById('matches');
  const elClear = document.getElementById('clearBtn');

  const elResult = document.getElementById('result');
  const elRName = document.getElementById('rName');
  const elRTitle = document.getElementById('rTitle');
  const elRCode = document.getElementById('rCode');
  const elRMobile = document.getElementById('rMobile');
  const elREmail = document.getElementById('rEmail');
  const elROffice = document.getElementById('rOffice');

  const elExcelFile = document.getElementById('excelFile');

  /** @type {Array<Record<string, any>>} */
  let rows = [];
  /** @type {Map<string, Record<string, any>[]>} */
  const byName = new Map(); // lower(name) -> list of rows

  function normStr(v) {
    if (v === null || v === undefined) return '';
    return String(v).trim();
  }

  function normalizeHeader(h) {
    return normStr(h).toLowerCase().replace(/\s+/g, ' ');
  }

  function safeIntString(v) {
    // Excel may store numbers as floats or scientific notation.
    if (v === null || v === undefined || v === '') return '';
    if (typeof v === 'number' && Number.isFinite(v)) {
      // Convert without scientific notation
      const asInt = Math.trunc(v);
      return String(asInt);
    }
    // Strings: strip trailing .0
    const s = String(v).trim();
    return s.replace(/\.0$/, '');
  }

  function setHint(msg, isError) {
    if (!elHint) return;
    elHint.textContent = msg;
    elHint.style.opacity = isError ? '1' : '0.85';
  }

  function getRepoBasePrefix() {
    // If hosted on GitHub Project Pages, path looks like /<repo>/...
    const parts = window.location.pathname.split('/').filter(Boolean);
    if (parts.length === 0) return '/';
    return `/${parts[0]}/`;
  }

  function buildExcelCandidates() {
    const candidates = [];
    candidates.push(new URL('../data/contacts-list.xlsx', window.location.href).toString());
    candidates.push(new URL('data/contacts-list.xlsx', window.location.href).toString());
    candidates.push(new URL('./data/contacts-list.xlsx', window.location.href).toString());

    const repoBase = getRepoBasePrefix();
    candidates.push(new URL(repoBase + 'data/contacts-list.xlsx', window.location.origin).toString());
    return Array.from(new Set(candidates));
  }

  function sheetToJson(ws) {
    // Keep blanks, do not infer dates here
    return XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });
  }

  function buildIndex(data) {
    rows = data;

    byName.clear();
    const names = [];

    for (const r of rows) {
      // Support slightly different column names
      const name = normStr(r['Employee Name'] ?? r['Name'] ?? r['Full Name'] ?? r['employee name'] ?? r['employee_name']);
      if (!name) continue;

      const key = name.toLowerCase();
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key).push(r);
      names.push(name);
    }

    // Populate datalist
    const uniq = Array.from(new Set(names)).sort((a, b) => a.localeCompare(b));
    elSuggestions.innerHTML = uniq.map(n => `<option value="${escapeHtml(n)}"></option>`).join('');
    setHint(`Loaded ${uniq.length} contact(s). Start typing to search.`, false);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function findMatches(q, limit = 8) {
    const query = normStr(q).toLowerCase();
    if (!query) return [];
    const out = [];
    for (const [key] of byName) {
      if (key.includes(query)) {
        out.push(key);
        if (out.length >= limit) break;
      }
    }
    // Convert back to display names (preserve original casing by taking first row)
    return out.map(k => normStr(byName.get(k)?.[0]?.['Employee Name'] ?? byName.get(k)?.[0]?.['Name'] ?? k));
  }

  function renderMatches(list) {
    if (!elMatches) return;
    if (!list || list.length === 0) {
      elMatches.hidden = true;
      elMatches.innerHTML = '';
      return;
    }
    elMatches.hidden = false;
    elMatches.innerHTML = list.map(n => `<button type="button" class="match" data-name="${escapeHtml(n)}">${escapeHtml(n)}</button>`).join('');
  }

  function setResult(row) {
    if (!row) {
      elResult.hidden = true;
      return;
    }

    const name = normStr(row['Employee Name'] ?? row['Name'] ?? row['Full Name'] ?? '');
    const title = normStr(row['Title'] ?? row['Position'] ?? '');
    const code = normStr(row['Code'] ?? row['Employee Code'] ?? row['EmployeeCode'] ?? '');

    const mobile = safeIntString(row['Mobile Number'] ?? row['Mobile'] ?? row['Phone'] ?? '');
    const email = normStr(row['Email'] ?? row['E-mail'] ?? '');
    const office = safeIntString(row['Office Number'] ?? row['Office'] ?? '');

    elRName.textContent = name || '—';
    elRTitle.textContent = title || '—';
    elRCode.textContent = `Code: ${code || '—'}`;

    elRMobile.textContent = mobile || '—';
    elREmail.textContent = email || '—';
    elROffice.textContent = office || '—';

    elResult.hidden = false;
  }

  function resolveSelection(value) {
    const v = normStr(value);
    if (!v) {
      setResult(null);
      return;
    }
    const key = v.toLowerCase();
    const hit = byName.get(key);
    if (hit && hit.length >= 1) {
      // If duplicates exist, take the first and show a note in hint.
      setResult(hit[0]);
      if (hit.length > 1) setHint(`Found ${hit.length} entries with the same name. Showing the first match.`, false);
      return;
    }

    // If not exact, show closest matches (already rendered) and keep result hidden.
    setResult(null);
  }

  async function readWorkbookFromArrayBuffer(buf) {
    const wb = XLSX.read(buf, { type: 'array' });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) throw new Error('No sheets found in Excel file.');
    const ws = wb.Sheets[sheetName];
    const data = sheetToJson(ws);

    // Normalize headers: SheetJS already uses headers as-is. Ensure we map variations.
    // We'll also create a normalized object for each row for more robust access.
    const normalized = data.map((r) => {
      const o = {};
      for (const k of Object.keys(r)) {
        o[k] = r[k];
        const nk = normalizeHeader(k);
        if (!(nk in o)) o[nk] = r[k];
      }
      return o;
    });

    return normalized;
  }

  async function tryLoadFromUrl() {
    const candidates = buildExcelCandidates();
    for (const url of candidates) {
      try {
        const resp = await fetch(url, { cache: 'no-store' });
        if (!resp.ok) continue;
        const buf = await resp.arrayBuffer();
        const data = await readWorkbookFromArrayBuffer(buf);
        buildIndex(data);
        return true;
      } catch (e) {
        // try next
      }
    }
    return false;
  }

  async function init() {
    const okXlsx = await window.__ensureXLSX?.();
    if (!okXlsx || !window.XLSX) {
      setHint('Cannot load Excel reader library (XLSX). Check your network or ad-blocker.', true);
      return;
    }

    const loaded = await tryLoadFromUrl();
    if (!loaded) {
      setHint('Unable to load contacts-list.xlsx from the site. Upload the Excel file below.', true);
    }
  }

  // Events
  elName?.addEventListener('input', () => {
    const q = elName.value;
    const matches = findMatches(q, 8);
    renderMatches(matches);

    // Show result only on exact match (so user can select first)
    resolveSelection(q);
  });

  elName?.addEventListener('change', () => {
    resolveSelection(elName.value);
  });

  elMatches?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-name]');
    if (!btn) return;
    const name = btn.getAttribute('data-name') || '';
    elName.value = name;
    renderMatches([]);
    resolveSelection(name);
    elName.focus();
  });

  elClear?.addEventListener('click', () => {
    elName.value = '';
    renderMatches([]);
    setResult(null);
    setHint(byName.size ? 'Start typing to search.' : 'No contacts loaded yet.', false);
    elName.focus();
  });

  elExcelFile?.addEventListener('change', async () => {
    const file = elExcelFile.files && elExcelFile.files[0];
    if (!file) return;

    try {
      const buf = await file.arrayBuffer();
      const data = await readWorkbookFromArrayBuffer(buf);
      buildIndex(data);
    } catch (e) {
      setHint(`Failed to read Excel file: ${e && e.message ? e.message : 'Unknown error'}`, true);
    }
  });

  init();
})();
