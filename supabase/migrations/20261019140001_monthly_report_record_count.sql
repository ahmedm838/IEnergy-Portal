-- =====================================================================
-- The monthly report counts the days it is built from.
--
-- Every figure on the run comes from the attendance records in the
-- period, and the report never said how many that was. An employee with
-- twelve records in a twenty-six day period is not a payroll question
-- about allowances, it is a question about the twelve days nobody
-- recorded -- and until now the only way to see that was to open the
-- employee report for each person in turn.
--
-- The count is of attendance records, not of adjustments. Somebody who
-- appears on the run only because they were paid a bonus shows zero,
-- which is exactly the row worth looking at twice.
--
-- The grouping that produces it is already there -- the att CTE groups
-- the same rows to sum meals and overtime -- so this adds a count to a
-- scan that was happening anyway, not a second pass over the table.
--
-- The return type changes, which create or replace cannot do, so the
-- function is dropped and rebuilt. Everything else is unchanged from
-- 20261015140001; the execute grant is restored at the end.
-- =====================================================================

drop function if exists report_monthly(date, date, numeric, smallint);

create function report_monthly(
  p_from      date,
  p_to        date,
  p_meal_rate numeric  default null,
  p_site_id   smallint default null
)
returns table (
  employee_id       uuid,
  code              integer,
  name              text,
  si_no             text,
  title             text,
  site              text,
  department        text,
  records           integer,
  meals             numeric,
  transport         numeric,
  total_allowances  numeric,
  incentive         numeric,
  bonus             numeric,
  adjustments       numeric,
  overtime          numeric,
  late_hours        numeric,
  deducted_hours    numeric,
  deducted_leaves   numeric,
  absence_penalties numeric,
  total_deductions  numeric,
  salary_advance    numeric
)
language sql
stable
set search_path to 'public'
as $function$
  with cfg as (
    select coalesce(p_meal_rate, setting_numeric('meal_allowance_rate', 0)) as meal_rate,
           required_hours_per_day()                  as hpd,
           setting_numeric('late_grace_hours', 2)    as late_grace
  ),
  emp as (
    select e.id, e.code, e.name, e.si_no, e.title, e.site_id,
           e.has_meal, e.has_allowance, e.has_overtime, e.has_incentive, e.has_deductions,
           s.name as site_name, d.name as dept_name
      from employees e
      left join sites s              on s.id  = e.site_id
      left join departments d        on d.id  = e.department_id
      left join employee_statuses st on st.id = e.status_id
     where coalesce(st.in_payroll, true)
       and e.is_active
       and (p_site_id is null or e.site_id = p_site_id)
       -- Only people with activity in the period. An all-zero row is not
       -- payroll data, it is noise that buries the rows that matter.
       --
       -- Adjustments count as activity, not just attendance: someone paid a
       -- bonus in a month they never clocked in -- a leaver, or a payment
       -- made in arrears -- still belongs on the run, and filtering on
       -- attendance alone would drop that money silently.
       and (
         exists (
           select 1 from attendance_records r
            where r.employee_id = e.id
              and r.work_date between p_from and p_to
         )
         or exists (
           select 1 from adjustments a
            where a.employee_id = e.id
              and a.adj_date between p_from and p_to
         )
       )
  ),
  att as (
    select r.employee_id,
           count(*)                                      as record_count,
           sum(t.meal_multiplier)                        as meal_units,
           sum(r.transport)                              as transport_total,
           sum(t.overtime_hours)                         as overtime_hours,
           sum(r.late_minutes)                           as late_minutes,
           count(*) filter (where t.effect = 'deducted') as deducted_leaves
      from attendance_records r
      join attendance_types t on t.id = r.attendance_type_id
     where r.work_date between p_from and p_to
     group by r.employee_id
  ),
  adj as (
    select a.employee_id,
           sum(a.incentive)        as incentive,
           sum(a.bonus)            as bonus,
           sum(a.salary_adjust)    as salary_adjust,
           sum(a.salary_advance)   as salary_advance,
           sum(a.penalties)        as penalties,
           sum(a.adjusted_days)    as adjusted_days,
           sum(a.adjusted_minutes) as adjusted_minutes
      from adjustments a
     where a.adj_date between p_from and p_to
     group by a.employee_id
  )
  select
    emp.id, emp.code, emp.name, emp.si_no, emp.title, emp.site_name, emp.dept_name,
    -- Nobody recorded is zero, not null: a blank cell reads as "unknown"
    -- and this is known.
    coalesce(att.record_count, 0)::integer,
    m.meals,
    m.transport,
    round(m.meals * cfg.meal_rate + m.transport, 2),
    m.incentive,
    m.bonus,
    m.salary_adjust,
    m.overtime,
    m.late_hours,
    m.deducted_hours,
    m.deducted_leaves,
    m.absence_penalties,
    round((m.deducted_leaves + m.absence_penalties) * cfg.hpd + m.deducted_hours, 2),
    m.salary_advance
  from emp
  cross join cfg
  left join att on att.employee_id = emp.id
  left join adj on adj.employee_id = emp.id
  cross join lateral (
    select
      round(case when emp.has_meal      then coalesce(att.meal_units, 0)      else 0 end, 2) as meals,
      round(case when emp.has_allowance then coalesce(att.transport_total, 0) else 0 end, 2) as transport,
      round(case when emp.has_incentive then coalesce(adj.incentive, 0)       else 0 end, 2) as incentive,
      round(coalesce(adj.bonus, 0), 2)                                                       as bonus,
      round(coalesce(adj.salary_adjust, 0), 2)                                               as salary_adjust,
      round(case when emp.has_overtime  then coalesce(att.overtime_hours, 0)  else 0 end, 2) as overtime,
      round(coalesce(adj.salary_advance, 0), 2)                                              as salary_advance,
      round(coalesce(att.late_minutes, 0) / 60.0, 2)                                         as late_hours,
      round(case when emp.has_deductions
                 then  coalesce(adj.penalties, 0)        * cfg.hpd
                     - coalesce(adj.adjusted_days, 0)    * cfg.hpd
                     - coalesce(adj.adjusted_minutes, 0) / 60.0
                     - greatest(
                         0,
                         coalesce(att.late_minutes, 0) / 60.0 - cfg.late_grace
                       )
                 else 0 end, 2)                                                              as deducted_hours,
      case when emp.has_deductions
           then coalesce(att.deducted_leaves, 0)::numeric else 0 end                         as deducted_leaves,
      case when emp.has_deductions
           then absence_penalty_days(emp.id, p_from, p_to) else 0 end                        as absence_penalties
  ) m
  order by emp.code;
$function$;

comment on function report_monthly(date, date, numeric, smallint) is
  'One row per employee with payroll activity in the period: allowances, overtime, deductions, and the number of attendance records the figures were built from. Runs as the caller, so row level security applies.';

grant execute on function report_monthly(date, date, numeric, smallint) to authenticated;
