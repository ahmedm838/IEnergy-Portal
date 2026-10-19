-- =====================================================================
-- Leave balances may never go negative.
--
-- Enforced in the database rather than the save path, so it holds however
-- a record arrives -- the grid, a bulk save, the API, or SQL. A rule that
-- only lives in the app is a rule that is one forgotten call site away
-- from being broken.
--
-- The three balances are defined exactly as report_employee_summary
-- reports them, over the calendar year of the day being changed:
--
--   annual    = employees.annual_leave_balance    - days with effect 'annual'
--   unplanned = employees.unplanned_leave_balance - days with effect 'unplanned'
--   added     = days flagged add_to_leave_balance - days with effect 'added_days'
--
-- If the two ever drift, someone is refused a save for a balance the
-- report says they have, so they share one definition here.
-- =====================================================================

create or replace function leave_balances(p_employee_id uuid, p_year integer)
returns table (
  annual_balance    numeric,
  annual_used       numeric,
  annual_remaining  numeric,
  unplanned_balance numeric,
  unplanned_used    numeric,
  unplanned_remaining numeric,
  added_earned      numeric,
  added_used        numeric,
  added_remaining   numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with year_rows as (
    select t.effect, r.add_to_leave_balance
      from attendance_records r
      join attendance_types t on t.id = r.attendance_type_id
     where r.employee_id = p_employee_id
       and extract(year from r.work_date)::int = p_year
  ),
  used as (
    select
      count(*) filter (where effect = 'annual')::numeric     as annual_used,
      count(*) filter (where effect = 'unplanned')::numeric  as unplanned_used,
      count(*) filter (where effect = 'added_days')::numeric as added_used,
      count(*) filter (where add_to_leave_balance)::numeric  as added_earned
    from year_rows
  )
  select
    e.annual_leave_balance,
    used.annual_used,
    e.annual_leave_balance - used.annual_used,
    e.unplanned_leave_balance,
    used.unplanned_used,
    e.unplanned_leave_balance - used.unplanned_used,
    used.added_earned,
    used.added_used,
    used.added_earned - used.added_used
  from employees e cross join used
  where e.id = p_employee_id;
$$;

grant execute on function leave_balances(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------
-- The guard itself.
-- ---------------------------------------------------------------------

create or replace function check_leave_balances(p_employee_id uuid, p_year integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b    record;
  who  text;
begin
  select * into b from leave_balances(p_employee_id, p_year);
  if not found then return; end if;

  select name into who from employees where id = p_employee_id;

  if b.annual_remaining < 0 then
    raise exception
      'Annual leave balance for % in % would go to %. Entitlement is % days and % are already taken.',
      who, p_year, b.annual_remaining, b.annual_balance, b.annual_used
      using errcode = 'check_violation';
  end if;

  if b.unplanned_remaining < 0 then
    raise exception
      'Un-planned leave balance for % in % would go to %. Entitlement is % days and % are already taken.',
      who, p_year, b.unplanned_remaining, b.unplanned_balance, b.unplanned_used
      using errcode = 'check_violation';
  end if;

  if b.added_remaining < 0 then
    raise exception
      'Added days balance for % in % would go to %. Only % have been earned and % are already used. Credit a day with "Add to balance" before recording a Rest Day.',
      who, p_year, b.added_remaining, b.added_earned, b.added_used
      using errcode = 'check_violation';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Attendance records.
--
-- Row level rather than statement level: a bulk save of a whole month is
-- a single statement, and the whole statement rolls back on the first
-- offending day anyway, so nothing is half-saved either way.
-- ---------------------------------------------------------------------

create or replace function attendance_leave_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    perform check_leave_balances(new.employee_id, extract(year from new.work_date)::int);
  end if;

  -- A delete or a move between years can only free balance up, but the
  -- year it left still needs checking when a row moves employee or year.
  if tg_op = 'UPDATE'
     and (old.employee_id <> new.employee_id
          or extract(year from old.work_date) <> extract(year from new.work_date)) then
    perform check_leave_balances(old.employee_id, extract(year from old.work_date)::int);
  end if;

  return null;
end $$;

drop trigger if exists attendance_leave_guard_trg on attendance_records;
create constraint trigger attendance_leave_guard_trg
  after insert or update on attendance_records
  deferrable initially deferred
  for each row execute function attendance_leave_guard();

-- ---------------------------------------------------------------------
-- Opening entitlements.
--
-- Lowering an entitlement below what is already taken would push the
-- balance negative just as surely as booking another day.
-- ---------------------------------------------------------------------

create or replace function employee_leave_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.annual_leave_balance is distinct from old.annual_leave_balance
     or new.unplanned_leave_balance is distinct from old.unplanned_leave_balance then
    perform check_leave_balances(new.id, extract(year from current_date)::int);
  end if;
  return null;
end $$;

drop trigger if exists employees_leave_guard_trg on employees;
create constraint trigger employees_leave_guard_trg
  after update on employees
  deferrable initially deferred
  for each row execute function employee_leave_guard();
