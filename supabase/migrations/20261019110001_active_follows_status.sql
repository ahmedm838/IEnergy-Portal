-- =====================================================================
-- Being active follows the status, and is no longer a switch of its own.
--
-- An employee was active or not according to a checkbox that somebody
-- ticked, quite separately from their status. Two sources for one fact,
-- and nothing kept them honest: a Resigned employee could sit there
-- ticked as active indefinitely.
--
-- employees.is_active stays as a column, but nothing writes it by hand
-- any more -- a trigger keeps it in step with the status. Deriving it
-- rather than dropping it is deliberate: a dozen policies, functions,
-- views and queries read that column, and they all keep working and keep
-- agreeing with each other. What changes is who decides its value.
--
-- Which statuses count as active is a column rather than a list of names
-- in the code, for the reason the other status flags are: this database
-- has already had "Active" renamed to "On Board" once, and a name match
-- would have quietly stopped working that day.
-- =====================================================================

alter table employee_statuses
  add column if not exists counts_as_active boolean not null default false;

comment on column employee_statuses.counts_as_active is
  'Whether an employee holding this status counts as active. Drives employees.is_active, which is no longer set by hand.';

-- Seeded as asked: on board, or away on leave, is still on the payroll.
-- Everything else -- resigned, suspended, absent -- is not.
update employee_statuses
   set counts_as_active = (name in ('On Board', 'On Leave'));

-- ---------------------------------------------------------------------
-- Keep is_active in step with the status it now comes from.
-- ---------------------------------------------------------------------

create or replace function sync_is_active()
returns trigger
language plpgsql
as $fn$
begin
  -- No status at all is not a status that counts as active.
  new.is_active := coalesce(
    (select s.counts_as_active from employee_statuses s where s.id = new.status_id),
    false
  );
  return new;
end $fn$;

comment on function sync_is_active() is
  'Sets employees.is_active from the status. The column is derived; assigning to it directly has no effect.';

drop trigger if exists employees_sync_is_active on employees;
create trigger employees_sync_is_active
  before insert or update of status_id, is_active on employees
  for each row execute function sync_is_active();

-- ---------------------------------------------------------------------
-- And if a status itself changes which side of the line it falls on,
-- everyone holding it moves with it. Without this the flag would only
-- take effect on employees edited afterwards.
-- ---------------------------------------------------------------------

create or replace function resync_employees_for_status()
returns trigger
language plpgsql
as $fn$
begin
  update employees
     set is_active = new.counts_as_active
   where status_id = new.id
     and is_active is distinct from new.counts_as_active;
  return null;
end $fn$;

drop trigger if exists statuses_resync_active on employee_statuses;
create trigger statuses_resync_active
  after update of counts_as_active on employee_statuses
  for each row execute function resync_employees_for_status();

-- ---------------------------------------------------------------------
-- Bring the rows already on file into line.
-- ---------------------------------------------------------------------

update employees e
   set is_active = coalesce(
     (select s.counts_as_active from employee_statuses s where s.id = e.status_id),
     false
   )
 where e.is_active is distinct from coalesce(
     (select s.counts_as_active from employee_statuses s where s.id = e.status_id),
     false
   );

comment on column employees.is_active is
  'Derived from the status, by trigger. Not set by hand: change the status instead, or change which statuses count as active under Settings.';
