-- Which portal pages each role may open.
--
-- One row per page and role, allowed or not, set by a super admin on the
-- Settings page (Page access). A row for every pair, rather than a row
-- only where access is given, so that "nobody below super admin" is a
-- setting and not the same thing as "never configured".
--
-- Only the two roles a super admin can choose for are kept here. A super
-- admin opens every page whatever this says, and no_access opens none:
-- neither is a setting, so neither can be set by mistake.
--
-- This decides which pages open. What a page can read or change is still
-- decided by row level security on each table, as before: opening a page
-- to a role does not open the rows behind it.

create table if not exists page_access (
  page        text      not null,
  role        app_role  not null,
  allowed     boolean   not null default false,
  updated_at  timestamptz not null default now(),
  primary key (page, role),
  constraint page_access_configurable_role check (role in ('user'::app_role, 'admin'::app_role)),
  constraint page_access_page_name check (page ~ '^[a-z0-9-]{1,60}$')
);

comment on table page_access is
  'Portal pages each role may open (Settings > Page access). Super admins open everything; no_access opens nothing.';

alter table page_access enable row level security;

-- Every signed-in account reads it: each page asks it before opening.
drop policy if exists page_access_read on page_access;
create policy page_access_read on page_access
  for select to authenticated
  using (true);

-- Only a super admin changes it.
drop policy if exists page_access_write on page_access;
create policy page_access_write on page_access
  for all to authenticated
  using (is_super_admin())
  with check (is_super_admin());

grant select, insert, update, delete on page_access to authenticated;

create or replace function page_access_touch()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists page_access_touch on page_access;
create trigger page_access_touch
  before update on page_access
  for each row execute function page_access_touch();

-- Today's rules, as the pages have them written in their own code.
insert into page_access (page, role, allowed) values
  ('attendance-tracker', 'user',  true),
  ('attendance-tracker', 'admin', true),
  ('employee-database',  'user',  false),
  ('employee-database',  'admin', true),
  ('hr-documents',       'user',  false),
  ('hr-documents',       'admin', true),
  ('employee-documents', 'user',  true),
  ('employee-documents', 'admin', true),
  ('contacts-list',      'user',  true),
  ('contacts-list',      'admin', true),
  ('salary-calculator',  'user',  false),
  ('salary-calculator',  'admin', true),
  ('company-policy',     'user',  true),
  ('company-policy',     'admin', true),
  ('purchasing-request', 'user',  true),
  ('purchasing-request', 'admin', true)
on conflict (page, role) do nothing;
