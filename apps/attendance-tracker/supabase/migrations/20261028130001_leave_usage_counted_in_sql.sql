-- =====================================================================
-- A year of attendance rows becomes four numbers per employee, in SQL.
--
-- WHY. The Employees page needed, per employee, the days taken against
-- annual, un-planned and added-days leave, and the days earned into the
-- added-days balance. It got them by downloading the rows and counting
-- them in the browser: two paginated scans of attendance_records over
-- the calendar year, a thousand rows a request, every row logged and
-- every row billed, to produce four integers each. Opening the page
-- cost a request per thousand rows twice over; by December that is a
-- dozen or more round trips and a few megabytes, for numbers Postgres
-- can count without sending anything.
--
-- SAME ANSWER, NOT A NEW ONE. The counting rules are leave_balances()'s,
-- which is the authority both this page and the employee report are
-- meant to agree with: join the type, count by effect, and count
-- add_to_leave_balance separately. That last one has to be separate --
-- an added day is *earned* by ticking "add to balance" on a day that was
-- worked, normally an Attended day whose effect is 'none'. Counting it
-- by effect would have found every day taken and none of the days that
-- paid for them.
--
-- The one deliberate difference from leave_balances is the date test.
-- It uses extract(year from work_date), which no index can serve; that
-- is harmless there because it is one employee at a time. Here it is
-- every employee at once, so the year is expressed as a half-open range
-- and attendance_date_idx can be used. Same rows, reachable.
--
-- RLS. SECURITY INVOKER -- the default, named because it is the point.
-- Every row is read as the caller, so an admin counts their own sector
-- and nobody else's, exactly as the two browser queries did. Making
-- this DEFINER would turn a page that shows your sector into one that
-- counts the company.
--
-- WHAT IS LEFT OUT. Employees with nothing to report are not returned
-- rather than returned as zeros: for most of the year most people have
-- no leave at all, and the page already reads a missing employee as
-- four zeros. Sending a row per employee to say "nothing" would undo
-- a good part of the saving.
--
-- COMPATIBILITY. Adds a function. No table, policy or grant is touched,
-- so a browser still running the old bundle keeps counting rows itself
-- and gets the same figures.
-- =====================================================================

create or replace function report_leave_usage(p_year integer)
returns table (
  emp_id         uuid,
  annual_used    numeric,
  unplanned_used numeric,
  added_used     numeric,
  added_earned   numeric
)
language sql
stable
-- security invoker is the default; named so nobody "tidies" it to definer
security invoker
set search_path = public
as $$
  select
    r.employee_id,
    count(*) filter (where t.effect = 'annual')::numeric,
    count(*) filter (where t.effect = 'unplanned')::numeric,
    count(*) filter (where t.effect = 'added_days')::numeric,
    -- Earned, not taken: see the note above on why this is its own count.
    count(*) filter (where r.add_to_leave_balance)::numeric
  from attendance_records r
  join attendance_types t on t.id = r.attendance_type_id
  where r.work_date >= make_date(p_year, 1, 1)
    and r.work_date <  make_date(p_year + 1, 1, 1)
  group by r.employee_id
  having count(*) filter (
           where t.effect in ('annual', 'unplanned', 'added_days')
              or r.add_to_leave_balance
         ) > 0;
$$;

comment on function report_leave_usage(integer) is
  'Leave days taken and earned per employee for a calendar year, counted in SQL with the caller''s own row-level security. Same rules as leave_balances(). Employees with nothing to report are omitted.';

grant execute on function report_leave_usage(integer) to authenticated;
