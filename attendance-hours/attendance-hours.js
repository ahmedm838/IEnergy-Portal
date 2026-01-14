/* Attendance Hours (client-side only)
   - Stores records in localStorage
   - Calculates daily hours = (sign-out - sign-in) - break minutes
   - If sign-out is earlier than sign-in, it assumes sign-out is next day.
   - Export: CSV (Excel-friendly)
*/
(function () {
  'use strict';

  const STORAGE_KEY = 'ienergy_attendance_records_v1';

  function $(id) { return document.getElementById(id); }

  function nowISODate() {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
  }

  function defaultMonth() {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${d.getFullYear()}-${m}`;
  }

  function parseTimeToMinutes(t) {
    // 'HH:MM' -> minutes from midnight
    if (!t || typeof t !== 'string') return null;
    const m = t.match(/^([0-1]\d|2[0-3]):([0-5]\d)$/);
    if (!m) return null;
    const hh = Number(m[1]);
    const mm = Number(m[2]);
    return hh * 60 + mm;
  }

  function clampNumber(n, min, max) {
    const x = Number(n);
    if (!Number.isFinite(x)) return null;
    return Math.min(max, Math.max(min, x));
  }

  function calcHours(signIn, signOut, breakMin) {
    const inMin = parseTimeToMinutes(signIn);
    const outMin = parseTimeToMinutes(signOut);
    const br = clampNumber(breakMin ?? 0, 0, 24 * 60) ?? 0;

    if (inMin === null || outMin === null) return null;

    let diff = outMin - inMin;
    if (diff < 0) diff += 24 * 60; // overnight

    diff -= br;
    if (diff < 0) diff = 0;

    return diff / 60;
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      return arr;
    } catch (_) {
      return [];
    }
  }

  function save(records) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  }

  function uuid() {
    return 'r_' + Math.random().toString(16).slice(2) + Date.now().toString(16);
  }

  function normalizeRecord(rec) {
    // Defensive normalization for future edits
    return {
      id: String(rec.id || uuid()),
      date: String(rec.date || ''),
      signIn: String(rec.signIn || ''),
      signOut: String(rec.signOut || ''),
      breakMin: Number.isFinite(Number(rec.breakMin)) ? Number(rec.breakMin) : 0,
      note: String(rec.note || ''),
      createdAt: Number.isFinite(Number(rec.createdAt)) ? Number(rec.createdAt) : Date.now()
    };
  }

  function status(msg, type) {
    const el = $('status');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'status' + (type ? ` ${type}` : '');
  }

  function escapeCSV(val) {
    const s = String(val ?? '');
    if (/[",\n\r]/.test(s)) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function toCSV(rows) {
    const header = ['Date', 'Sign-in', 'Sign-out', 'Break (min)', 'Hours', 'Notes'];
    const lines = [header.map(escapeCSV).join(',')];
    for (const r of rows) {
      const hrs = calcHours(r.signIn, r.signOut, r.breakMin);
      lines.push([
        r.date,
        r.signIn,
        r.signOut,
        r.breakMin,
        (hrs === null ? '' : hrs.toFixed(2)),
        r.note
      ].map(escapeCSV).join(','));
    }
    return lines.join('\n');
  }

  function download(filename, content) {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  function render(records, monthFilter) {
    const tbody = $('recordsBody');
    if (!tbody) return;

    const filtered = monthFilter
      ? records.filter(r => String(r.date || '').startsWith(monthFilter))
      : records.slice();

    // Sort by date asc, then createdAt asc
    filtered.sort((a, b) => {
      const ad = String(a.date || '');
      const bd = String(b.date || '');
      if (ad !== bd) return ad.localeCompare(bd);
      return (a.createdAt || 0) - (b.createdAt || 0);
    });

    let totalHours = 0;
    let countHours = 0;
    tbody.innerHTML = '';

    for (const r of filtered) {
      const hrs = calcHours(r.signIn, r.signOut, r.breakMin);
      if (hrs !== null) {
        totalHours += hrs;
        countHours += 1;
      }

      const tr = document.createElement('tr');

      const tdDate = document.createElement('td');
      tdDate.textContent = r.date || '—';

      const tdIn = document.createElement('td');
      tdIn.textContent = r.signIn || '—';

      const tdOut = document.createElement('td');
      tdOut.textContent = r.signOut || '—';

      const tdBreak = document.createElement('td');
      tdBreak.textContent = (Number.isFinite(Number(r.breakMin)) ? String(Number(r.breakMin)) : '0');

      const tdH = document.createElement('td');
      tdH.textContent = (hrs === null ? '—' : hrs.toFixed(2));

      const tdNote = document.createElement('td');
      tdNote.className = 'notes';
      tdNote.title = r.note || '';
      tdNote.textContent = r.note || '';

      const tdAct = document.createElement('td');
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn icon';
      del.textContent = 'Delete';
      del.addEventListener('click', () => {
        const ok = window.confirm(`Delete this record?\n\n${r.date} | ${r.signIn} - ${r.signOut}`);
        if (!ok) return;
        const all = load();
        const next = all.filter(x => String(x.id) !== String(r.id));
        save(next);
        status('Record deleted.', 'ok');
        render(next, monthFilter);
      });
      tdAct.appendChild(del);

      tr.appendChild(tdDate);
      tr.appendChild(tdIn);
      tr.appendChild(tdOut);
      tr.appendChild(tdBreak);
      tr.appendChild(tdH);
      tr.appendChild(tdNote);
      tr.appendChild(tdAct);

      tbody.appendChild(tr);
    }

    const tCount = $('tCount');
    const tHours = $('tHours');
    const tAvg = $('tAvg');

    if (tCount) tCount.textContent = String(filtered.length);
    if (tHours) tHours.textContent = totalHours.toFixed(2);
    if (tAvg) tAvg.textContent = (countHours ? (totalHours / countHours).toFixed(2) : '0.00');
  }

  function init() {
    const dateEl = $('attDate');
    const inEl = $('attIn');
    const outEl = $('attOut');
    const brEl = $('attBreak');
    const noteEl = $('attNote');
    const addEl = $('btnAdd');
    const clearEl = $('btnClear');
    const exportEl = $('btnExport');
    const resetAllEl = $('btnResetAll');
    const monthEl = $('filterMonth');

    if (dateEl) dateEl.value = nowISODate();
    if (monthEl) monthEl.value = defaultMonth();

    function currentMonth() {
      return monthEl && monthEl.value ? String(monthEl.value) : '';
    }

    function clearForm() {
      if (inEl) inEl.value = '';
      if (outEl) outEl.value = '';
      if (brEl) brEl.value = '';
      if (noteEl) noteEl.value = '';
      status('', '');
      if (inEl) inEl.focus();
    }

    function addRecord() {
      const date = dateEl ? String(dateEl.value || '').trim() : '';
      const signIn = inEl ? String(inEl.value || '').trim() : '';
      const signOut = outEl ? String(outEl.value || '').trim() : '';
      const breakMin = brEl ? String(brEl.value || '').trim() : '';
      const note = noteEl ? String(noteEl.value || '').trim() : '';

      if (!date) {
        status('Please select a date.', 'err');
        return;
      }
      if (!signIn || !signOut) {
        status('Please enter both sign-in and sign-out times.', 'err');
        return;
      }

      const hrs = calcHours(signIn, signOut, breakMin);
      if (hrs === null) {
        status('Invalid time format. Use HH:MM.', 'err');
        return;
      }

      const br = clampNumber(breakMin === '' ? 0 : breakMin, 0, 24 * 60);
      if (br === null) {
        status('Break must be a number of minutes.', 'err');
        return;
      }

      const rec = normalizeRecord({
        id: uuid(),
        date,
        signIn,
        signOut,
        breakMin: br,
        note,
        createdAt: Date.now()
      });

      const all = load().map(normalizeRecord);
      all.push(rec);
      save(all);

      status(`Saved. Calculated hours: ${hrs.toFixed(2)}.`, 'ok');
      render(all, currentMonth());
      clearForm();
    }

    if (addEl) addEl.addEventListener('click', addRecord);
    if (clearEl) clearEl.addEventListener('click', clearForm);

    if (monthEl) {
      monthEl.addEventListener('change', () => {
        render(load().map(normalizeRecord), currentMonth());
      });
    }

    if (exportEl) {
      exportEl.addEventListener('click', () => {
        const all = load().map(normalizeRecord);
        const month = currentMonth();
        const rows = month ? all.filter(r => String(r.date || '').startsWith(month)) : all;
        if (!rows.length) {
          status('No records to export for the selected month.', 'err');
          return;
        }
        const csv = toCSV(rows);
        const name = month ? `attendance-hours_${month}.csv` : 'attendance-hours.csv';
        download(name, csv);
        status('Exported CSV.', 'ok');
      });
    }

    if (resetAllEl) {
      resetAllEl.addEventListener('click', () => {
        const ok = window.confirm('Reset ALL attendance records stored in this browser? This cannot be undone.');
        if (!ok) return;
        save([]);
        status('All records cleared.', 'ok');
        render([], currentMonth());
      });
    }

    // First render
    render(load().map(normalizeRecord), currentMonth());
  }

  document.addEventListener('DOMContentLoaded', init);
})();
