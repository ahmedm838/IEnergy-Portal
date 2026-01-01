/* Contacts List
   - Reads an Excel file in the browser (default: ./contacts-list.xlsx)
   - Search by Employee Name OR Code
   - No native browser autocomplete dropdown; selections are made from the Matches section
*/
(function () {
  'use strict';

  const elQuery = document.getElementById('nameInput');
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

  /** @type {Array<Record<string, any>>} */
  let rows = [];
  /** @type {Array<{row: Record<string, any>, name: string, code: string, title: string, nName: string, nCode: string}>} */
  let index = [];

  function normStr(v) {
    if (v === null || v === undefined) return '';
    return String(v).replace(/\s+/g, ' ').trim();
  }

  function normKey(v) {
    return normStr(v).toLowerCase();
  }

  function normalizeHeader(h) {
    return normKey(h).replace(/\s+/g, ' ');
  }

  function safeIntString(v) {
    // Excel may store numbers as floats or scientific notation.
    if (v === null || v === undefined || v === '') return '';
    if (typeof v === 'number' && Number.isFinite(v)) return String(Math.trunc(v));
    const s = String(v).trim();
    return s.replace(/\.0$/, '');
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
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
    // Preferred: keep the Excel beside this page under /contacts-list/
    candidates.push(new URL('./contacts-list.xlsx', window.location.href).toString());
    candidates.push(new URL('contacts-list.xlsx', window.location.href).toString());

    // Backward-compatible fallbacks (older builds placed the file under /data/)
    candidates.push(new URL('../data/contacts-list.xlsx', window.location.href).toString());
    candidates.push(new URL('data/contacts-list.xlsx', window.location.href).toString());
    candidates.push(new URL('./data/contacts-list.xlsx', window.location.href).toString());

    const repoBase = getRepoBasePrefix();
    // Preferred (GitHub Pages project site): /<repo>/contacts-list/contacts-list.xlsx
    candidates.push(new URL(repoBase + 'contacts-list/contacts-list.xlsx', window.location.origin).toString());
    // Legacy: /<repo>/data/contacts-list.xlsx
    candidates.push(new URL(repoBase + 'data/contacts-list.xlsx', window.location.origin).toString());

    return Array.from(new Set(candidates));
  }

  function sheetToJson(ws) {
    // Keep blanks, do not infer dates here
    return XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });
  }

  function pickField(row, candidates) {
    // 1) Exact keys
    for (const c of candidates) {
      if (Object.prototype.hasOwnProperty.call(row, c) && normStr(row[c])) return row[c];
    }
    // 2) Normalized key match
    const keys = Object.keys(row || {});
    for (const c of candidates) {
      const cNorm = normalizeHeader(c);
      const k = keys.find(k0 => normalizeHeader(k0) === cNorm);
      if (k && normStr(row[k])) return row[k];
    }
    // 3) Contains match
    for (const c of candidates) {
      const cNorm = normalizeHeader(c);
      const k = keys.find(k0 => normalizeHeader(k0).includes(cNorm));
      if (k && normStr(row[k])) return row[k];
    }
    return '';
  }

  function buildIndex(data) {
    rows = data || [];
    index = [];

    for (const r of rows) {
      const name = normStr(pickField(r, ['Employee Name', 'Name', 'Full Name']));
      const code = normStr(pickField(r, ['Code', 'Employee Code', 'EmployeeCode']));
      const title = normStr(pickField(r, ['Title', 'Position', 'Job Title']));

      if (!name && !code) continue;

      index.push({
        row: r,
        name,
        code,
        title,
        nName: normKey(name),
        nCode: normKey(code)
      });
    }

    setHint(`Loaded ${index.length} contact(s). Type to search by name or code.`, false);
  }

  function renderMatches(list) {
    if (!elMatches) return;
    if (!list || list.length === 0) {
      elMatches.hidden = true;
      elMatches.innerHTML = '';
      return;
    }

    elMatches.hidden = false;
    elMatches.innerHTML = list.map((m) => {
      const label = m.name && m.code ? `${m.name} — ${m.code}` : (m.name || m.code || '');
      return `<button type="button" class="match" data-idx="${m.idx}">${escapeHtml(label)}</button>`;
    }).join('');
  }

  function setResult(row) {
    if (!row) {
      if (elResult) elResult.hidden = true;
      return;
    }

    const name = normStr(pickField(row, ['Employee Name', 'Name', 'Full Name']));
    const title = normStr(pickField(row, ['Title', 'Position', 'Job Title']));
    const code = normStr(pickField(row, ['Code', 'Employee Code', 'EmployeeCode']));

    const mobile = safeIntString(pickField(row, ['Mobile Number', 'Mobile', 'Phone', 'Mobile No.']));
    const email = normStr(pickField(row, ['Email', 'E-mail']));
    const office = safeIntString(pickField(row, ['Office Number', 'Office', 'Office No.']));

    if (elRName) elRName.textContent = name || '—';
    if (elRTitle) elRTitle.textContent = title || '—';
    if (elRCode) elRCode.textContent = `Code: ${code || '—'}`;

    if (elRMobile) elRMobile.textContent = mobile || '—';
    if (elREmail) elREmail.textContent = email || '—';
    if (elROffice) elROffice.textContent = office || '—';

    if (elResult) elResult.hidden = false;
  }

  function findExact(q) {
    const query = normKey(q);
    if (!query) return null;

    // Prefer exact code match, then exact name match
    const byCode = index.find(it => it.nCode && it.nCode === query);
    if (byCode) return byCode;
    const byName = index.find(it => it.nName && it.nName === query);
    if (byName) return byName;
    return null;
  }

  function findMatches(q, limit = 10) {
    const query = normKey(q);
    if (!query) return [];

    /** @type {Array<{idx:number, name:string, code:string, score:number}>} */
    const scored = [];

    for (let i = 0; i < index.length; i++) {
      const it = index[i];
      const nName = it.nName;
      const nCode = it.nCode;
      if (!nName && !nCode) continue;

      let score = 0;
      if (nCode && nCode === query) score = 1000;
      else {
        if (nCode && nCode.startsWith(query)) score = Math.max(score, 320);
        else if (nCode && nCode.includes(query)) score = Math.max(score, 220);

        if (nName && nName.startsWith(query)) score = Math.max(score, 180);
        else if (nName && nName.includes(query)) score = Math.max(score, 120);

        const t = normKey(it.title);
        if (t && t.includes(query)) score = Math.max(score, 60);
      }

      if (score > 0) {
        scored.push({ idx: i, name: it.name, code: it.code, score });
      }
    }

    scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    return scored.slice(0, limit);
  }

  function selectByIndex(idx) {
    const i = Number(idx);
    if (!Number.isFinite(i) || i < 0 || i >= index.length) return;
    const it = index[i];
    setResult(it.row);
    if (elQuery) elQuery.value = it.name || it.code || '';
    renderMatches([]);
    if (elQuery) elQuery.focus();
  }

  async function readWorkbookFromArrayBuffer(buf) {
    const wb = XLSX.read(buf, { type: 'array' });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) throw new Error('No sheets found in Excel file.');
    const ws = wb.Sheets[sheetName];
    const data = sheetToJson(ws);

    // Also add normalized header aliases for robustness.
    return data.map((r) => {
      const o = {};
      for (const k of Object.keys(r)) {
        o[k] = r[k];
        const nk = normalizeHeader(k);
        if (!(nk in o)) o[nk] = r[k];
      }
      return o;
    });
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
      setHint('Unable to load contacts-list.xlsx from the site. Ensure it exists under /contacts-list/.', true);
    }
  }

  // Events
  elQuery?.addEventListener('input', () => {
    const q = elQuery.value;
    const exact = findExact(q);
    if (exact) setResult(exact.row);
    else setResult(null);

    const matches = findMatches(q, 10);
    renderMatches(matches);
  });

  elQuery?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const q = elQuery.value;
    const exact = findExact(q);
    if (exact) {
      setResult(exact.row);
      renderMatches([]);
      return;
    }
    const matches = findMatches(q, 10);
    if (matches.length > 0) {
      e.preventDefault();
      selectByIndex(matches[0].idx);
    }
  });

  elMatches?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-idx]');
    if (!btn) return;
    const idx = btn.getAttribute('data-idx');
    selectByIndex(idx);
  });

  elClear?.addEventListener('click', () => {
    if (elQuery) elQuery.value = '';
    renderMatches([]);
    setResult(null);
    setHint(index.length ? 'Type to search by name or code.' : 'No contacts loaded yet.', false);
    if (elQuery) elQuery.focus();
  });

  init();
})();
