-- =====================================================================
-- Company holidays: declared once, applied to everybody.
--
-- WHY A TABLE AND NOT JUST THE RECORDS. Giving everyone a Holiday on 25
-- December writes two hundred attendance records and nothing that says
-- "25 December is a holiday". The difference matters as soon as you ask
-- the question again: without this table the only way to know a day was
-- declared is to notice that most people have the same type on it,
-- which is a guess that gets worse every time somebody is edited
-- afterwards. The declaration is a company fact; the records are its
-- effect, and the two are kept apart.
--
-- WHAT IS NOT OVERWRITTEN. A day already recorded for an employee stays
-- exactly as it is. Somebody on annual leave over a public holiday has
-- a decision recorded against that day, and a bulk action must not
-- quietly replace it -- the balance it was deducted from would not
-- change back. Those employees are returned by name so whoever
-- declared the holiday can see who was skipped and why, rather than
-- being told a round number.
--
-- LOCKED PERIODS. Refused outright. Nothing else in the app writes into
-- a locked period, and a bulk write is the last thing that should be
-- the exception. Note that nothing in the database enforced this before
-- -- the grid checks it in the browser -- so this function checks it
-- itself rather than assuming a trigger will.
-- =====================================================================

create table if not exists company_holidays (
  id                 bigint generated always as identity primary key,
  holiday_date       date not null unique,
  attendance_type_id smallint not null references attendance_types(id) on update cascade,
  description        text not null,
  created_at         timestamptz not null default now(),
  created_by         uuid references auth.users(id) on delete set null
);

comment on table company_holidays is
  'Days declared a holiday for the whole company. The per-employee attendance records are the effect of a row here, not the record of it.';

create index if not exists company_holidays_date_idx on company_holidays (holiday_date desc);

alter table company_holidays enable row level security;

drop policy if exists company_holidays_read  on company_holidays;
drop policy if exists company_holidays_write on company_holidays;

-- Readable by anyone signed in who is not no_access: a holiday is not a
-- secret, and a user seeing why their day is marked Holiday is the
-- point of recording the description.
create policy company_holidays_read on company_holidays
  for select to authenticated
  using (my_role() <> 'no_access'::app_role);

create policy company_holidays_write on company_holidays
  for all to authenticated
  using (is_admin()) with check (is_admin());

grant select on company_holidays to authenticated;
grant insert, update, delete on company_holidays to authenticated;

-- ---------------------------------------------------------------------
-- Declare one, and apply it.
--
-- SECURITY INVOKER, stated because it is load-bearing: the insert into
-- attendance_records below is governed by attendance_write, which is
-- is_admin(). A user who is not an admin gets nothing inserted and the
-- function reports zero -- it does not quietly run as the owner and
-- write two hundred rows on their behalf.
--
-- One statement for the records, with ON CONFLICT DO NOTHING against
-- the (employee_id, work_date) key that already exists. That is what
-- makes "do not overwrite" true even if somebody saves a day in the
-- grid between the check below and the insert: the database refuses the
-- duplicate rather than this function racing it.
--
-- Returns, as jsonb so the shape can grow without a signature change:
--   created  how many employees got the day
--   skipped  [ { code, name, type_en, type_ar } ] -- who already had it
--   total    how many active employees were considered
-- ---------------------------------------------------------------------
create or replace function declare_company_holiday(
  p_date        date,
  p_type_id     smallint,
  p_description text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_skipped jsonb;
  v_created integer;
  v_total   integer;
begin
  if p_date is null then
    raise exception 'A date is required.';
  end if;
  if p_description is null or btrim(p_description) = '' then
    raise exception 'A description is required.';
  end if;
  if not exists (select 1 from attendance_types where id = p_type_id) then
    raise exception 'That attendance type does not exist.';
  end if;
  if is_date_locked(p_date) then
    raise exception 'That date is inside a locked period (%).', locked_period_label(p_date);
  end if;

  /* Three plain statements rather than one clever one.
   *
   * They are in a function, so they are in one transaction: the names
   * read in the first describe what was there before the second runs,
   * and nothing can slip between them. An earlier version did it all
   * in a single WITH with a data-modifying CTE, which is harder to read
   * and leans on two corners of the language at once. This does the
   * same work and can be checked by eye. */

  -- Employees who may hold records at all: the same test the grid uses
  -- before it will let anybody type into a row.
  select count(*) into v_total
    from employees e
    join employee_statuses s on s.id = e.status_id
   where e.is_active and s.allows_records;

  -- Who already has that day, and as what. Read first, so these names
  -- describe what was there rather than what this call just wrote.
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'code', x.code, 'name', x.name,
               'type_en', x.name_en, 'type_ar', x.name_ar
             ) order by x.name
           ),
           '[]'::jsonb
         )
    into v_skipped
    from (
      select e.code, e.name, t.name_en, t.name_ar
        from employees e
        join employee_statuses s on s.id = e.status_id
        join attendance_records r on r.employee_id = e.id and r.work_date = p_date
        join attendance_types t on t.id = r.attendance_type_id
       where e.is_active and s.allows_records
    ) x;

  -- ON CONFLICT DO NOTHING against the (employee_id, work_date) key is
  -- what makes "do not overwrite" true, rather than the read above: if
  -- somebody saves that day in the grid in between, the database
  -- refuses the duplicate instead of this racing it.
  insert into attendance_records (employee_id, work_date, attendance_type_id, note, created_by, updated_by)
  select e.id, p_date, p_type_id, btrim(p_description), auth.uid(), auth.uid()
    from employees e
    join employee_statuses s on s.id = e.status_id
   where e.is_active and s.allows_records
  on conflict (employee_id, work_date) do nothing;

  get diagnostics v_created = row_count;

  -- Only once the records are in. A declaration with no records behind
  -- it would show on the page as a holiday nobody has.
  insert into company_holidays (holiday_date, attendance_type_id, description, created_by)
  values (p_date, p_type_id, btrim(p_description), auth.uid())
  on conflict (holiday_date) do update
    set attendance_type_id = excluded.attendance_type_id,
        description        = excluded.description;

  return jsonb_build_object('created', v_created, 'total', v_total, 'skipped', v_skipped);
end;
$$;

comment on function declare_company_holiday(date, smallint, text) is
  'Declare a company holiday and give it to every employee who may hold records, without overwriting a day already recorded. Returns how many got it and who did not.';

grant execute on function declare_company_holiday(date, smallint, text) to authenticated;

-- ---------------------------------------------------------------------
-- The list the page shows: the declarations, with how many employees
-- actually hold that day as that type.
--
-- Counted rather than assumed, because the records can be edited
-- afterwards one at a time, and a holiday that half the company no
-- longer has is worth seeing from the list.
-- ---------------------------------------------------------------------
create or replace function list_company_holidays()
returns table (
  id           bigint,
  holiday_date date,
  type_id      smallint,
  type_en      text,
  type_ar      text,
  description  text,
  employees    bigint,
  created_at   timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    h.id,
    h.holiday_date,
    h.attendance_type_id,
    t.name_en,
    t.name_ar,
    h.description,
    (select count(*)
       from attendance_records r
      where r.work_date = h.holiday_date
        and r.attendance_type_id = h.attendance_type_id),
    h.created_at
  from company_holidays h
  join attendance_types t on t.id = h.attendance_type_id
  order by h.holiday_date desc;
$$;

comment on function list_company_holidays() is
  'Declared company holidays, newest first, with how many employees currently hold that day as that type.';

grant execute on function list_company_holidays() to authenticated;

notify pgrst, 'reload schema';
