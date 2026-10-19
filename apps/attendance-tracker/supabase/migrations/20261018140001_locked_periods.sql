-- =====================================================================
-- Locked periods: a super admin closes a range of dates and nobody --
-- including the super admin -- can change attendance or adjustments in
-- it until it is unlocked again.
--
-- The rule lives in a trigger rather than in row level security or the
-- UI, for the same reason the leave guard does: save_attendance_rows is
-- SECURITY DEFINER and steps straight past RLS, and the REST API is
-- reachable without the UI at all. Triggers fire on every path.
--
-- What a date-range lock can and cannot protect is worth stating. It
-- freezes the rows that carry a date. It does not freeze employee master
-- data -- leave balances, payroll switches, titles -- because those are
-- current-state fields with no date on them, and changing a balance today
-- changes what a closed month computes. Freezing that would mean
-- snapshotting the monthly report at lock time, which is a separate job.
-- =====================================================================

-- ---------------------------------------------------------------------
-- The ranges.
--
-- Unlocking sets unlocked_at rather than deleting the row, so "who
-- reopened October, and when" stays answerable. Overlapping active
-- ranges are allowed and simply union: a date is locked if any active
-- range contains it. That makes "lock each payroll month as it closes"
-- the natural use and avoids merge logic nobody would trust.
-- ---------------------------------------------------------------------

create table if not exists locked_periods (
  id          bigint generated always as identity primary key,
  from_date   date        not null,
  to_date     date        not null,
  note        text,
  locked_by   uuid        references employees (id) on delete set null,
  locked_at   timestamptz not null default now(),
  unlocked_by uuid        references employees (id) on delete set null,
  unlocked_at timestamptz,
  constraint locked_periods_range_ok check (to_date >= from_date)
);

comment on table locked_periods is
  'Date ranges closed to edits. Only a super admin may lock or unlock; the lock then applies to everyone, super admin included.';

-- One active lock per identical range. Overlaps are fine, exact
-- duplicates are just noise in the list.
create unique index if not exists locked_periods_active_range_uq
  on locked_periods (from_date, to_date)
  where unlocked_at is null;

-- Containment lookups run on every attendance write.
create index if not exists locked_periods_active_gist
  on locked_periods using gist (daterange(from_date, to_date, '[]'))
  where unlocked_at is null;

-- ---------------------------------------------------------------------
-- Is this date closed?
--
-- SECURITY DEFINER so the answer does not depend on the caller being able
-- to read locked_periods, and so it stays correct inside other definer
-- functions.
-- ---------------------------------------------------------------------

create or replace function is_date_locked(d date)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1 from locked_periods
     where unlocked_at is null
       and d between from_date and to_date
  );
$fn$;

comment on function is_date_locked(date) is
  'True when the date falls inside any active locked period.';

-- The range a date falls in, for an error message people can act on.
create or replace function locked_period_label(d date)
returns text
language sql
stable
security definer
set search_path = public
as $fn$
  select to_char(from_date, 'DD Mon YYYY') || ' to ' || to_char(to_date, 'DD Mon YYYY')
    from locked_periods
   where unlocked_at is null
     and d between from_date and to_date
   order by locked_at desc
   limit 1;
$fn$;

revoke all on function is_date_locked(date) from public;
revoke all on function locked_period_label(date) from public;
grant execute on function is_date_locked(date), locked_period_label(date) to authenticated;

-- ---------------------------------------------------------------------
-- The guard.
--
-- INSERT is blocked as well as UPDATE and DELETE: without that, a day
-- "missing" from a closed month could still be added to it afterwards.
--
-- UPDATE checks the old date and the new one. Checking only the new date
-- would let a row be dragged out of a locked window, edited, and dragged
-- back in.
-- ---------------------------------------------------------------------

create or replace function enforce_period_lock()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  col  constant text := tg_argv[0];
  old_d date;
  new_d date;
  hit   date;
begin
  -- No JWT means direct database access (SQL editor, service role). That
  -- is already past anything this guard could enforce, and leaving it
  -- open is the only way to repair a period that was locked in error
  -- together with a mistake inside it.
  if auth.uid() is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op <> 'INSERT' then execute format('select ($1).%I', col) into old_d using old; end if;
  if tg_op <> 'DELETE' then execute format('select ($1).%I', col) into new_d using new; end if;

  if old_d is not null and is_date_locked(old_d) then
    hit := old_d;
  elsif new_d is not null and is_date_locked(new_d) then
    hit := new_d;
  end if;

  if hit is not null then
    raise exception
      'The period % is locked, so records dated % cannot be added, changed or deleted. A super admin must unlock it first.',
      coalesce(locked_period_label(hit), 'selected'), to_char(hit, 'DD Mon YYYY')
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end $fn$;

comment on function enforce_period_lock() is
  'Refuses any write whose date falls in a locked period. Takes the date column name as a trigger argument.';

drop trigger if exists attendance_period_lock on attendance_records;
create trigger attendance_period_lock
  before insert or update or delete on attendance_records
  for each row execute function enforce_period_lock('work_date');

drop trigger if exists adjustments_period_lock on adjustments;
create trigger adjustments_period_lock
  before insert or update or delete on adjustments
  for each row execute function enforce_period_lock('adj_date');

-- ---------------------------------------------------------------------
-- Who may lock and unlock.
--
-- Enforced in a trigger as well as in the policies below, because a
-- policy alone is bypassed by anything running SECURITY DEFINER.
-- ---------------------------------------------------------------------

create or replace function guard_locked_periods()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if auth.uid() is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if not is_super_admin() then
    raise exception 'Only a super admin can lock or unlock a period'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'DELETE' then
    raise exception 'Locked periods are not deleted. Unlock the period instead, so the record of it remains.'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'INSERT' then
    new.locked_by   := my_employee_id();
    new.locked_at   := now();
    new.unlocked_by := null;
    new.unlocked_at := null;
    return new;
  end if;

  -- UPDATE is the unlock, and nothing else. Letting the dates move after
  -- the fact would make the history a record of the current opinion
  -- rather than of what was actually closed.
  if new.from_date is distinct from old.from_date
     or new.to_date is distinct from old.to_date
     or new.locked_by is distinct from old.locked_by
     or new.locked_at is distinct from old.locked_at then
    raise exception 'A locked period cannot be edited. Unlock it and lock the dates you want.'
      using errcode = 'insufficient_privilege';
  end if;

  if old.unlocked_at is not null then
    raise exception 'That period is already unlocked. Lock the dates again to close them.'
      using errcode = 'insufficient_privilege';
  end if;

  new.unlocked_by := my_employee_id();
  new.unlocked_at := now();
  return new;
end $fn$;

drop trigger if exists locked_periods_guard on locked_periods;
create trigger locked_periods_guard
  before insert or update or delete on locked_periods
  for each row execute function guard_locked_periods();

-- ---------------------------------------------------------------------
-- Everyone signed in can see what is locked -- the pages need it to grey
-- themselves out before someone types a day's work. Only a super admin
-- writes.
-- ---------------------------------------------------------------------

alter table locked_periods enable row level security;

drop policy if exists locked_periods_read  on locked_periods;
drop policy if exists locked_periods_write on locked_periods;

create policy locked_periods_read on locked_periods
  for select to authenticated
  using (true);

create policy locked_periods_write on locked_periods
  for all to authenticated
  using (is_super_admin())
  with check (is_super_admin());

grant select on locked_periods to authenticated;
grant insert, update on locked_periods to authenticated;
