-- =====================================================================
-- Default access is "user"; admin must be granted deliberately.
-- =====================================================================

alter table employees alter column role set default 'user'::app_role;

comment on column employees.role is
  'Defaults to user (read-only, own department). admin is granted only by an existing admin.';

-- ---------------------------------------------------------------------
-- Never leave the system without an administrator.
--
-- Only an admin can change roles, so promotion is already gated. The real
-- risk is the opposite: the last admin demotes or deactivates themselves
-- and nobody can administer anything, including undoing it. Recovering
-- from that needs direct database access, so block it at the source.
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
  if tg_op = 'DELETE' then
    changed_id := old.id;
  else
    changed_id := new.id;
  end if;

  select count(*)
    into remaining
    from employees
   where role = 'admin'::app_role
     and is_active
     and id <> changed_id;

  -- The row being changed still counts, if it stays an active admin.
  if tg_op <> 'DELETE' and new.role = 'admin'::app_role and new.is_active then
    remaining := remaining + 1;
  end if;

  if remaining = 0 then
    raise exception
      'This would leave the system with no active administrator. Promote someone else first.'
      using errcode = 'check_violation';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;

drop trigger if exists employees_keep_admin on employees;
create trigger employees_keep_admin
  after update or delete on employees
  for each row execute function ensure_admin_remains();

-- Supports the guard's count without scanning the table.
create index if not exists employees_active_admin_idx
  on employees (role) where is_active and role = 'admin'::app_role;
