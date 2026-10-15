-- =====================================================================
-- Monthly report: the late term is subtracted, not added.
--
-- Deducted Hours = (Penalties * 8)
--                - (Adjusted Days * 8)
--                - Adjusted Hours
--                - max(0, late hours for the period - grace)
--
-- Note this means lateness beyond the grace REDUCES the deduction. That
-- is the specified behaviour; if a late penalty is ever meant to increase
-- the deduction instead, flip this one operator back.
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
security invoker
set search_path = public
as $$
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
  ),
  att as (
    select r.employee_id,
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
$$;

comment on function report_monthly(date, date, numeric, smallint) is
  'Monthly payroll input. Deducted Hours = penalties*hpd - adjusted_days*hpd - adjusted_hours - max(0, late_hours - late_grace_hours).';

grant execute on function report_monthly(date, date, numeric, smallint) to authenticated;
