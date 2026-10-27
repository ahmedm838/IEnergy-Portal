-- =====================================================================
-- The employee report counts no meals for somebody who is not on meals.
--
-- Every employee carries five payroll switches -- Meal, Allowance,
-- Overtime, Incentive, Deductions -- and the Meal one decides whether
-- meal units are earned at all. report_monthly has applied it since it
-- was written: its meals column is
--
--   case when emp.has_meal then coalesce(att.meal_units, 0) else 0 end
--
-- report_employee_summary never did. It summed meal_multiplier over the
-- attendance types in the range and returned it whatever the switch
-- said, so an employee with Meal unticked showed meal units on their own
-- report and zero on the monthly report that pays them -- the same
-- person, the same period, two different figures.
--
-- This makes the employee report agree with the one that pays, in the
-- same shape, so the next person reading them side by side can see they
-- are the same test.
--
-- Note what is NOT changed. meal_multiplier still comes off the
-- attendance type, and the rate is still applied on the monthly report
-- rather than here; this returns units, as it always has. Nothing about
-- hours, transport, overtime, leave balances or the absence penalty is
-- touched -- the other four switches are the monthly report's business,
-- which is where they are read.
--
-- Replaced whole rather than patched: the function returns jsonb, not a
-- table, so create or replace carries the existing signature and the
-- existing grant. The body below is 20261019160001's, with the meals
-- line changed and nothing else.
-- =====================================================================

create or replace function report_employee_summary(
  p_employee_id uuid,
  p_from        date,
  p_to          date
)
returns jsonb
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  v_year_start date    := date_trunc('year', p_to::timestamp)::date;
  v_year_end   date    := (date_trunc('year', p_to::timestamp) + interval '1 year - 1 day')::date;
  v_req        numeric := required_hours_per_day();
  v_emp        employees%rowtype;
  v_result     jsonb;
begin
  select * into v_emp from employees where id = p_employee_id;
  if not found then
    raise exception 'Employee % not found or not visible to you', p_employee_id
      using errcode = 'no_data_found';
  end if;

  with rows_in_range as (
    select r.late_minutes, r.transport, r.clock_in, r.clock_out,
           t.code as type_code, t.name_en, t.name_ar, t.effect,
           t.is_working_day, t.overtime_hours, t.meal_multiplier
      from attendance_records r
      join attendance_types t on t.id = r.attendance_type_id
     where r.employee_id = p_employee_id
       and r.work_date between p_from and p_to
  ),
  by_type as (
    select type_code, name_en, name_ar, count(*)::int as days
      from rows_in_range
     group by type_code, name_en, name_ar
  ),
  totals as (
    select
      coalesce(sum(late_minutes), 0)::int                          as late_minutes,
      coalesce(sum(transport), 0)::numeric                         as transport_total,
      -- Zero when this employee is not on meals. The Meal payroll
      -- switch decides whether meal units are earned at all, and the
      -- monthly report has always applied it; this function never did,
      -- so the two disagreed about the same employee. v_emp is loaded
      -- above, and a plpgsql variable is a bound parameter here, not a
      -- column, so it needs no place in a GROUP BY.
      (case when v_emp.has_meal
            then coalesce(sum(meal_multiplier), 0)
            else 0 end)::numeric                                   as meal_units,
      coalesce(sum(overtime_hours), 0)::numeric                    as overtime_hours,
      count(*) filter (where is_working_day)::int                  as working_days,
      count(*) filter (where effect = 'deducted')::int             as deducted_leaves,
      coalesce(sum(worked_hours(clock_in, clock_out)), 0)::numeric as worked_hours,
      avg(clock_in::interval)  filter (where clock_in  is not null) as avg_in,
      avg(clock_out::interval) filter (where clock_out is not null) as avg_out
    from rows_in_range
  ),
  -- Leave balances are a calendar-year figure, independent of the range.
  year_rows as (
    select t.effect, t.code as type_code, t.name_en, t.is_working_day,
           r.add_to_leave_balance
      from attendance_records r
      join attendance_types t on t.id = r.attendance_type_id
     where r.employee_id = p_employee_id
       and r.work_date between v_year_start and v_year_end
  ),
  leave as (
    select
      count(*) filter (where effect = 'annual')::numeric     as annual_used,
      count(*) filter (where effect = 'unplanned')::numeric  as unplanned_used,
      count(*) filter (where effect = 'added_days')::numeric as added_used,
      count(*) filter (where add_to_leave_balance)::numeric  as added_earned
    from year_rows
  ),
  other_rows as (
    select name_en, count(*)::int as days
      from year_rows
     where not is_working_day
       and effect not in ('annual', 'unplanned', 'added_days', 'absence')
       and type_code not in ('weekly_rest', 'holiday', 'no_status')
     group by name_en
  ),
  other as (
    select coalesce(sum(days), 0)::int as days,
           coalesce(
             (select jsonb_agg(to_jsonb(o) order by o.days desc, o.name_en) from other_rows o),
             '[]'::jsonb) as by_type
      from other_rows
  )
  select jsonb_build_object(
    'employee', jsonb_build_object(
        'id', v_emp.id, 'code', v_emp.code,
        'name', v_emp.name, 'title', v_emp.title),
    'range',      jsonb_build_object('from', p_from, 'to', p_to),
    'leave_year', jsonb_build_object('from', v_year_start, 'to', v_year_end),
    'day_counts', coalesce(
        (select jsonb_agg(to_jsonb(b) order by b.days desc, b.name_en) from by_type b),
        '[]'::jsonb),
    'late_minutes',   t.late_minutes,
    'transport_total', t.transport_total,
    'meal_units',     t.meal_units,
    'overtime_hours', t.overtime_hours,
    'working_days',   t.working_days,
    'deducted_leaves',      t.deducted_leaves,
    'deducted_leave_hours', round(t.deducted_leaves * v_req, 2),
    'required_hours', round(t.working_days * v_req, 2),
    'worked_hours',   round(t.worked_hours, 2),
    'hours_variance', round(t.worked_hours - t.working_days * v_req, 2),
    'avg_clock_in',   avg_time_text(t.avg_in),
    'avg_clock_out',  avg_time_text(t.avg_out),
    'absence_days',    absence_count(p_employee_id, p_from, p_to),
    'absence_penalty', absence_penalty_days(p_employee_id, p_from, p_to),
    -- Leave days in the calendar year that none of the balances below
    -- account for, with what they were.
    'other_leaves',       o.days,
    'other_leave_types',  o.by_type,
    'balances', jsonb_build_array(
      jsonb_build_object('label', 'Annual planned leaves',
        'balance',  v_emp.annual_leave_balance,
        'consumed', l.annual_used,
        'remaining', v_emp.annual_leave_balance - l.annual_used),
      jsonb_build_object('label', 'Un planned leaves',
        'balance',  v_emp.unplanned_leave_balance,
        'consumed', l.unplanned_used,
        'remaining', v_emp.unplanned_leave_balance - l.unplanned_used),
      jsonb_build_object('label', 'Added days',
        'balance',  l.added_earned,
        'consumed', l.added_used,
        'remaining', l.added_earned - l.added_used)
    )
  )
  into v_result
  from totals t, leave l, other o;

  return v_result;
end $function$;

comment on function report_employee_summary(uuid, date, date) is
  'One employee over a period: hours against requirement, late, transport, meals (zero unless the employee is on the Meal payroll switch), overtime, deducted leaves in days and hours, absence penalty, the calendar-year leave balances, and the leave days those balances do not account for. Runs as the caller, so row level security applies.';

grant execute on function report_employee_summary(uuid, date, date) to authenticated;
