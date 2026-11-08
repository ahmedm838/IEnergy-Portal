-- =====================================================================
-- Who the "+3 other" on a declared day actually is.
--
-- The list already counts, per declared day, how many employees hold
-- that day as something other than the day's own type. The count is
-- the warning; the names are what you act on. They are also what
-- delete takes by surprise, so being able to see them before pressing
-- it matters more here than on most tables.
--
-- Fetched when asked for rather than returned with every row: it is a
-- handful of people on a handful of days, and loading every name for
-- every declared day to show one of them would be the wrong trade.
--
-- SECURITY INVOKER. attendance_records is read through
-- can_see_employee(), so a user who may only see their own department
-- gets only the names from it -- the same rows they would see on any
-- other page. The count beside it is read the same way, so the two
-- agree.
-- =====================================================================

create or replace function list_company_holiday_others(p_id bigint)
returns table (
  code    integer,
  name    text,
  type_en text,
  type_ar text
)
language sql
stable
security invoker
set search_path = public
as $$
  select e.code, e.name, t.name_en, t.name_ar
    from company_holidays h
    join attendance_records r
      on r.work_date = h.holiday_date
     and r.attendance_type_id <> h.attendance_type_id
    join employees e       on e.id = r.employee_id
    join attendance_types t on t.id = r.attendance_type_id
   where h.id = p_id
   order by e.name;
$$;

comment on function list_company_holiday_others(bigint) is
  'Employees who hold a declared day as something other than that day''s own attendance type, with what they hold it as.';

grant execute on function list_company_holiday_others(bigint) to authenticated;

notify pgrst, 'reload schema';
