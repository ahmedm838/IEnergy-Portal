-- =====================================================================
-- Keep the login address in step with the employee record.
--
-- username is a generated column over employees.email, so renaming an
-- employee's address changes their username immediately. The account they
-- actually sign in with lives in auth.users, and that was left behind --
-- so after a rename the username on screen no longer resolved to a real
-- login and the employee was locked out, with nothing on the page to say
-- why.
-- =====================================================================

create or replace function sync_auth_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Nothing to keep in step until the employee has a login.
  if new.auth_user_id is null or new.email is null then
    return new;
  end if;

  if lower(btrim(coalesce(old.email, ''))) = lower(btrim(new.email)) then
    return new;
  end if;

  -- Written straight to auth.users rather than going through the email
  -- change flow: this is an administrator correcting a record, not the
  -- employee asking to move address, and there is no confirmation mail to
  -- rely on. Any pending change is cleared so a half-finished one cannot
  -- overwrite this later.
  update auth.users
     set email                       = btrim(new.email),
         email_change                = '',
         email_change_token_new      = '',
         email_change_token_current  = '',
         email_change_confirm_status = 0,
         updated_at                  = now()
   where id = new.auth_user_id;

  return new;
end $$;

drop trigger if exists employees_sync_auth_email on employees;
create trigger employees_sync_auth_email
  after update of email on employees
  for each row execute function sync_auth_email();

comment on function sync_auth_email() is
  'Mirrors employees.email onto auth.users so username and login stay consistent.';
