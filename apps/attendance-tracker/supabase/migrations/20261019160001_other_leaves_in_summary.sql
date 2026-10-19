-- =====================================================================
-- The leave days that fall outside the three balances.
--
-- The balances cover annual, un-planned and added days. A sick leave, a
-- deducted leave or a granted day is a day off that appears in none of
-- them, so somebody reading their balances saw three rows that did not
-- add up to the days they remembered taking.
--
-- What counts, and why:
--   * not a working day     -- an attended day is not a leave
--   * not already a balance -- annual, un-planned, added days
--   * not an absence        -- that is reported as the absence penalty
--   * not weekly rest, a holiday, or No Status -- nobody takes those;
--     they happen to everybody, or mean nothing was recorded
-- Which today leaves exactly sick leave, deducted leave and granted day,
-- and will pick up any future leave type without being edited.
--
-- The per-type breakdown is returned alongside the count, so the figure
-- can be read rather than trusted: whatever is in it, says so.
--
-- Returned as its own keys rather than a fourth entry in balances --
-- these days have no entitlement to count against, and the balances
-- array is rendered by the employee report and its export too.
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
  'One employee over a period: hours against requirement, late, transport, meals, overtime, deducted leaves in days and hours, absence penalty, the calendar-year leave balances, and the leave days those balances do not account for. Runs as the caller, so row level security applies.';

grant execute on function report_employee_summary(uuid, date, date) to authenticated;
