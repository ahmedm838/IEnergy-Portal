-- =====================================================================
-- IEnergy Attendance Tracker — calculation layer
--
-- Every report is computed in the database rather than the browser so a
-- 500-employee / 31-day payroll run is one round trip, not 15 000 rows
-- pulled over the wire.
--
-- All report functions are SECURITY INVOKER: they see exactly what the
-- calling user's RLS policies allow, never more.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Settings helpers
-- ---------------------------------------------------------------------

create or replace function setting_numeric(p_key text, p_default numeric)
returns numeric
language sql
stable
set search_path = public
as $$
  select coalesce(
           (select (value #>> '{}')::numeric from app_settings where key = p_key),
           p_default);
$$;

-- Hours a full working day is expected to cover (the workbook's literal 8).
create or replace function required_hours_per_day()
returns numeric language sql stable
as $$ select setting_numeric('required_hours_per_day', 8); $$;

-- ---------------------------------------------------------------------
-- Absence Rule sheet — progressive, cumulative per calendar year
--
--   N = 0 -> 0        N = 2 -> 2.75       N >= 4 -> 7.75 + (N - 4) * 3
--   N = 1 -> 1.25     N = 3 -> 4.75
-- ---------------------------------------------------------------------

create or replace function absence_deduction(n integer)
returns numeric
language sql
immutable
as $$
  select case
    when n is null or n <= 0 then 0::numeric
    when n = 1 then 1.25::numeric
    when n = 2 then 2.75::numeric
    when n = 3 then 4.75::numeric
    else 7.75::numeric + (n - 4) * 3::numeric
  end;
$$;

comment on function absence_deduction(integer) is
  'Absence Rule sheet: cumulative deduction in days for N unauthorised absences in a calendar year.';

-- Unauthorised absence days for an employee between two dates.
-- Approved leave, holidays and weekly rest are excluded because only the
-- غياب / Absent Day type carries effect = ''absence''.
create or replace function absence_count(p_employee_id uuid, p_from date, p_to date)
returns integer
language sql
stable
set search_path = public
as $$
  select coalesce(count(*), 0)::integer
    from attendance_records r
    join attendance_types t on t.id = r.attendance_type_id
   where r.employee_id = p_employee_id
     and t.effect = 'absence'
     and r.work_date between p_from and p_to;
$$;

-- ---------------------------------------------------------------------
-- Penalty attributable to a period.
--
-- The scale is progressive, so a period's penalty is the *increment*:
--   D(absences through period end) - D(absences before period start)
-- evaluated inside each calendar year the period touches (rule 4: the
-- counter resets on 1 January). An employee taking their 4th absence of
-- the year is charged 3.00 days for it, not 1.25 — which is the whole
-- point of the rule, and what a naive per-month recount would get wrong.
-- ---------------------------------------------------------------------

create or replace function absence_penalty_days(p_employee_id uuid, p_from date, p_to date)
returns numeric
language sql
stable
set search_path = public
as $$
  with years as (
    select generate_series(
             date_trunc('year', p_from::timestamp),
             date_trunc('year', p_to::timestamp),
             interval '1 year'
           )::date as year_start
  ),
  bounds as (
    select year_start,
           greatest(year_start, p_from) as win_from,
           least((year_start + interval '1 year - 1 day')::date, p_to) as win_to
      from years
  )
  select coalesce(sum(
           absence_deduction(absence_count(p_employee_id, year_start, win_to))
           -
           absence_deduction(
             case when win_from > year_start
                  then absence_count(p_employee_id, year_start, win_from - 1)
                  else 0
             end)
         ), 0)::numeric
    from bounds;
$$;

-- ---------------------------------------------------------------------
-- Worked hours from clock in / clock out, tolerating overnight shifts.
-- ---------------------------------------------------------------------

create or replace function worked_hours(p_in time, p_out time)
returns numeric
language sql
immutable
as $$
  select case
    when p_in is null or p_out is null then 0::numeric
    when p_out >= p_in then round((extract(epoch from (p_out - p_in)) / 3600.0)::numeric, 4)
    else round(((extract(epoch from (p_out - p_in)) + 86400) / 3600.0)::numeric, 4)
  end;
$$;

-- Average a set of clock times, returned as 'HH24:MI' text.
create or replace function avg_time_text(p_avg interval)
returns text
language sql
immutable
as $$
  select case when p_avg is null then null
              else to_char(date '2000-01-01' + p_avg, 'HH24:MI')
         end;
$$;

-- =====================================================================
-- Report 1 — Employee report summary  ("employee report" sheet)
-- =====================================================================

create or replace function report_employee_summary(
  p_employee_id uuid,
  p_from        date,
  p_to          date
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
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
           t.code as type_code, t.name_en, t.name_ar,
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
end $$;

-- =====================================================================
-- Report 2 — Monthly payroll report  ("monthly report" sheet / Table8)
--
-- Workbook formulas reproduced exactly:
--   Total Allowances = meals * meal_rate + transport
--   Deducted Hours   = (Penalties + Adjusted Days) * 8 + Adjusted Hours
--   Total Deductions = (Deducted Leaves + Absence Penalties) * 8 + Deducted Hours
-- The literal 8 comes from app_settings.required_hours_per_day.
-- =====================================================================

create or replace function report_monthly(
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
           required_hours_per_day() as hpd
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
      round(case when emp.has_deductions
                 then (coalesce(adj.penalties, 0) + coalesce(adj.adjusted_days, 0)) * cfg.hpd
                      + coalesce(adj.adjusted_minutes, 0) / 60.0
                 else 0 end, 2)                                                              as deducted_hours,
      case when emp.has_deductions
           then coalesce(att.deducted_leaves, 0)::numeric else 0 end                         as deducted_leaves,
      case when emp.has_deductions
           then absence_penalty_days(emp.id, p_from, p_to) else 0 end                        as absence_penalties
  ) m
  order by emp.code;
$$;

-- =====================================================================
-- Bulk upsert for the month grid — one call instead of 31.
-- =====================================================================

create or replace function save_attendance_rows(p_rows jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count integer;
begin
  with incoming as (
    select
      (x->>'employee_id')::uuid            as employee_id,
      (x->>'work_date')::date              as work_date,
      (x->>'attendance_type_id')::smallint as attendance_type_id,
      coalesce((x->>'late_minutes')::int, 0)                as late_minutes,
      coalesce((x->>'transport')::numeric, 0)               as transport,
      coalesce((x->>'add_to_leave_balance')::boolean, false) as add_to_leave_balance,
      nullif(x->>'clock_in',  '')::time    as clock_in,
      nullif(x->>'clock_out', '')::time    as clock_out,
      nullif(x->>'note', '')               as note
    from jsonb_array_elements(p_rows) x
  ),
  upserted as (
    insert into attendance_records (
      employee_id, work_date, attendance_type_id, late_minutes, transport,
      add_to_leave_balance, clock_in, clock_out, note, created_by, updated_by
    )
    select employee_id, work_date, attendance_type_id, late_minutes, transport,
           add_to_leave_balance, clock_in, clock_out, note, auth.uid(), auth.uid()
      from incoming
    on conflict (employee_id, work_date) do update set
      attendance_type_id   = excluded.attendance_type_id,
      late_minutes         = excluded.late_minutes,
      transport            = excluded.transport,
      add_to_leave_balance = excluded.add_to_leave_balance,
      clock_in             = excluded.clock_in,
      clock_out            = excluded.clock_out,
      note                 = excluded.note,
      updated_by           = auth.uid(),
      updated_at           = now()
    returning 1
  )
  select count(*)::int into v_count from upserted;

  return v_count;
end $$;
