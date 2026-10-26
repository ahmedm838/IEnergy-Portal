-- =====================================================================
-- A super admin's employment status cannot be changed through the app.
--
-- Why it is worth a rule of its own. Status drives is_active through
-- sync_is_active, and is_active is what ensure_admin_remains counts. So
-- setting a super admin to Resigned does not just mark a leaver: it
-- takes away the account that can edit Settings, grant roles and unlock
-- periods. There is one super admin on this system today, which makes
-- the status field on that one record the single click that can lock
-- everybody out of the parts of the site only a super admin reaches.
--
-- ensure_admin_remains already refuses to leave the system with none,
-- but that only catches the last one, and it catches it as a constraint
-- error after the fact. This says no earlier and says why.
--
-- auth.uid() is null means direct database access -- the SQL editor, the
-- service role, a migration. That path stays open, deliberately and for
-- the same reason guard_super_admin_grants leaves it open: it is already
-- beyond anything a trigger could protect, and it is the way back in if
-- a super admin really does have to be retired. The rule is "not through
-- the app", not "never".
--
-- Role changes are not this trigger's business. guard_super_admin_grants
-- already governs who may hand out the role; this governs only what may
-- happen to the employment status of somebody who holds it.
-- =====================================================================

create or replace function protect_super_admin_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  -- Direct SQL: allowed, and the only way to do this.
  if auth.uid() is null then
    return new;
  end if;

  if new.status_id is distinct from old.status_id
     and 'super_admin' in (old.role::text, new.role::text) then
    raise exception
      'A super admin''s employment status cannot be changed here. It drives whether the account stays active, so it is changed in the database only.'
      using errcode = 'insufficient_privilege',
            hint = 'Move the role to admin first, or ask someone with database access.';
  end if;

  return new;
end $function$;

comment on function protect_super_admin_status() is
  'Refuses a change to a super admin''s status_id when the change arrives with a JWT, which means it came through the app. Direct SQL is unaffected.';

drop trigger if exists employees_protect_super_admin_status on employees;
create trigger employees_protect_super_admin_status
  before update of status_id, role on employees
  for each row execute function protect_super_admin_status();
