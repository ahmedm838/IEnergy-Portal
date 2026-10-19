-- =====================================================================
-- Usernames, and the bootstrap administrator.
--
-- A username is the part of the email before the "@". It is a GENERATED
-- column rather than a stored field so it cannot drift from the address
-- that actually authenticates: change the email and the username follows.
-- =====================================================================

alter table employees
  add column if not exists username text
  generated always as (split_part(lower(email), '@', 1)) stored;

comment on column employees.username is
  'Derived from email (local part). Generated, so it always matches the address used to sign in.';

-- Usernames identify people in the UI and are accepted at sign-in, so two
-- employees must not share one. This also catches the same local part
-- arriving from two different domains.
create unique index if not exists employees_username_idx
  on employees (username) where username is not null;

-- ---------------------------------------------------------------------
-- Default email domain.
--
-- Lets the sign-in box accept "ahmed.moustafa" as well as the full
-- address. The login page needs this BEFORE anyone is authenticated, so
-- it is exposed through a function granted to anon rather than by opening
-- up app_settings. A mail domain is not a secret; the table around it is
-- still closed.
-- ---------------------------------------------------------------------

insert into app_settings (key, value, description) values
  ('default_email_domain', '"ienergyegypt.com"',
   'Appended at sign-in when someone types a username instead of a full email')
on conflict (key) do nothing;

create or replace function default_email_domain()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select value #>> '{}' from app_settings
                    where key = 'default_email_domain'), '');
$$;

grant execute on function default_email_domain() to anon, authenticated;

-- ---------------------------------------------------------------------
-- Bootstrap administrator.
--
-- Idempotent: re-running changes nothing. The auth account is created
-- separately in the dashboard; the linking triggers join the two in
-- whichever order they happen.
-- ---------------------------------------------------------------------

insert into employees (
  code, name, email, title, role, status_id, site_id,
  annual_leave_balance, unplanned_leave_balance,
  has_meal, has_allowance, has_overtime, has_incentive, has_deductions
)
select
  1,
  'Ahmed Moustafa',
  'ahmed.moustafa@ienergyegypt.com',
  'System Administrator',
  'admin'::app_role,
  (select id from employee_statuses where name = 'Active'),
  (select id from sites where name = 'Admin'),
  23, 7,
  true, true, true, false, true
on conflict (code) do nothing;
