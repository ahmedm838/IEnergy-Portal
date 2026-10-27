-- =====================================================================
-- A 'user' sees their sector, not just their department.
--
-- The original rule, written in 20261014120003_rls.sql, gave a read-only
-- user their own record plus everybody in their own department. This
-- widens that one step up the tree: their own record plus everybody in
-- any department of their sector.
--
-- Departments sit under sectors -- departments.sector_id is NOT NULL, so
-- every department has exactly one -- and the step is a real widening.
-- Operations alone holds seven departments (Production, Quality,
-- Engineering, Human Resources, HSE, Transportation, Maintenance), so
-- somebody in HR goes from one department to all seven.
--
-- WHAT THIS OPENS UP. can_see_employee() is not only the employee list.
-- It is also the read policy on attendance_records and on adjustments,
-- and adjustments carries money: incentive, bonus, penalties, salary
-- adjustment and salary advance. Widening the helper widens all three
-- together, which is what was asked for -- a user will see pay figures
-- for their whole sector, not only their department. The reports follow
-- on their own: report_employee_summary and the dashboard views run as
-- the caller, so they read exactly what these policies allow.
--
-- WHAT THIS DOES NOT CHANGE.
--   * admin and super_admin already saw everything; is_admin() covers
--     both and is untouched.
--   * no_access still sees nothing.
--   * Writing is unchanged. A user has never been able to write, and
--     the write policies here still say is_admin().
--   * Your own record is visible whatever happens to your department,
--     which is why the auth_user_id test stays first.
--
-- A user whose own department_id is null has no sector, so they see
-- themself and nobody else -- the same as before, for the same reason.
-- An employee whose department_id is null is in no sector and so is
-- visible to admins and to themself only, which was already true.
-- =====================================================================

-- ---------------------------------------------------------------------
-- The caller's sector, through their department.
--
-- SECURITY DEFINER for the same reason every helper in the original file
-- is: a policy on employees that reads employees would recurse. It also
-- has to read departments, which carries RLS of its own; running as the
-- definer keeps one table's policy from deciding another table's.
-- ---------------------------------------------------------------------
create or replace function my_sector_id()
returns smallint
language sql
stable
security definer
set search_path = public
as $$
  select d.sector_id
    from employees e
    join departments d on d.id = e.department_id
   where e.auth_user_id = auth.uid()
   limit 1;
$$;

comment on function my_sector_id() is
  'The sector of the signed-in employee''s department, or null if they have no department.';

-- ---------------------------------------------------------------------
-- Every department in the caller's sector.
--
-- Returned as an array and compared with = any(...) rather than joined
-- per row: it is one evaluation for the whole query instead of a lookup
-- for each employee tested, and it keeps departments' own read policy
-- out of a policy on employees.
--
-- Empty array, never null, when the caller has no sector -- so the
-- comparison is simply false rather than null, and the caller falls back
-- to their own record.
-- ---------------------------------------------------------------------
create or replace function my_sector_departments()
returns smallint[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(d.id), '{}'::smallint[])
    from departments d
   where d.sector_id = my_sector_id();
$$;

comment on function my_sector_departments() is
  'Department ids in the signed-in employee''s sector; empty when they have none.';

-- ---------------------------------------------------------------------
-- The shared scope test: employees, attendance_records, adjustments.
--
-- Same shape as before, with the sector in place of the department, and
-- one branch that is new for a reason worth writing down.
--
-- THE super_admin BRANCH. This function was written in
-- 20261014120003_rls.sql, before the role existed, and has never been
-- replaced since -- grep the migrations: it is defined once. Its CASE
-- reads 'admin', 'user', else false, so a caller whose role is
-- 'super_admin' falls through to false. is_admin() was taught about the
-- role in 20261015160002; this CASE never was, because it tests my_role()
-- directly instead of calling is_admin().
--
-- On the migration history as written, that means a super admin can read
-- no attendance record and no adjustment at all -- those two policies are
-- nothing but can_see_employee(). Either the live database no longer
-- matches these files, or that account has been hitting it. Worth
-- checking which before this is applied, because `create or replace`
-- below overwrites whatever is actually there.
--
-- Either way the branch belongs here. Leaving the CASE as it was would
-- knowingly ship the gap, and a super admin is defined as "everything an
-- admin can do, plus Settings".
-- ---------------------------------------------------------------------
create or replace function can_see_employee(p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case my_role()
    when 'admin' then true
    when 'super_admin' then true
    when 'user'  then exists (
        select 1 from employees e
         where e.id = p_employee_id
           and (e.id = my_employee_id()
                or e.department_id = any (my_sector_departments()))
      )
    else false
  end;
$$;

comment on function can_see_employee(uuid) is
  'Is this employee inside the caller''s scope? Admins: everyone. A user: themself and their sector.';

-- ---------------------------------------------------------------------
-- The employees list itself.
-- ---------------------------------------------------------------------
drop policy if exists employees_read on employees;

create policy employees_read on employees
  for select to authenticated
  using (
    is_admin()
    or (
      my_role() = 'user'::app_role
      and (
        auth_user_id = auth.uid()
        or department_id = any (my_sector_departments())
      )
    )
  );

grant execute on function my_sector_id(), my_sector_departments() to authenticated;

-- ---------------------------------------------------------------------
-- department_id is now a filter on the hottest read path in the app --
-- every employee row read tests it -- and it had no index. Added on the
-- same reasoning as the other foreign keys in 20261018170002: it changes
-- nothing measurable at today's size, where a sequential scan of a few
-- hundred rows wins, and it stops the test degrading as the table fills.
-- ---------------------------------------------------------------------
create index if not exists employees_department_idx on employees (department_id);

-- ---------------------------------------------------------------------
-- my_department_id() is left in place. Nothing references it now, but it
-- is granted to authenticated and dropping a granted function is a wider
-- change than this one needs to be. It still returns what it says.
-- ---------------------------------------------------------------------
