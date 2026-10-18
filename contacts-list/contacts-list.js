/* Contacts List
   - Reads the live employee directory from the Attendance Tracker
   - Search by Employee Name OR Code
   - No native browser autocomplete dropdown; selections are made from the Matches section
*/
(function () {
  'use strict';

  /* Contacts come from the Attendance Tracker's employee_contacts view, so
     the portal shows whatever HR last saved rather than a spreadsheet that
     has to be re-exported. The view is read-only and exposes contact
     columns for active employees only; everything else stays behind row
     level security. The key below is the publishable anon key. */
  const SUPABASE_URL = 'https://ednaedkurjsgvjrvayys.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVkbmFlZGt1cmpzZ3ZqcnZheXlzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE5ODIzNzYsImV4cCI6MjEwNzU1ODM3Nn0.VvBg4YtwZsjmgmTxbf3vin3Oq_WyNTeioz6m-FRQLzA';

  const elQuery = document.getElementById('nameInput');
  const elHint = document.getElementById('hintMsg');
  const elMatches = document.getElementById('matches');
  const elMatchesList = document.getElementById('matchesList');
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

  function hideMatches() {
    if (elMatchesList) elMatchesList.innerHTML = '';
    if (elMatches) elMatches.hidden = true;
  }

  function showMatches(list) {
    if (!elMatches || !elMatchesList) return;
    if (!list || list.length === 0) {
      hideMatches();
      return;
    }

    elMatchesList.innerHTML = '';
    for (const m of list) {
      const it = index[m.idx];
      if (!it) continue;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'match-item';
      btn.setAttribute('data-idx', String(m.idx));

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
      const office = safeIntString(pickField(it.row, ['Office Number', 'Office', 'Office No.']));
      const bits = [normStr(it.title), office ? `Office: ${office}` : ''].filter(Boolean);
      sub.textContent = bits.join(' • ') || '—';

      btn.appendChild(top);
      btn.appendChild(sub);

      elMatchesList.appendChild(btn);
    }

    elMatches.hidden = false;
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
    hideMatches();
    if (elQuery) elQuery.focus();
  }

  async function loadFromDatabase() {
    // Mapped onto the same header names the spreadsheet used, so the
    // search, the match list and the result card below keep working
    // untouched -- only where the rows come from has changed.
    const params = new URLSearchParams({
      select: 'code,name,title,department,site,email,company_mobile,office_number',
      order: 'code.asc',
    });
    const url = SUPABASE_URL + '/rest/v1/employee_contacts?' + params.toString();

    const resp = await fetch(url, {
      headers: { apikey: SUPABASE_ANON_KEY, Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);

    const rows = await resp.json();
    return rows.map(function (r) {
      return {
        'Code': r.code,
        'Employee Name': r.name,
        'Name': r.name,
        'Title': r.title,
        'Department': r.department,
        'Site': r.site,
        'Email': r.email,
        'Mobile Number': r.company_mobile,
        'Office Number': r.office_number,
      };
    });
  }

  async function init() {
    try {
      const data = await loadFromDatabase();
      if (!data.length) {
        setHint('No active employees found in the directory.', true);
        return;
      }
      buildIndex(data);
    } catch (e) {
      setHint('Could not load the contacts directory (' + e.message + '). Please try again shortly.', true);
    }
  }
  // Events
  elQuery?.addEventListener('input', () => {
    const q = elQuery.value;
    const exact = findExact(q);
    if (exact) setResult(exact.row);
    else setResult(null);

    const matches = findMatches(q, 10);
    showMatches(matches);
  });

  elQuery?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const q = elQuery.value;
    const exact = findExact(q);
    if (exact) {
      setResult(exact.row);
      hideMatches();
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
    hideMatches();
    setResult(null);
    setHint(index.length ? 'Type to search by name or code.' : 'No contacts loaded yet.', false);
    if (elQuery) elQuery.focus();
  });

  init();
})();
