-- =====================================================================
-- The change log was dropping every new attendance record.
--
-- THE BUG. audit_value_label() turns a stored value into the words that
-- go in the log. For a number it assumed the number was a foreign key
-- and cast it:
--
--     v_id := (p_value #>> '{}')::bigint;
--
-- attendance_records.transport is numeric(10,2). to_jsonb renders it
-- with its scale, so the text handed to that cast is '0.00', and
-- '0.00'::bigint is an error in Postgres -- it will not read a decimal
-- point as an integer.
--
-- The exception propagated into write_audit_log(), whose exception
-- handler exists so that logging can never refuse somebody's save. It
-- did its job: the save went through, a warning went to the Postgres
-- log, and the audit line was dropped on the floor.
--
-- WHY IT LOOKED LIKE IT WORKED. The label is only built for fields that
-- changed. On an UPDATE that is the handful somebody edited, and
-- transport is usually not among them -- so editing a day in the grid
-- logged normally. On an INSERT every field counts as changed, so
-- transport was always there and the line was always lost.
--
-- Which means: no attendance record created since the log was switched
-- on was ever recorded. Uploading a sheet creates records for empty
-- days, so an upload logged nothing at all. Editing days that already
-- existed logged, which is why the log looked alive.
--
-- The same held for any numeric field on any audited table -- wages,
-- leave balances, adjustment amounts -- whenever one of them was part
-- of the change.
--
-- WHAT CANNOT BE FIXED. The lines that were dropped are gone. Nothing
-- recorded them and there is nothing to recover them from; the log
-- starts being complete from the moment this is applied.
--
-- TWO CHANGES, not one:
--
--   1. Only an integer is treated as an id. A value with a decimal
--      point is just a number and goes through as text.
--
--   2. audit_value_label() can no longer take an audit line down with
--      it. If anything in it fails, it falls back to the raw value --
--      a worse label, not a missing line. The first change fixes this
--      bug; the second stops the next one of its kind from costing
--      the same thing.
-- =====================================================================

create or replace function audit_value_label(p_column text, p_value jsonb)
returns text
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_id   bigint;
  v_text text;
  v_raw  text;
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then
    return '(blank)';
  end if;

  if jsonb_typeof(p_value) = 'boolean' then
    return case when p_value::text = 'true' then 'yes' else 'no' end;
  end if;

  v_raw := p_value #>> '{}';

  /* An id is a whole number. A value with a decimal point is a figure
     -- transport, a wage, a leave balance -- and casting it to bigint
     raises, which is what used to cost the whole audit line. Tested
     here rather than caught below so the ordinary case never raises
     at all. */
  if jsonb_typeof(p_value) = 'number' and v_raw ~ '^-?[0-9]+$' then
    v_id := v_raw::bigint;
    case p_column
      when 'attendance_type_id' then
        select name_en into v_text from attendance_types where id = v_id;
      when 'status_id' then
        select name into v_text from employee_statuses where id = v_id;
      when 'site_id' then
        select name into v_text from sites where id = v_id;
      when 'department_id' then
        select name into v_text from departments where id = v_id;
      when 'bus_route_id' then
        select name into v_text from bus_routes where id = v_id;
      when 'qualification_degree_id' then
        select name_en into v_text from qualification_degrees where id = v_id;
      when 'level_id' then
        select code || ' — ' || name into v_text from employee_levels where id = v_id;
      else v_text := null;
    end case;
    if v_text is not null then
      return v_text;
    end if;
  end if;

  -- #>> '{}' unwraps a json string without leaving its quotes behind.
  return v_raw;

/* A label is a nicety; the line it sits in is the record. Before this,
   anything that raised in here took the whole line with it, because the
   caller's own handler cannot tell a lost label from a lost row. Now
   the worst case is an id printed as a number. */
exception when others then
  raise warning 'audit_value_label failed for % (%): %', p_column, p_value, sqlerrm;
  return coalesce(p_value #>> '{}', '(blank)');
end $function$;

comment on function audit_value_label(text, jsonb) is
  'The words a stored value reads as in the change log. Never raises: a failure costs the label, not the audit line.';

-- ---------------------------------------------------------------------
-- The level column joined the employees table after the labels were
-- written, so a level change used to log as a bare number. Added above
-- while the function was open.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- Prove it here, on the real database.
--
-- This cannot be checked anywhere else: the bug was Postgres refusing a
-- cast, so only Postgres can say it is fixed. If either of these is
-- wrong the migration fails and nothing is applied, which is the right
-- outcome -- a change log that silently keeps losing lines is worse
-- than a migration that refuses to go in.
-- ---------------------------------------------------------------------
do $$
declare
  v_label text;
  v_type  attendance_types%rowtype;
begin
  -- The exact value that used to abort the whole audit line.
  v_label := audit_value_label('transport', to_jsonb(0.00::numeric(10,2)));
  if v_label is distinct from '0.00' then
    raise exception 'a decimal is still mishandled: transport 0.00 labelled as %', v_label;
  end if;

  -- A wage, for the same reason.
  v_label := audit_value_label('si_basic_wage', to_jsonb(5500.50::numeric(12,2)));
  if v_label is distinct from '5500.50' then
    raise exception 'a decimal wage is still mishandled: %', v_label;
  end if;

  -- And ids must still read as names, which is the whole point of the
  -- branch the guard now sits in front of.
  select * into v_type from attendance_types order by id limit 1;
  if found then
    v_label := audit_value_label('attendance_type_id', to_jsonb(v_type.id));
    if v_label is distinct from v_type.name_en then
      raise exception 'attendance types no longer label: % read as %', v_type.name_en, v_label;
    end if;
  end if;
end $$;

notify pgrst, 'reload schema';
