-- =====================================================================
-- Hours report: employees who are NOT paid overtime.
--
-- An employee with the Overtime switch off earns nothing extra for the
-- hours recorded against the overtime attendance types, so what matters
-- for them is the plain arithmetic of hours owed against hours worked.
-- That figure is buried in the monthly report, which exists to produce
-- payroll components rather than to answer "did this person work their
-- hours".
--
-- Worked hours come from clock in / clock out, so a day with no times
-- entered counts as zero worked, not as absent. days_with_times is
-- reported alongside so an unexpectedly large shortage can be read as
-- missing clock entries rather than missing work.
-- =====================================================================

create or replace function report_hours(
  p_from    date,
  p_to      date,
  p_site_id smallint default null
)
returns table (
  employee_id      uuid,
  code             integer,
  name             text,
  si_no            text,
  title            text,
  site             text,
  department       text,
  days_recorded    integer,
  working_days     integer,
  days_with_times  integer,
  required_hours   numeric,
  worked_hours     numeric,
  hours_variance   numeric,
  late_hours       numeric,
  absence_days     integer
)
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as (
    select required_hours_per_day() as hpd
  ),
  emp as (
    select e.id, e.code, e.name, e.si_no, e.title, e.site_id,
           s.name as site_name, d.name as dept_name
      from employees e
      left join sites s              on s.id  = e.site_id
      left join departments d        on d.id  = e.department_id
      left join employee_statuses st on st.id = e.status_id
     where e.is_active
       and coalesce(st.in_payroll, true)
       -- the whole point of the report
       and e.has_overtime = false
       and (p_site_id is null or e.site_id = p_site_id)
  ),
  att as (
    select r.employee_id,
           count(*)::int                                          as days_recorded,
           count(*) filter (where t.is_working_day)::int           as working_days,
           count(*) filter (
             where r.clock_in is not null and r.clock_out is not null
           )::int                                                  as days_with_times,
           coalesce(sum(worked_hours(r.clock_in, r.clock_out)), 0) as worked_hours,
           coalesce(sum(r.late_minutes), 0)                        as late_minutes,
           count(*) filter (where t.effect = 'absence')::int       as absence_days
      from attendance_records r
      join attendance_types t on t.id = r.attendance_type_id
     where r.work_date between p_from and p_to
     group by r.employee_id
  )
  select
    emp.id, emp.code, emp.name, emp.si_no, emp.title, emp.site_name, emp.dept_name,
    att.days_recorded,
    att.working_days,
    att.days_with_times,
    round(att.working_days * cfg.hpd, 2),
    round(att.worked_hours, 2),
    round(att.worked_hours - att.working_days * cfg.hpd, 2),
    round(att.late_minutes / 60.0, 2),
    att.absence_days
  from emp
  cross join cfg
  -- Inner join on purpose: somebody with nothing recorded in the period has
  -- no hours to report, and a row of zeros only hides the ones that matter.
  join att on att.employee_id = emp.id
  order by emp.code;
$$;

comment on function report_hours(date, date, smallint) is
  'Hours owed against hours worked, for employees whose Overtime switch is off.';

grant execute on function report_hours(date, date, smallint) to authenticated;
