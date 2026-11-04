-- =====================================================================
-- Editing and removing a declared holiday.
--
-- EDIT changes the description and nothing else. The day and the type
-- are what the records were written from; changing either here would
-- leave two hundred records saying one thing and the declaration
-- saying another, and the page would show a holiday that does not
-- match what anybody has. To move a holiday, delete it and declare it
-- again -- which is two deliberate acts, as it should be.
--
-- The description was copied onto every record as its note when the
-- holiday was declared, so correcting a typo here would otherwise
-- leave the records still carrying the typo. The notes follow, but
-- ONLY where the note is still that exact copy. A note somebody has
-- edited by hand on one employee is that person's and is left alone.
--
-- DELETE removes every attendance record on that day, for everybody --
-- which is what was asked for, and is more than the holiday created.
-- Somebody who was on annual leave that day was skipped when the
-- holiday was declared, and their record is older than the holiday;
-- this takes it too. There is no undo and the leave balance it was
-- deducted from will not come back on its own.
--
-- So the count of those is reported separately by list_company_holidays
-- below, and the page says the number out loud in the confirmation
-- before anybody presses it. The decision stays the person's; what
-- changes is that they can see what it costs.
-- =====================================================================

-- ---------------------------------------------------------------------
-- The listing gains two figures the page needs to warn with.
--
--   employees      how many hold that day as the holiday's own type
--   other_records  how many hold it as something else -- the records
--                  the holiday did not create and delete will still
--                  take
-- ---------------------------------------------------------------------
drop function if exists list_company_holidays();

create or replace function list_company_holidays()
returns table (
  id            bigint,
  holiday_date  date,
  type_id       smallint,
  type_en       text,
  type_ar       text,
  description   text,
  employees     bigint,
  other_records bigint,
  is_locked     boolean,
  created_at    timestamptz
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
    (select count(*) from attendance_records r
      where r.work_date = h.holiday_date
        and r.attendance_type_id = h.attendance_type_id),
    (select count(*) from attendance_records r
      where r.work_date = h.holiday_date
        and r.attendance_type_id <> h.attendance_type_id),
    -- Read here rather than worked out in the browser: the page would
    -- otherwise need the locked periods loaded to grey out a button.
    is_date_locked(h.holiday_date),
    h.created_at
  from company_holidays h
  join attendance_types t on t.id = h.attendance_type_id
  order by h.holiday_date desc;
$$;

comment on function list_company_holidays() is
  'Declared company holidays, newest first: how many employees hold the day as the holiday''s type, how many hold it as something else, and whether the day is locked.';

grant execute on function list_company_holidays() to authenticated;

-- ---------------------------------------------------------------------
-- Edit: the description, and the notes that were copied from it.
-- ---------------------------------------------------------------------
create or replace function update_company_holiday(
  p_id          bigint,
  p_description text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_old      text;
  v_date     date;
  v_notes    integer;
begin
  if p_description is null or btrim(p_description) = '' then
    raise exception 'A description is required.';
  end if;

  select description, holiday_date into v_old, v_date
    from company_holidays where id = p_id;
  if not found then
    raise exception 'That holiday no longer exists. Reload the page.';
  end if;

  update company_holidays
     set description = btrim(p_description)
   where id = p_id;

  -- Row-level security decides whether this changes anything: the write
  -- policy on attendance_records is is_admin(), so a user who may not
  -- write simply updates nothing and is told nothing moved.
  if is_date_locked(v_date) then
    -- The declaration can still be corrected; the records cannot be
    -- touched inside a locked period, and saying so beats half doing it.
    v_notes := -1;
  else
    update attendance_records
       set note = btrim(p_description)
     where work_date = v_date
       and note is not distinct from v_old;
    get diagnostics v_notes = row_count;
  end if;

  return jsonb_build_object('notes_updated', v_notes);
end;
$$;

comment on function update_company_holiday(bigint, text) is
  'Change a holiday''s description, and the notes still carrying the old one verbatim. Notes edited by hand are left alone. Returns how many notes followed, or -1 when the day is locked.';

grant execute on function update_company_holiday(bigint, text) to authenticated;

-- ---------------------------------------------------------------------
-- Delete: the declaration, and every record on that day.
-- ---------------------------------------------------------------------
create or replace function delete_company_holiday(p_id bigint)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_date    date;
  v_deleted integer;
begin
  select holiday_date into v_date from company_holidays where id = p_id;
  if not found then
    raise exception 'That holiday no longer exists. Reload the page.';
  end if;

  if is_date_locked(v_date) then
    raise exception 'That date is inside a locked period (%).', locked_period_label(v_date);
  end if;

  -- Every record on the day, whatever type it is. Deliberate, and the
  -- page says the number of other-typed ones before this is reached.
  delete from attendance_records where work_date = v_date;
  get diagnostics v_deleted = row_count;

  delete from company_holidays where id = p_id;

  return jsonb_build_object('deleted', v_deleted, 'date', v_date);
end;
$$;

comment on function delete_company_holiday(bigint) is
  'Remove a declared holiday and every attendance record on that day, for every employee. Not only the records the holiday created. Refused inside a locked period.';

grant execute on function delete_company_holiday(bigint) to authenticated;

notify pgrst, 'reload schema';
