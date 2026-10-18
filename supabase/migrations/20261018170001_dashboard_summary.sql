-- =====================================================================
-- One call for the dashboard, instead of shipping the period to the
-- browser to count it.
--
-- The page fetched every attendance row in the payroll period, for every
-- employee, on every visit -- and used it for three numbers and a list of
-- twelve names. Measured on 300 employees over 60 days (18,076 rows) that
-- query took about a second for an admin and eight for a user, before any
-- of it had crossed the network.
--
-- Deliberately SECURITY INVOKER. Row level security still applies inside,
-- so each role counts exactly the rows it is allowed to see and this adds
-- no new way to read anything. That also means it still pays the per-row
-- policy cost on a large period; that cost is a separate question and is
-- not quietly solved here.
-- =====================================================================

create or replace function dashboard_summary(p_from date, p_to date, p_today date)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $fn$
  with visible as (
    select id, code, name
      from employees
     where is_active
  ),
  period as (
    select employee_id, work_date
      from attendance_records
     where work_date between p_from and p_to
  ),
  today_recorded as (
    select distinct employee_id
      from period
     where work_date = p_today
  ),
  missing as (
    select v.id, v.code, v.name
      from visible v
     where not exists (
       select 1 from today_recorded t where t.employee_id = v.id
     )
  )
  select jsonb_build_object(
    'employees',          (select count(*) from visible),
    'records_this_month', (select count(*) from period),
    'recorded_today',     (select count(*) from today_recorded),
    -- The true count, which the page used to get wrong: it showed the
    -- length of the truncated list, so "12 of 300" however many were
    -- actually missing.
    'missing_count',      (select count(*) from missing),
    'missing_today', coalesce(
      (select jsonb_agg(jsonb_build_object('id', m.id, 'code', m.code, 'name', m.name))
         from (select * from missing order by code limit 12) m),
      '[]'::jsonb)
  );
$fn$;

comment on function dashboard_summary(date, date, date) is
  'Counts and the not-recorded-today list for the dashboard, aggregated in the database rather than in the browser.';

revoke all on function dashboard_summary(date, date, date) from public;
grant execute on function dashboard_summary(date, date, date) to authenticated;
