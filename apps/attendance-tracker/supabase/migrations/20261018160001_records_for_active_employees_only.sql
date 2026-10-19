-- =====================================================================
-- Attendance and adjustments may only be written for an employee who is
-- active: the Active checkbox ticked, and a status that allows records.
--
-- Which statuses allow records is a column rather than a name match in
-- the code. Two reasons. Renaming a status in Settings would otherwise
-- silently switch the rule off, the same trap the attendance type codes
-- carry. And the right answer is not obvious for every status: "On
-- Leave" is marked payable, and leave days are themselves attendance
-- records, so an employee put On Leave for the duration of their leave
-- would be impossible to record. Seeded here as Active only, exactly as
-- asked; a super admin can tick another status in Settings without
-- anyone touching code.
--
-- Enforced in a trigger, not in the UI or row level security, for the
-- reason the other guards are: save_attendance_rows is SECURITY DEFINER
-- and goes straight past RLS, and the REST API is reachable without the
-- app at all.
-- =====================================================================

alter table employee_statuses
  add column if not exists allows_records boolean not null default false;

comment on column employee_statuses.allows_records is
  'Whether attendance and adjustments may be added or changed for an employee holding this status.';

-- Seeded from the name once, at install. After this the column is the
-- authority and the name is free to change.
update employee_statuses set allows_records = true where name = 'Active';

-- ---------------------------------------------------------------------
-- Why an employee cannot be recorded, or null when they can.
--
-- Returning the sentence rather than a boolean keeps the explanation
-- next to the rule, so the grid, the bulk save and a direct API call all
-- fail with the same words.
--
-- SECURITY DEFINER, and deliberately not granted to anyone: it reads
-- employee names straight past row level security, which is fine inside
-- a trigger and a leak anywhere else. The pages work this out for
-- themselves from the employee rows they are already allowed to see.
-- ---------------------------------------------------------------------

create or replace function employee_record_block_reason(p_employee uuid)
returns text
language sql
stable
security definer
set search_path = public
as $fn$
  select case
    when not e.is_active then
      e.name || ' is deactivated, so their attendance and adjustments cannot be '
      || 'added, changed or deleted. Restore the employee under Employees first.'
    when e.status_id is null then
      e.name || ' has no status set, so their attendance and adjustments cannot be '
      || 'added, changed or deleted. Set a status that allows records under Employees.'
    when not s.allows_records then
      e.name || ' has the status "' || s.name || '", which does not allow records. '
      || 'Only statuses ticked as "Can be recorded" under Settings do.'
    else null
  end
  from employees e
  left join employee_statuses s on s.id = e.status_id
  where e.id = p_employee;
$fn$;

revoke all on function employee_record_block_reason(uuid) from public;
revoke all on function employee_record_block_reason(uuid) from anon;
revoke all on function employee_record_block_reason(uuid) from authenticated;

-- ---------------------------------------------------------------------
-- The guard.
--
-- An UPDATE is checked against the employee the row belonged to and the
-- one it is being moved to. Checking only the new employee would let a
-- resigned employee's row be reassigned to an active colleague, edited,
-- and handed back.
--
-- DELETE is included. A resigned employee's attendance is what their
-- final payroll was calculated from; being unable to edit it but free to
-- delete it would not be much of a rule. To correct something genuinely
-- wrong, make the employee active again, fix it, and set the status back.
-- ---------------------------------------------------------------------

create or replace function enforce_recordable_employee()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  reason text;
begin
  -- No JWT means direct database access, already beyond what this can
  -- enforce, and the way back in if a status is left in a state nobody
  -- can edit out of.
  if auth.uid() is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op <> 'INSERT' then
    reason := employee_record_block_reason(old.employee_id);
    if reason is not null then
      raise exception '%', reason using errcode = 'insufficient_privilege';
    end if;
  end if;

  if tg_op <> 'DELETE' then
    reason := employee_record_block_reason(new.employee_id);
    if reason is not null then
      raise exception '%', reason using errcode = 'insufficient_privilege';
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end $fn$;

comment on function enforce_recordable_employee() is
  'Refuses attendance and adjustment writes for employees who are deactivated or hold a status that does not allow records.';

drop trigger if exists attendance_active_employee on attendance_records;
create trigger attendance_active_employee
  before insert or update or delete on attendance_records
  for each row execute function enforce_recordable_employee();

drop trigger if exists adjustments_active_employee on adjustments;
create trigger adjustments_active_employee
  before insert or update or delete on adjustments
  for each row execute function enforce_recordable_employee();
