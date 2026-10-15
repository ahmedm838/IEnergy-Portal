-- =====================================================================
-- Link employees and auth accounts in BOTH directions.
--
-- 01_schema installed a trigger on auth.users that attaches a new account
-- to an existing employee row by email. That only covers one order of
-- events. When the account is created first -- which is exactly what
-- happens when bootstrapping the first administrator from the dashboard --
-- nothing links them, and the employee signs in to a working session with
-- no profile, which surfaces as a confusing "not linked" message.
--
-- This adds the reverse: inserting an employee row, or setting its email,
-- adopts a matching auth account if one already exists.
-- =====================================================================

create or replace function link_employee_to_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.auth_user_id is null and new.email is not null then
    select u.id
      into new.auth_user_id
      from auth.users u
     where lower(u.email) = lower(new.email)
     limit 1;
  end if;
  return new;
end $$;

drop trigger if exists employees_link_auth on employees;
create trigger employees_link_auth
  before insert or update of email on employees
  for each row execute function link_employee_to_auth_user();

grant execute on function link_employee_to_auth_user() to authenticated;

-- Back-fill anything already out of step.
update employees e
   set auth_user_id = u.id
  from auth.users u
 where e.auth_user_id is null
   and e.email is not null
   and lower(u.email) = lower(e.email);
