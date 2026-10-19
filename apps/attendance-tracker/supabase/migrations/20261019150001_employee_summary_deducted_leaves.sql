-- =====================================================================
-- The employee summary reports deducted leaves, in hours.
--
-- A deducted leave is a day taken with no balance behind it, and on the
-- monthly report it is worth a day's hours off the pay. The employee
-- report -- the page somebody opens to answer "why is this person's
-- deduction what it is" -- counted the day under Days by type and never
-- said what it cost.
--
-- Both are returned: the count, because that is what was recorded, and
-- the hours, because that is what it is worth. The hours are the count
-- times the required hours per day, the same arithmetic the monthly
-- report does.
--
-- Like the absence penalty beside it, this is what happened, not what
-- payroll did with it: an employee whose Deductions switch is off still
-- took the day, and the monthly report is where the switch applies.
--
-- Nothing else changes: the effect column joins a scan already reading
-- these rows, and the function returns jsonb, so no caller breaks on an
-- added key.
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
      coalesce(sum(meal_multiplier), 0)::numeric                   as meal_units,
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
    select t.effect, r.add_to_leave_balance
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
  from totals t, leave l;

  return v_result;
end $function$;

comment on function report_employee_summary(uuid, date, date) is
  'One employee over a period: hours against requirement, late, transport, meals, overtime, deducted leaves in days and hours, absence penalty, and the calendar-year leave balances. Runs as the caller, so row level security applies.';

grant execute on function report_employee_summary(uuid, date, date) to authenticated;
