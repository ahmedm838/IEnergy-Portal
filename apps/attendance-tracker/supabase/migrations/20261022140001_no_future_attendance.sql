-- =====================================================================
-- Attendance cannot be recorded for a day that has not happened.
--
-- A trigger rather than a CHECK constraint, and not by choice: a CHECK
-- must be immutable, and "is this date in the future" depends on when
-- you ask. Postgres rejects current_date inside a CHECK outright.
--
-- The boundary is Cairo's date, not the server's. This database runs in
-- UTC and Egypt is two to three hours ahead, so between midnight and
-- 02:00 Cairo time the server is still on yesterday -- and an attendance
-- clerk starting early would have been told that today is in the future.
-- That is the kind of bug that appears for two hours a day and is never
-- reproducible when anybody looks into it.
--
-- INSERT and UPDATE only. DELETE is deliberately left alone, so the
-- future rows that already exist can still be cleared out.
-- =====================================================================

create or replace function today_in_cairo()
returns date
language sql
stable
as $function$
  select (now() at time zone 'Africa/Cairo')::date;
$function$;

comment on function today_in_cairo() is
  'Today where the company is, which is what "future" has to mean here. The database runs in UTC, so current_date lags Cairo by two to three hours either side of midnight.';

create or replace function reject_future_attendance()
returns trigger
language plpgsql
as $function$
declare
  today date := today_in_cairo();
begin
  if new.work_date > today then
    raise exception
      'Attendance cannot be recorded for % because that day has not happened yet (today is %).',
      to_char(new.work_date, 'DD Mon YYYY'), to_char(today, 'DD Mon YYYY')
      using errcode = 'check_violation',
            hint = 'Record the day once it has passed.';
  end if;
  return new;
end $function$;

drop trigger if exists attendance_no_future on attendance_records;
create trigger attendance_no_future
  before insert or update on attendance_records
  for each row execute function reject_future_attendance();

-- ---------------------------------------------------------------------
-- Rows already in the future: removed separately, not by this file.
--
-- There were 128 of them when this was written -- 80 days of "Attended"
-- across four employees, reaching to 20 Nov, plus weekly rest and three
-- leave days. Deleting somebody's records is not a migration's decision
-- to make, so this file does not do it. They were deleted by hand on
-- 22 Oct 2026 on the instruction of whoever owns the data, immediately
-- after this ran.
--
-- All 128 are kept in attendance_future_removed_20261022, with the
-- employee code, name and type joined on so the copy can be read
-- without them. That table has no grants and RLS on, so it is reachable
-- by direct SQL only -- a copy of attendance records should not be the
-- one thing in this schema the anon key can read.
--
-- Note that restoring one is not simply an insert: the trigger refuses
-- a future work_date, so a row can only go back once its day has come
-- round. That is the rule working, not an obstacle to it.
--
-- To see what was taken:
--
--   select employee_code, employee_name, work_date, type_name
--     from attendance_future_removed_20261022
--    order by employee_code, work_date;
-- ---------------------------------------------------------------------

grant execute on function today_in_cairo() to authenticated;
