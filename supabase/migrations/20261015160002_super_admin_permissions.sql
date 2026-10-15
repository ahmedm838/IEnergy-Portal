-- =====================================================================
-- Super admin: the only role that may change reference data.
--
--   super_admin : everything an admin can do, plus editing Settings
--   admin       : employees, attendance and adjustments; Settings read-only
--   user        : read-only within their department; no Settings at all
--   no_access   : nothing
-- =====================================================================

-- ---------------------------------------------------------------------
-- Role helpers. is_admin() now means "admin level or above", so every
-- existing admin-gated policy keeps working for super admins without
-- having to be rewritten.
-- ---------------------------------------------------------------------

create or replace function is_super_admin()
returns boolean
language sql stable
as $$ select my_role() = 'super_admin'::app_role; $$;

create or replace function is_admin()
returns boolean
language sql stable
as $$ select my_role() in ('admin'::app_role, 'super_admin'::app_role); $$;

grant execute on function is_super_admin() to authenticated;

-- ---------------------------------------------------------------------
-- Promote one existing admin, otherwise nobody could edit Settings after
-- this migration. The lowest-numbered active admin is the bootstrap
-- account created at install.
-- ---------------------------------------------------------------------

-- The current guard demands an active 'admin' remain; promoting the only
-- one would trip it, so it comes off first and goes back on below.
drop trigger if exists employees_keep_admin on employees;

update employees
   set role = 'super_admin'::app_role
 where id = (
   select id from employees
    where role = 'admin'::app_role and is_active
    order by code
    limit 1
 );

-- ---------------------------------------------------------------------
-- Never leave the system without a super admin.
--
-- Only a super admin can edit reference data or grant the role, so losing
-- the last one is unrecoverable through the app -- it would need direct
-- database access to undo.
-- ---------------------------------------------------------------------

create or replace function ensure_admin_remains()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  changed_id uuid;
  remaining  integer;
begin
  if tg_op = 'DELETE' then changed_id := old.id; else changed_id := new.id; end if;

  select count(*)
    into remaining
    from employees
   where role = 'super_admin'::app_role
     and is_active
     and id <> changed_id;

  if tg_op <> 'DELETE' and new.role = 'super_admin'::app_role and new.is_active then
    remaining := remaining + 1;
  end if;

  if remaining = 0 then
    raise exception
      'This would leave the system with no active super admin. Promote someone else first.'
      using errcode = 'check_violation';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

create trigger employees_keep_admin
  after update or delete on employees
  for each row execute function ensure_admin_remains();

create index if not exists employees_active_super_admin_idx
  on employees (role) where is_active and role = 'super_admin'::app_role;

-- ---------------------------------------------------------------------
-- Stop an admin promoting themselves.
--
-- Admins can write the employees table -- that is how they manage staff --
-- so without this an admin could simply set their own role to super_admin
-- and award themselves the permissions this whole change exists to
-- withhold.
-- ---------------------------------------------------------------------

create or replace function guard_super_admin_grants()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- No JWT means direct database access (SQL editor, service role), which
  -- is already beyond anything this guard could protect. Leaving that path
  -- open is also the only way back in if the last super admin is lost.
  if auth.uid() is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.role = 'super_admin'::app_role and not is_super_admin() then
      raise exception 'Only a super admin can grant the super admin role'
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  if new.role is distinct from old.role
     and (new.role = 'super_admin'::app_role or old.role = 'super_admin'::app_role)
     and not is_super_admin() then
    raise exception 'Only a super admin can grant or remove the super admin role'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end $$;

drop trigger if exists employees_guard_super_admin on employees;
create trigger employees_guard_super_admin
  before insert or update on employees
  for each row execute function guard_super_admin_grants();

-- ---------------------------------------------------------------------
-- Reference data: readable by anyone signed in (the attendance grid and
-- every report need these labels), writable only by a super admin.
-- ---------------------------------------------------------------------

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'sites', 'sectors', 'departments', 'employee_statuses',
    'attendance_types', 'app_settings'
  ] loop
    execute format('drop policy if exists %I on %I', tbl || '_write', tbl);
    execute format($f$
      create policy %I on %I
        for all to authenticated
        using (is_super_admin()) with check (is_super_admin())
    $f$, tbl || '_write', tbl);
  end loop;
end $$;
