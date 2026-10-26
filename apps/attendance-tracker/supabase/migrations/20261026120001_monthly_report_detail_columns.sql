-- =====================================================================
-- Four more figures on the monthly report, for its detailed view.
--
-- The report already returned meals, transport, late hours, deducted
-- leaves and absence penalties -- the detailed view simply stops hiding
-- them. These four were not available at all:
--
--   adjusted_days    days granted on the Adjustments page
--   adjusted_hours   hours granted there, as hours rather than minutes
--   sick_leaves      days taken as sick leave
--   absence_days     days marked absent
--
-- The first two were already being computed inside this function: they
-- are subtracted when working out deducted_hours, and were simply never
-- returned. Nothing about the arithmetic changes here, only what comes
-- back out of it.
--
-- absence_days is counted by effect = 'absence', the same way
-- deducted_leaves is counted by effect = 'deducted'. Sick leave carries
-- no effect of its own -- it deducts nothing and earns nothing -- so it
-- is counted by code, which is the identifier Settings refuses to let
-- anybody rename.
--
-- absence_days is NOT absence_penalties. The penalty is what the policy
-- charges for a run of absences, worked out by absence_penalty_days();
-- this is the plain count of days marked absent. One can exceed the
-- other in either direction, which is exactly why somebody reading the
-- report wants to see both.
--
-- Dropped and recreated rather than replaced: CREATE OR REPLACE cannot
-- change a RETURNS TABLE, and the grant has to be made again after.
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
  salary_advance    numeric,
  -- Appended, so anything reading the old columns by position still
  -- reads the same thing.
  adjusted_days     numeric,
  adjusted_hours    numeric,
  sick_leaves       numeric,
  absence_days      numeric
)
language sql
stable
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
           count(*) filter (where t.effect = 'deducted') as deducted_leaves,
           count(*) filter (where t.effect = 'absence')  as absence_days,
           count(*) filter (where t.code = 'sick_leave') as sick_leaves
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
    m.salary_advance,
    m.adjusted_days,
    m.adjusted_hours,
    m.sick_leaves,
    m.absence_days
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
           then absence_penalty_days(emp.id, p_from, p_to) else 0 end                        as absence_penalties,
      -- The adjustment figures as entered, not netted off against
      -- anything. They are already folded into deducted_hours above; a
      -- reader wanting to know why that number moved needs them whole.
      round(coalesce(adj.adjusted_days, 0), 2)                                               as adjusted_days,
      round(coalesce(adj.adjusted_minutes, 0) / 60.0, 2)                                     as adjusted_hours,
      -- Counts of days, so no has_deductions gate: these say what
      -- happened, not what it costs. Somebody with deductions switched
      -- off still took the sick days.
      coalesce(att.sick_leaves, 0)::numeric                                                  as sick_leaves,
      coalesce(att.absence_days, 0)::numeric                                                 as absence_days
  ) m
  order by emp.code;
$function$;

comment on function report_monthly(date, date, numeric, smallint) is
  'One row per employee with activity in the period: allowances, adjustments, overtime and deductions, plus the detail the report hides until asked -- adjusted days and hours, sick leave and absence days. Runs as the caller, so row level security decides who is in it.';

grant execute on function report_monthly(date, date, numeric, smallint) to authenticated;
