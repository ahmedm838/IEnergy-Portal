/* Contacts List
   - Searches the live employee directory in the Attendance Tracker
   - Search by Employee Name OR Code
   - No native browser autocomplete dropdown; selections are made from the Matches section
*/
(function () {
  'use strict';

  /* Nothing is loaded when the page opens. Each search goes to the
     Attendance Tracker's employee_contacts view and asks the database
     directly, so a number HR changed a moment ago is already there --
     no reload, nothing cached to go stale. The view is read-only and
     exposes contact columns for active employees only; everything else
     stays behind row level security. The key below is the publishable
     anon key. */
  const SUPABASE_URL = 'https://ednaedkurjsgvjrvayys.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVkbmFlZGt1cmpzZ3ZqcnZheXlzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE5ODIzNzYsImV4cCI6MjEwNzU1ODM3Nn0.VvBg4YtwZsjmgmTxbf3vin3Oq_WyNTeioz6m-FRQLzA';

  /* Typing is faster than the network, so a search waits for a short
     pause and every reply carries the number of the keystroke that asked
     for it -- otherwise a slow early request can land after a later one
     and overwrite the newer results with older ones. */
  const DEBOUNCE_MS = 220;
  const SEARCH_LIMIT = 25;
  let searchSeq = 0;
  let debounceTimer = null;

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
    if (v === null || v === undefined || v === '') return '';
    if (typeof v === 'number' && Number.isFinite(v)) return String(Math.trunc(v));
    const s = String(v).trim();
    return s.replace(/\.0$/, '');
  }

  function setHint(msg, isError) {
    if (!elHint) return;
    elHint.textContent = msg;
    elHint.style.opacity = isError ? '1' : '0.85';
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

  /* The database has already narrowed the rows to those that match
     somewhere. This only decides the order they are offered in, so a code
     still beats a name and a name still beats a job title. */
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

      // Returned by the search but matching none of the above (an accent
      // or a case the database folded and this does not). Keep it, last.
      if (score === 0) score = 10;

      scored.push({ idx: i, name: it.name, code: it.code, score });
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

  /* PostgREST reads commas and parentheses as its own syntax, so the
     value is double-quoted; the characters stripped here are the ones
     that would end that quoting early or turn the search into a wildcard
     the person did not type. */
  function filterValue(q) {
    return String(q).replace(/[\\"*%]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  async function searchDatabase(q) {
    const safe = filterValue(q);
    if (!safe) return [];

    const pattern = `"*${safe}*"`;
    const params = new URLSearchParams({
      select: 'code,name,title,department,site,email,company_mobile,office_number',
      or: `(name.ilike.${pattern},title.ilike.${pattern},code_text.ilike.${pattern})`,
      order: 'code.asc',
      limit: String(SEARCH_LIMIT),
    });

    const resp = await fetch(SUPABASE_URL + '/rest/v1/employee_contacts?' + params.toString(), {
      headers: { apikey: SUPABASE_ANON_KEY, Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);

    const data = await resp.json();
    // Mapped onto the header names the spreadsheet used, so the match
    // list and the result card below keep working untouched.
    return data.map(function (r) {
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

  function resetSearch(message) {
    searchSeq++; // abandon anything still in flight
    buildIndex([]);
    hideMatches();
    setResult(null);
    setHint(message, false);
  }

  async function runSearch(q) {
    if (!normStr(q)) {
      resetSearch('Type a name or code to search.');
      return;
    }

    const seq = ++searchSeq;
    setHint('Searching…', false);

    try {
      const data = await searchDatabase(q);
      if (seq !== searchSeq) return; // a later keystroke has already won

      buildIndex(data);

      if (index.length === 0) {
        hideMatches();
        setResult(null);
        setHint(`No employee matches “${normStr(q)}”.`, false);
        return;
      }

      const exact = findExact(q);
      setResult(exact ? exact.row : null);
      showMatches(findMatches(q, 10));
      setHint(
        index.length === 1
          ? '1 match.'
          : `${index.length}${index.length === SEARCH_LIMIT ? '+' : ''} matches. Pick one from the list.`,
        false
      );
    } catch (e) {
      if (seq !== searchSeq) return;
      hideMatches();
      setResult(null);
      setHint('Could not reach the directory (' + e.message + '). Please try again shortly.', true);
    }
  }

  // Events
  elQuery?.addEventListener('input', () => {
    const q = elQuery.value;
    if (debounceTimer) clearTimeout(debounceTimer);
    if (!normStr(q)) {
      resetSearch('Type a name or code to search.');
      return;
    }
    debounceTimer = setTimeout(() => runSearch(q), DEBOUNCE_MS);
  });

  elQuery?.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();

    // Enter means "now", so do not sit out the rest of the debounce.
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
      await runSearch(elQuery.value);
    }

    const exact = findExact(elQuery.value);
    if (exact) {
      setResult(exact.row);
      hideMatches();
      return;
    }
    const matches = findMatches(elQuery.value, 10);
    if (matches.length > 0) selectByIndex(matches[0].idx);
  });

  elMatches?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-idx]');
    if (!btn) return;
    const idx = btn.getAttribute('data-idx');
    selectByIndex(idx);
  });

  elClear?.addEventListener('click', () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    if (elQuery) elQuery.value = '';
    resetSearch('Type a name or code to search.');
    if (elQuery) elQuery.focus();
  });
})();
