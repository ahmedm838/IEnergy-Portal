-- =====================================================================
-- IEnergy Attendance Tracker — Row Level Security
--
-- Access model (as specified):
--   admin      : read + write every employee, every record, every lookup
--   user       : READ-ONLY, limited to their own department (plus themself)
--   no_access  : nothing, enforced here and not merely hidden in the UI
--
-- The browser holds the Supabase anon key, so the UI is not a security
-- boundary. Everything below is enforced by Postgres.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Identity helpers.
--
-- These are SECURITY DEFINER on purpose: a policy on `employees` that
-- itself queries `employees` would recurse infinitely. Each is pinned to
-- a fixed search_path and reads only the caller's own row.
-- ---------------------------------------------------------------------

create or replace function my_employee_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$ select id from employees where auth_user_id = auth.uid() limit 1; $$;

create or replace function my_role()
returns app_role
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role from employees
      where auth_user_id = auth.uid() and is_active limit 1),
    'no_access'::app_role);
$$;

create or replace function my_department_id()
returns smallint
language sql
stable
security definer
set search_path = public
as $$ select department_id from employees where auth_user_id = auth.uid() limit 1; $$;

create or replace function is_admin()
returns boolean
language sql stable
as $$ select my_role() = 'admin'::app_role; $$;

-- Is a given employee inside the caller's visibility scope?
create or replace function can_see_employee(p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case my_role()
    when 'admin' then true
    when 'user'  then exists (
        select 1 from employees e
         where e.id = p_employee_id
           and (e.id = my_employee_id()
                or (my_department_id() is not null
                    and e.department_id = my_department_id()))
      )
    else false
  end;
$$;

-- ---------------------------------------------------------------------
-- Enable RLS everywhere. No table is left open.
-- ---------------------------------------------------------------------

alter table sites               enable row level security;
alter table sectors             enable row level security;
alter table departments         enable row level security;
alter table employee_statuses   enable row level security;
alter table attendance_types    enable row level security;
alter table app_settings        enable row level security;
alter table employees           enable row level security;
alter table attendance_records  enable row level security;
alter table adjustments         enable row level security;

-- ---------------------------------------------------------------------
-- Lookup tables: readable by any signed-in user who is not 'no_access',
-- writable only by admins.
-- ---------------------------------------------------------------------

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'sites', 'sectors', 'departments', 'employee_statuses',
    'attendance_types', 'app_settings'
  ] loop
    execute format('drop policy if exists %I on %I', tbl || '_read',  tbl);
    execute format('drop policy if exists %I on %I', tbl || '_write', tbl);

    execute format($f$
      create policy %I on %I
        for select to authenticated
        using (my_role() <> 'no_access'::app_role)
    $f$, tbl || '_read', tbl);

    execute format($f$
      create policy %I on %I
        for all to authenticated
        using (is_admin()) with check (is_admin())
    $f$, tbl || '_write', tbl);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Employees
-- ---------------------------------------------------------------------

drop policy if exists employees_read  on employees;
drop policy if exists employees_write on employees;

create policy employees_read on employees
  for select to authenticated
  using (
    is_admin()
    or (
      my_role() = 'user'::app_role
      and (
        auth_user_id = auth.uid()
        or (my_department_id() is not null and department_id = my_department_id())
      )
    )
  );

create policy employees_write on employees
  for all to authenticated
  using (is_admin())
  with check (is_admin());

-- ---------------------------------------------------------------------
-- Attendance records
-- ---------------------------------------------------------------------

drop policy if exists attendance_read  on attendance_records;
drop policy if exists attendance_write on attendance_records;

create policy attendance_read on attendance_records
  for select to authenticated
  using (can_see_employee(employee_id));

create policy attendance_write on attendance_records
  for all to authenticated
  using (is_admin())
  with check (is_admin());

-- ---------------------------------------------------------------------
-- Adjustments ("Others" sheet) — salary figures, same scope rules.
-- ---------------------------------------------------------------------

drop policy if exists adjustments_read  on adjustments;
drop policy if exists adjustments_write on adjustments;

create policy adjustments_read on adjustments
  for select to authenticated
  using (can_see_employee(employee_id));

create policy adjustments_write on adjustments
  for all to authenticated
  using (is_admin())
  with check (is_admin());

-- ---------------------------------------------------------------------
-- Grants. RLS does the filtering; these just open the door to the role.
-- ---------------------------------------------------------------------

grant usage on schema public to authenticated;

grant select on sites, sectors, departments, employee_statuses,
                attendance_types, app_settings to authenticated;
grant insert, update, delete on sites, sectors, departments,
                employee_statuses, attendance_types, app_settings to authenticated;

grant select, insert, update, delete
  on employees, attendance_records, adjustments to authenticated;

grant usage, select on all sequences in schema public to authenticated;

grant execute on function
  my_employee_id(), my_role(), my_department_id(), is_admin(),
  can_see_employee(uuid),
  absence_deduction(integer), absence_count(uuid, date, date),
  absence_penalty_days(uuid, date, date),
  worked_hours(time, time), avg_time_text(interval),
  required_hours_per_day(), setting_numeric(text, numeric),
  report_employee_summary(uuid, date, date),
  report_monthly(date, date, numeric, smallint),
  save_attendance_rows(jsonb)
to authenticated;

-- The anon role gets nothing at all: every page requires a session.
revoke all on all tables in schema public from anon;
