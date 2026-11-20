/* Personal dashboard figures from the tracker summary, using the signed-in
   employee and the selected payroll period. Database row-level security applies. */
(function () {
  'use strict';

  // Payroll periods run 21st to 20th and are named after the month they
  // END in, which is how payroll talks about them. Kept in step with
  // PAYROLL_CYCLE_START_DAY in the tracker's format.js.
  const CYCLE_START_DAY = 21;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const iso = (d) => {
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
  };

  function payrollPeriod(date = new Date()) {
    const year = date.getFullYear();
    const month = date.getMonth() + (date.getDate() >= CYCLE_START_DAY ? 1 : 0);
    return {
      from: iso(new Date(year, month - 1, CYCLE_START_DAY)),
      to: iso(new Date(year, month, CYCLE_START_DAY - 1)),
    };
  }

  let selectedPeriod = payrollPeriod();
  let renderSequence = 0;
  let controlsBound = false;

  /* Kept for a few minutes, in this tab, so going back to the home page
     or stepping to a period already seen costs no request. The free
     database plan counts every byte sent, and these figures only move
     when somebody saves attendance. A reload after five minutes, or a
     new tab, asks again. */
  const CACHE_MS = 5 * 60 * 1000;
  function cacheGet(key) {
    try {
      const hit = JSON.parse(sessionStorage.getItem(key));
      if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
    } catch (_) { /* no storage: fetch every time */ }
    return null;
  }
  function cachePut(key, data) {
    try { sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), data })); } catch (_) {}
  }

  /* Which days the leave balances are made of, asked for only when a
     row is opened, once per calendar year. */
  async function leaveDays(supabase, employeeId, to) {
    const key = `ienergy-dash-days:${employeeId}:${to.slice(0, 4)}`;
    const cached = cacheGet(key);
    if (cached) return cached;
    const { data, error } = await supabase.rpc('report_employee_leave_days', {
      p_employee_id: employeeId, p_to: to,
    });
    if (error) throw error;
    cachePut(key, data || []);
    return data || [];
  }

  function shiftPeriod(delta) {
    const [year, month] = selectedPeriod.to.split('-').map(Number);
    selectedPeriod = payrollPeriod(new Date(year, month - 1 + delta, 20));
    return render();
  }

  function recordedDays(summary) {
    if (!Array.isArray(summary.day_counts)) return null;
    return summary.day_counts.reduce((sum, row) => sum + Number(row.days || 0), 0);
  }

  function weekendDays(summary) {
    if (!Array.isArray(summary.day_counts)) return null;
    return summary.day_counts
      .filter((row) => row.type_code === 'weekly_rest')
      .reduce((sum, row) => sum + Number(row.days || 0), 0);
  }

  function notAttendedDays(summary) {
    const recorded = recordedDays(summary);
    if (recorded === null || summary.working_days == null) return null;
    const weekends = weekendDays(summary);
    return Math.max(0, recorded - Number(summary.working_days) - weekends);
  }

  const dmy = (value) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ''));
    return m ? `${m[3]}-${MONTHS[Number(m[2]) - 1]}-${m[1]}` : '';
  };

  /* Null is not zero. Number(null) is 0, which would print a missing
     figure as 0.00 -- "you worked no hours" rather than "we do not
     know" -- so the empty cases are turned away before the conversion. */
  const num = (value, places = 2) => {
    if (value === null || value === undefined || value === '') return '—';
    const n = Number(value);
    return Number.isFinite(n)
      ? n.toLocaleString('en-US', { minimumFractionDigits: places, maximumFractionDigits: places })
      : '—';
  };

  function stat(label, value, sub, tone) {
    const cell = document.createElement('div');
    cell.className = 'dash-stat';
    const l = document.createElement('div');
    l.className = 'dash-stat-label';
    l.textContent = label;
    const v = document.createElement('div');
    v.className = `dash-stat-value${tone ? ' ' + tone : ''}`;
    v.textContent = value;
    cell.appendChild(l);
    cell.appendChild(v);
    if (sub) {
      const s = document.createElement('div');
      s.className = 'dash-stat-sub';
      s.textContent = sub;
      cell.appendChild(s);
    }
    return cell;
  }

  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function dayLabel(value) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ''));
    if (!m) return '';
    const wd = WEEKDAYS[new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()];
    return `${wd} ${dmy(value)}`;
  }

  /* The days behind a balance row, shown in a pop-up over the page.
     One pop-up at a time; Escape, the close button or a click on the
     dimmed backdrop closes it and gives focus back to the row. */
  let openPopup = null;
  function closeDays() {
    if (!openPopup) return;
    const { overlay, opener, onKey } = openPopup;
    openPopup = null;
    document.removeEventListener('keydown', onKey);
    overlay.remove();
    document.body.classList.remove('dash-popup-open');
    if (opener && opener.isConnected) opener.focus();
  }

  async function showDays(label, btn, pick, supabase, employeeId, to) {
    closeDays();
    const overlay = document.createElement('div');
    overlay.className = 'dash-popup';
    const card = document.createElement('div');
    card.className = 'dash-popup-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-labelledby', 'dashPopupTitle');

    const head = document.createElement('div');
    head.className = 'dash-popup-head';
    const h = document.createElement('h3');
    h.id = 'dashPopupTitle';
    h.textContent = label;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'dash-popup-close';
    close.setAttribute('aria-label', 'Close');
    close.textContent = '×';
    close.addEventListener('click', closeDays);
    head.appendChild(h);
    head.appendChild(close);

    const body = document.createElement('div');
    body.className = 'dash-popup-body';
    body.textContent = 'Loading days…';
    card.appendChild(head);
    card.appendChild(body);
    overlay.appendChild(card);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeDays(); });

    const onKey = (e) => { if (e.key === 'Escape') closeDays(); };
    document.addEventListener('keydown', onKey);
    const mine = { overlay, opener: btn, onKey };
    openPopup = mine;
    document.body.appendChild(overlay);
    document.body.classList.add('dash-popup-open');
    close.focus();

    let days;
    try {
      days = await leaveDays(supabase, employeeId, to);
    } catch (_) {
      if (openPopup === mine) body.textContent = 'Could not load the days. Please try again.';
      return;
    }
    if (openPopup !== mine) return;
    body.textContent = '';
    const groups = pick(days);
    let total = 0;
    for (const [title, list] of groups) {
      total += list.length;
      const block = document.createElement('div');
      block.className = 'dash-days';
      if (title) {
        const t = document.createElement('div');
        t.className = 'dash-days-title';
        t.textContent = `${title} (${list.length})`;
        block.appendChild(t);
      }
      if (!list.length) {
        const none = document.createElement('span');
        none.className = 'dash-days-none';
        none.textContent = 'No days this year.';
        block.appendChild(none);
      }
      for (const d of list) {
        const chip = document.createElement('span');
        chip.className = 'dash-day';
        chip.textContent = dayLabel(d.d);
        // Under "Other leaves" each day says what it was.
        if (d.n && groups.length === 1 && !title && new Set(list.map((x) => x.n)).size > 1) {
          chip.textContent += ` · ${d.n}`;
        }
        block.appendChild(chip);
      }
      body.appendChild(block);
    }
    if (groups.length === 1) h.textContent = `${label} (${total})`;
  }

  async function render() {
    const section = document.getElementById('dashboard');
    if (!section || !window.IEnergyAuth) return;

    const me = IEnergyAuth.getProfile();
    if (!me) return;

    closeDays();
    const sequence = ++renderSequence;
    const period = { ...selectedPeriod };
    if (!controlsBound) {
      document.getElementById('dashPrevious').addEventListener('click', () => shiftPeriod(-1));
      document.getElementById('dashNext').addEventListener('click', () => shiftPeriod(1));
      controlsBound = true;
    }
    const supabase = await IEnergyAuth.getClient();
    if (sequence !== renderSequence) return;

    const statsEl = document.getElementById('dashStats');
    const balancesEl = document.getElementById('dashBalances');
    const periodEl = document.getElementById('dashPeriod');
    if (periodEl) periodEl.textContent = `${dmy(period.from)} to ${dmy(period.to)}`;

    section.hidden = false;
    statsEl.textContent = 'Loading period…';
    balancesEl.innerHTML = '';
    const summaryKey = `ienergy-dash:${me.id}:${period.from}`;
    let mine = cacheGet(summaryKey);
    if (!mine) {
      mine = await supabase.rpc('report_employee_summary', {
        p_employee_id: me.id, p_from: period.from, p_to: period.to,
      }).then((r) => (r.error ? null : r.data)).catch(() => null);
      if (mine) cachePut(summaryKey, mine);
    }
    if (sequence !== renderSequence) return;

    statsEl.innerHTML = '';
    if (mine) {
      const variance = mine.hours_variance == null ? NaN : Number(mine.hours_variance);
      statsEl.appendChild(stat('Recorded days', num(recordedDays(mine), 0), 'saved days in this period'));
      statsEl.appendChild(stat('Weekend days', num(weekendDays(mine), 0)));
      statsEl.appendChild(stat('Attended days', num(mine.working_days, 0)));
      statsEl.appendChild(stat('Not attended days', num(notAttendedDays(mine), 0)));
      statsEl.appendChild(stat('Absence days', num(mine.absence_days, 0), '', Number(mine.absence_days) > 0 ? 'bad' : ''));
      statsEl.appendChild(stat(
        'Hours this period', num(mine.worked_hours),
        `${num(mine.required_hours)} h required`,
        Number.isFinite(variance) ? (variance < 0 ? 'bad' : 'good') : '',
      ));
      statsEl.appendChild(stat(
        'Excess / shortage',
        Number.isFinite(variance) ? `${variance >= 0 ? '+' : ''}${num(variance)} h` : '—',
        `${num(mine.working_days, 0)} working days`,
        Number.isFinite(variance) ? (variance < 0 ? 'bad' : 'good') : '',
      ));
      statsEl.appendChild(stat('Overtime hours', num(mine.overtime_hours)));
    } else {
      statsEl.textContent = 'Could not load this period. Please refresh or choose another period.';
    }

    balancesEl.innerHTML = '';
    if (mine && Array.isArray(mine.balances)) {
      const table = document.createElement('table');
      table.className = 'dash-table';
      table.innerHTML =
        '<thead><tr><th></th>' +
        '<th>Balance</th><th>Consumed</th><th>Remaining</th></tr></thead>';
      const body = document.createElement('tbody');

      const opener = (tr, label, pick) => {
        const cell = tr.firstElementChild;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'dash-days-toggle';
        btn.setAttribute('aria-haspopup', 'dialog');
        btn.title = 'Show the days';
        btn.textContent = label;
        cell.textContent = '';
        cell.appendChild(btn);
        btn.addEventListener('click', () => showDays(label, btn, pick, supabase, me.id, period.to));
      };
      const KIND = ['annual', 'unplanned', null];

      for (const [i, b] of mine.balances.entries()) {
        const tr = document.createElement('tr');
        const remaining = Number(b.remaining);
        tr.innerHTML =
          `<td>${b.label}</td><td>${num(b.balance, 1)}</td>` +
          `<td>${num(b.consumed, 1)}</td>` +
          `<td class="${remaining < 0 ? 'bad' : 'good'}">${num(remaining, 1)}</td>`;
        // The third row is the added days: earned and taken are both lists.
        const kind = KIND[i] ?? null;
        if (kind) opener(tr, b.label, (d) => [[null, d.filter((x) => x.k === kind)]]);
        else opener(tr, b.label, (d) => [
          ['Earned', d.filter((x) => x.k === 'added')],
          ['Taken', d.filter((x) => x.k === 'added_used')],
        ]);
        body.appendChild(tr);
      }

      /* Total, directly under the three rows it adds up.

         It sums the entitlements and nothing else -- annual, un-planned
         and added days -- so each figure is the column above it added
         together and can be checked by eye. The other leaves sit below
         it precisely because they do not belong in it: there is no
         entitlement behind a sick or a deducted day, so folding them in
         here would leave Balance and Remaining not matching the rows
         they claim to total. */
      const sum = (key) => mine.balances.reduce((acc, b) => acc + Number(b[key] || 0), 0);
      const total = document.createElement('tr');
      total.className = 'dash-total-row';
      total.innerHTML =
        '<td>Total</td>' +
        `<td>${num(sum('balance'), 1)}</td>` +
        `<td>${num(sum('consumed'), 1)}</td>` +
        `<td class="${sum('remaining') < 0 ? 'bad' : 'good'}">${num(sum('remaining'), 1)}</td>`;
      body.appendChild(total);

      // The leave days none of the three rows above account for.
      const other = document.createElement('tr');
      other.innerHTML =
        '<td>Other leaves</td>' +
        `<td class="muted">—</td><td>${num(mine.other_leaves, 1)}</td><td class="muted">—</td>`;
      opener(other, 'Other leaves', (d) => [[null, d.filter((x) => x.k === 'other')]]);
      body.appendChild(other);

      /* What those days were, each with its count in the Consumed
         column rather than written into its label. They line up under
         the figure they make up, so Other leaves above reads as their
         sum instead of as a number with a list beside it. */
      for (const t of mine.other_leave_types ?? []) {
        const row = document.createElement('tr');
        row.className = 'dash-note-row';
        row.innerHTML =
          `<td>${t.name_en}</td>` +
          '<td class="muted">—</td>' +
          `<td>${num(t.days, 1)}</td>` +
          '<td class="muted">—</td>';
        opener(row, t.name_en, (d) => [[null, d.filter((x) => x.k === 'other' && x.n === t.name_en)]]);
        body.appendChild(row);
      }

      table.appendChild(body);

      /* Grand Total: the whole table, entitlements and other leaves.

         Only Consumed gains anything, because those days were taken and
         they count. Balance and Remaining are the Total row's figures
         again -- no entitlement was added to change them -- and they are
         repeated rather than dashed so the row reads as a total of
         everything above it rather than of one column. */
      const grand = document.createElement('tfoot');
      const consumed = sum('consumed') + Number(mine.other_leaves || 0);
      const foot = document.createElement('tr');
      foot.className = 'dash-total-row';
      foot.innerHTML =
        '<td>Grand Total</td>' +
        `<td>${num(sum('balance'), 1)}</td>` +
        `<td>${num(consumed, 1)}</td>` +
        `<td class="${sum('remaining') < 0 ? 'bad' : 'good'}">${num(sum('remaining'), 1)}</td>`;
      grand.appendChild(foot);
      table.appendChild(grand);
      balancesEl.appendChild(table);

    }

    if (statsEl.children.length || balancesEl.children.length) section.hidden = false;
  }

  window.IEnergyDashboard = { render };
})();
