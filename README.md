# IEnergy Attendance Tracker

Attendance, leave and payroll-input tracking, built from the `Tables.xlsx`
specification. React + Vite on the front end, Supabase (PostgreSQL) behind it,
deployed to GitHub Pages by GitHub Actions.

---

## What it does

| Page | Who | Purpose |
| --- | --- | --- |
| **Dashboard** | everyone | Today's coverage, your own hours and leave balances. |
| **Attendance** | admin | The day-by-day grid from the *employee report* sheet — one row per calendar day, with bulk fills for weekly rest and workdays. |
| **Employee report** | everyone (in scope) | Day counts, late hours, transport, required vs. worked hours, leave balances, absence penalty. Exports to Excel. |
| **Monthly report** | everyone (in scope) | The payroll-input table from the *monthly report* sheet, for every payable employee. Exports to Excel. |
| **Adjustments** | admin | The *Others* sheet: incentives, bonuses, penalties, adjusted days/hours, salary adjustments and advances. |
| **Employees** | admin | Employee records, roles, payroll switches, opening leave balances. |
| **Settings** | admin | Meal rate, hours per working day, attendance-type behaviour, sites, statuses, the absence scale. |

## Access model

Three roles, enforced by PostgreSQL Row Level Security — **not** by the UI.
The browser holds only the Supabase anon key, so client-side checks are a
convenience; the policies in `supabase/03_rls.sql` are the real boundary.

- **Admin** — read and write every employee, record and lookup.
- **User** — read-only, limited to their own department (and themself).
- **No access** — nothing. Signing in succeeds but returns no rows.

## The calculations

Every formula is taken from the workbook and implemented once in SQL
(`supabase/02_functions.sql`), with a mirror in `src/lib/calc.js` used only to
show live totals while typing.

**Overtime per attendance type** — `extra_hours × 1.5 + added_hours`, a
generated column, so it can never drift from its inputs. Verified against every
row of the sheet (e.g. `جمعة 12` → `12 × 1.5 + 6 = 24`).

**Required hours** — `working days × hours_per_day` (8 by default, configurable
in Settings). A day counts as a working day when its attendance type has
`is_working_day` set. Leave, rest, holiday and absent days are excluded by
default so taking leave does not register as an hours shortage. Change this per
type in **Settings → Attendance types** if your policy differs.

**Deducted hours** — `(Penalties × 8) − (Adjusted Days × 8) − Adjusted Hours + max(0, late hours − grace)`.
Adjusted days and adjusted hours *reduce* the deduction, so this figure can be
negative, which credits the employee through Total Deductions. Lateness is
summed across the whole report period and the first `late_grace_hours`
(default 2) are forgiven; only the excess is deducted. The grace is editable
in **Settings → Payroll constants**.

**Total deductions** — `(Deducted Leaves + Absence Penalties) × 8 + Deducted Hours`.

**Absence penalty** — the progressive scale from the *Absence Rule* sheet:

| Absences in the calendar year | Cumulative deduction |
| --- | --- |
| 1 | 1.25 days |
| 2 | 2.75 days |
| 3 | 4.75 days |
| N ≥ 4 | 7.75 + (N − 4) × 3 days |

Because the scale is progressive, a payroll period is charged the **increment**
on the curve, not a fresh recount — an employee's fourth absence of the year
costs 3.00 days even if it is their first that month. The counter resets on
1 January, and only the `غياب` / Absent Day type feeds it: approved leave,
holidays and weekly rest are excluded by construction.

---

## Setup

### 1. Supabase

The schema lives in `supabase/migrations/`, applied in filename order:

```
20261014120001_schema.sql     tables, enums, indexes, triggers
20261014120002_functions.sql  reports and the calculation layer
20261014120003_rls.sql        row level security policies and grants
20261014120004_seed.sql       sites, sectors, departments, statuses, attendance types
```

With the Supabase CLI:

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

Or paste each file into the dashboard SQL Editor in that order. Each is
idempotent, so re-running one is safe.

### 2. Create the first administrator

Accounts are linked to employee records **by email address**. A trigger on
`auth.users` attaches a new account to the matching `employees` row
automatically, so the order does not matter — but the addresses must match.

1. Insert yourself as an employee with `role = 'admin'`:

   ```sql
   insert into employees (code, name, email, role, title, annual_leave_balance, unplanned_leave_balance)
   values (1, 'Your Name', 'you@ienergy.com', 'admin', 'System Administrator', 21, 7);
   ```

2. In the Supabase dashboard → **Authentication → Users → Add user**, create a
   user with that same email and a password, or send an invite.
3. Sign in. Everyone else can now be added from the **Employees** page.

> Only the first admin needs the SQL step. For everyone afterwards: add them
> under **Employees** with their email, then invite that email from the
> Supabase dashboard.

### 3. Local development

```bash
npm install
cp .env.example .env.local   # fill in your project URL and anon key
npm run dev
```

### 4. Deploy to GitHub Pages

1. In the repository: **Settings → Pages → Build and deployment → Source →
   GitHub Actions**.
2. **Settings → Secrets and variables → Actions → New repository secret**, add:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
3. Push to `main`. The workflow in `.github/workflows/deploy.yml` builds and
   publishes; it fails loudly if either secret is missing.

The anon key is a publishable key meant to ship in a browser bundle — RLS is
what protects the data. **Never** put the `service_role` key in a secret used
by this workflow; it bypasses every policy.

> GitHub Pages on a private repository requires a paid GitHub plan. On the free
> plan the repository must be public — which is fine, since no credentials live
> in the source, but do confirm you are comfortable with the code being visible.

---

## Project layout

```
.github/workflows/deploy.yml   build + publish to Pages
supabase/migrations/           SQL: schema, functions, RLS, seed
src/
  lib/
    supabase.js                client + error unwrapping
    auth.jsx                   session and employee profile
    calc.js                    client mirror of the SQL calculations
    format.js                  dates, durations, money
    useLookups.js              cached reference data
    exportXlsx.js              Excel export (lazy-loaded)
  components/                  UI primitives, layout, route guard
  pages/                       one file per screen
```

## Notes and assumptions

A few things the workbook left open, resolved as follows. Each is a one-line
change if your policy differs.

- **`is_working_day`** defaults to true only for on-shift types. This is the
  single judgement call that most affects the hours variance figure — review it
  in Settings before the first payroll run.
- **Leave balances** are reported over the calendar year containing the report's
  end date, not over the selected range, since a balance is a year-to-date
  figure.
- **Transport** is recorded on the attendance row rather than in the Adjustments
  table, so the monthly report can sum it per day as the sheet describes.
- **Added days** are earned by ticking *Add to leave balance* on a day and spent
  by recording a `بدل راحة` / Rest Day.
- The blank department row under *Supply Chain* in the sheet is not seeded.
- *Puplic Relations* is seeded with the workbook's spelling; rename it in the
  `departments` table if that was a typo.
