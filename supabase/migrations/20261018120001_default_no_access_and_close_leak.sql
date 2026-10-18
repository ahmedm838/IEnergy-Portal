-- =====================================================================
-- New employees start with no access, and a hole in the department
-- restriction is closed.
-- =====================================================================

-- ---------------------------------------------------------------------
-- A new employee record is payroll data, not a grant of access. Someone
-- has to decide a person should be able to sign in; until then the row
-- exists and nothing can be read with it.
-- ---------------------------------------------------------------------

alter table employees alter column role set default 'no_access'::app_role;

comment on column employees.role is
  'Defaults to no_access. user = read-only within own department. admin and super_admin are granted only by a super admin.';

-- ---------------------------------------------------------------------
-- leave_balances is SECURITY DEFINER, so it reads straight past row level
-- security, and it was executable by every signed-in account. A user
-- could therefore call it with any employee id and read the leave
-- position of people in other departments -- exactly what the department
-- restriction exists to prevent.
--
-- The function is only ever used by the leave guard, which calls it from
-- inside another SECURITY DEFINER function and so keeps working: privilege
-- inside a definer function is the owner's, not the caller's. Nothing in
-- the application calls it directly.
-- ---------------------------------------------------------------------

revoke execute on function leave_balances(uuid, integer) from authenticated;
revoke execute on function leave_balances(uuid, integer) from anon;
