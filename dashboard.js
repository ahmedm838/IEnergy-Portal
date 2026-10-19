/* The tracker's dashboard, on the portal home page.
   - Same figures, same source: the two reporting functions the tracker
     calls, read as the signed-in account. Nothing is computed here that
     the database already works out, so the two cannot disagree.
   - What you see depends on your role, because row level security decides
     what the functions return, not this file. An admin gets the company
     counts as well as their own; everybody gets their own.
   - Loaded by the home page after sign-in. It owns no session of its own:
     it borrows the one the portal gate established. */
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

  async function render() {
    const section = document.getElementById('dashboard');
    if (!section || !window.IEnergyAuth) return;

    const me = IEnergyAuth.getProfile();
    if (!me) return;

    const supabase = await IEnergyAuth.getClient();
    const period = payrollPeriod();
    const today = iso(new Date());

    const statsEl = document.getElementById('dashStats');
    const balancesEl = document.getElementById('dashBalances');
    const periodEl = document.getElementById('dashPeriod');
    if (periodEl) periodEl.textContent = `${dmy(period.from)} to ${dmy(period.to)}`;

    /* Both calls go out together and each is allowed to fail on its own.
       An admin count that errors should not cost somebody their own
       hours, which is the half of this page that is theirs. */
    const [company, mine] = await Promise.all([
      supabase.rpc('dashboard_summary', {
        p_from: period.from, p_to: period.to, p_today: today,
      }).then((r) => (r.error ? null : r.data)).catch(() => null),
      supabase.rpc('report_employee_summary', {
        p_employee_id: me.id, p_from: period.from, p_to: period.to,
      }).then((r) => (r.error ? null : r.data)).catch(() => null),
    ]);

    statsEl.innerHTML = '';

    if (mine) {
      const variance = Number(mine.hours_variance);
      statsEl.appendChild(stat(
        'Your hours this period',
        num(mine.worked_hours),
        `${num(mine.required_hours)} h required`,
        variance < 0 ? 'bad' : 'good',
      ));
      statsEl.appendChild(stat(
        'Excess / shortage',
        `${variance >= 0 ? '+' : ''}${num(variance)} h`,
        `${mine.working_days} working days`,
        variance < 0 ? 'bad' : 'good',
      ));
      statsEl.appendChild(stat('Overtime hours', num(mine.overtime_hours)));
      statsEl.appendChild(stat(
        'Absence penalty',
        `${num(mine.absence_penalty)} days`,
        `${mine.absence_days} unauthorised`,
        Number(mine.absence_penalty) > 0 ? 'bad' : '',
      ));
    }

    // Only an administrator's account can read these; for anybody else
    // the function returns nothing and the tiles simply are not there.
    if (company) {
      statsEl.appendChild(stat('Employees', num(company.employees, 0), 'on the payroll'));
      statsEl.appendChild(stat('Recorded today', num(company.recorded_today, 0), dmy(today)));
      statsEl.appendChild(stat(
        'Not recorded today',
        num(company.missing_count, 0),
        'employees with no entry',
        Number(company.missing_count) > 0 ? 'warn' : 'good',
      ));
    }

    balancesEl.innerHTML = '';
    if (mine && Array.isArray(mine.balances)) {
      const table = document.createElement('table');
      table.className = 'dash-table';
      table.innerHTML =
        '<thead><tr><th></th><th>Balance</th><th>Consumed</th><th>Remaining</th></tr></thead>';
      const body = document.createElement('tbody');

      for (const b of mine.balances) {
        const tr = document.createElement('tr');
        const remaining = Number(b.remaining);
        tr.innerHTML =
          `<td>${b.label}</td><td>${num(b.balance, 1)}</td>` +
          `<td>${num(b.consumed, 1)}</td>` +
          `<td class="${remaining < 0 ? 'bad' : 'good'}">${num(remaining, 1)}</td>`;
        body.appendChild(tr);
      }

      // The leave days none of the three rows above account for.
      const other = document.createElement('tr');
      const types = (mine.other_leave_types ?? []).map((t) => `${t.name_en} ${t.days}`).join(' · ');
      other.innerHTML =
        `<td>Other leaves <span class="dash-note">${types || 'sick, deducted, granted'}</span></td>` +
        `<td class="muted">—</td><td>${num(mine.other_leaves, 1)}</td><td class="muted">—</td>`;
      body.appendChild(other);

      table.appendChild(body);

      /* The totals.
         Consumed includes the other leaves, because those days were
         taken. Balance and remaining do not: there is no entitlement
         behind a sick or deducted day to add up, and quietly folding a
         dash into a sum would make the row stop adding up. */
      const totals = document.createElement('tfoot');
      const sum = (key) => mine.balances.reduce((acc, b) => acc + Number(b[key] || 0), 0);
      const consumed = sum('consumed') + Number(mine.other_leaves || 0);
      const foot = document.createElement('tr');
      foot.className = 'dash-total-row';
      foot.innerHTML =
        '<td>Total</td>' +
        `<td>${num(sum('balance'), 1)}</td>` +
        `<td>${num(consumed, 1)}</td>` +
        `<td class="${sum('remaining') < 0 ? 'bad' : 'good'}">${num(sum('remaining'), 1)}</td>`;
      totals.appendChild(foot);
      table.appendChild(totals);
      balancesEl.appendChild(table);

      const note = document.createElement('p');
      note.className = 'dash-note-line';
      note.textContent =
        `Calendar year ${dmy(mine.leave_year.from)} to ${dmy(mine.leave_year.to)}.`;
      balancesEl.appendChild(note);
    }

    if (statsEl.children.length || balancesEl.children.length) section.hidden = false;
  }

  window.IEnergyDashboard = { render };
})();
