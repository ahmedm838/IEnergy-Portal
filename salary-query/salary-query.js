/* Salary Query
   - Reads ../data/employees.xlsx in the browser
   - Looks up by EmployeeCode
*/
(function () {
  'use strict';

  const EXCEL_PATH = '../data/employees.xlsx';

  const elCode = document.getElementById('empCode');
  const elBtn = document.getElementById('btnSearch');
  const elStatus = document.getElementById('status');
  const elResult = document.getElementById('result');

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
    // String (already formatted or text)
    return String(v).trim() || '—';
  }

  function getField(row, keys) {
    for (const k of keys) {
      if (Object.prototype.hasOwnProperty.call(row, k) && row[k] !== '') return row[k];
    }
    return '';
  }

  async function loadEmployees() {
    if (loaded) return;
    try {
      elStatus.textContent = 'Loading employees file…';
      const resp = await fetch(EXCEL_PATH, { cache: 'no-store' });
      if (!resp.ok) throw new Error(`Failed to fetch Excel (${resp.status})`);

      const buf = await resp.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', cellDates: true });
      const first = wb.SheetNames[0];
      if (!first) throw new Error('Excel file has no sheets.');

      const ws = wb.Sheets[first];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

      const map = new Map();
      for (const row of rows) {
        const code = normalizeCode(getField(row, ['EmployeeCode', 'Employee Code', 'EmpCode', 'Code', 'Employee_ID', 'EmployeeID']));
        if (!code) continue;
        map.set(code, row);
      }

      employeeMap = map;
      loaded = true;

      elStatus.textContent = `Loaded ${employeeMap.size} employees.`;
      setTimeout(() => { if (elStatus.textContent.startsWith('Loaded')) elStatus.textContent = ''; }, 1800);
    } catch (err) {
      console.error(err);
      elStatus.textContent = 'Unable to load employees.xlsx. Make sure it exists at data/employees.xlsx and is published to GitHub Pages.';
    }
  }

  function showRow(row) {
    const name = getField(row, ['Name', 'EmployeeName', 'Employee Name']);
    const position = getField(row, ['Position', 'Title', 'JobTitle', 'Job Title']);
    const hiring = getField(row, ['HiringDate', 'Hiring Date', 'HireDate', 'Hire Date']);
    const gross = getField(row, ['BasicGrossSalary', 'Basic Gross Salary', 'BasicGross', 'Basic Gross']);
    const si = getField(row, ['BasicSocialInsuranceSalary', 'Basic Social Insurance Salary', 'BasicSISalary', 'Basic SI Salary', 'SocialInsuranceSalary']);

    rName.textContent = name ? String(name) : '—';
    rPosition.textContent = position ? String(position) : '—';
    rHiringDate.textContent = formatDate(hiring);
    rBasicGross.textContent = formatNumber(gross);
    rBasicSI.textContent = formatNumber(si);

    elResult.classList.remove('hidden');
  }

  function clearResult() {
    elResult.classList.add('hidden');
    rName.textContent = '—';
    rPosition.textContent = '—';
    rHiringDate.textContent = '—';
    rBasicGross.textContent = '—';
    rBasicSI.textContent = '—';
  }

  async function handleSearch() {
    clearResult();
    await loadEmployees();
    if (!loaded) return;

    const code = normalizeCode(elCode.value);
    if (!code) {
      elStatus.textContent = 'Please enter an employee code.';
      return;
    }

    const row = employeeMap.get(code);
    if (!row) {
      elStatus.textContent = `No employee found for code: ${code}`;
      return;
    }

    elStatus.textContent = '';
    showRow(row);
  }

  elBtn.addEventListener('click', handleSearch);
  elCode.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleSearch();
  });

  // Preload file in background (best-effort)
  loadEmployees();
})();
