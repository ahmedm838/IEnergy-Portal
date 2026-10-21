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

  async function render() {
    const section = document.getElementById('dashboard');
    if (!section || !window.IEnergyAuth) return;

    const me = IEnergyAuth.getProfile();
    if (!me) return;

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
    const mine = await supabase.rpc('report_employee_summary', {
      p_employee_id: me.id, p_from: period.from, p_to: period.to,
    }).then((r) => (r.error ? null : r.data)).catch(() => null);
    if (sequence !== renderSequence) return;

    statsEl.innerHTML = '';
    if (mine) {
      const variance = mine.hours_variance == null ? NaN : Number(mine.hours_variance);
      statsEl.appendChild(stat('Records', num(recordedDays(mine), 0), 'saved days in this period'));
      statsEl.appendChild(stat('Weekends', num(weekendDays(mine), 0)));
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
      /* The leave year goes in the header's empty first cell rather than
         in a line under the table. It says which year the three columns
         beside it are counting, so it belongs level with them and at the
         same left edge as the leave names below it -- read before the
         numbers instead of after them. */
      const year = mine.leave_year
        ? 'Calendar year ' + dmy(mine.leave_year.from) + ' to ' + dmy(mine.leave_year.to)
        : '';
      table.innerHTML =
        '<thead><tr><th class="dash-year">' + year + '</th>' +
        '<th>Balance</th><th>Consumed</th><th>Remaining</th></tr></thead>';
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

    }

    if (statsEl.children.length || balancesEl.children.length) section.hidden = false;
  }

  window.IEnergyDashboard = { render };
})();
