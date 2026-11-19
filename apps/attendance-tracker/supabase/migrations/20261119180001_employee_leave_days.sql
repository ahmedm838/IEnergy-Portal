-- The days behind the dashboard's leave balances.
--
-- report_employee_summary counts the leave days of the calendar year;
-- this lists them, so a click on a balance row can show which days they
-- were. Same year, same rules for what counts as which kind, so the list
-- always adds up to the figure it was opened from:
--   annual      effect 'annual'
--   unplanned   effect 'unplanned'
--   added_used  effect 'added_days'
--   added       add_to_leave_balance (a day that earned an added day)
--   other       a non-working day none of the above, not absence, rest,
--               holiday or no status -- named by its type
-- SECURITY INVOKER: row level security decides whose days come back,
-- exactly as for the summary. Short keys keep the response small.
create or replace function public.report_employee_leave_days(p_employee_id uuid, p_to date)
returns jsonb
language sql
stable
set search_path to 'public'
as $$
  with year_rows as (
    select r.work_date, r.add_to_leave_balance, t.effect, t.code, t.name_en, t.is_working_day
      from attendance_records r
      join attendance_types t on t.id = r.attendance_type_id
     where r.employee_id = p_employee_id
       and r.work_date between date_trunc('year', p_to::timestamp)::date
                           and (date_trunc('year', p_to::timestamp) + interval '1 year - 1 day')::date
  ),
  kinds as (
    select work_date, 'annual' as k, null::text as n from year_rows where effect = 'annual'
    union all
    select work_date, 'unplanned', null from year_rows where effect = 'unplanned'
    union all
    select work_date, 'added_used', null from year_rows where effect = 'added_days'
    union all
    select work_date, 'added', null from year_rows where add_to_leave_balance
    union all
    select work_date, 'other', name_en from year_rows
     where not is_working_day
       and effect not in ('annual', 'unplanned', 'added_days', 'absence')
       and code not in ('weekly_rest', 'holiday', 'no_status')
  )
  select coalesce(jsonb_agg(jsonb_build_object('d', work_date, 'k', k, 'n', n) order by work_date), '[]'::jsonb)
    from kinds
$$;

grant execute on function public.report_employee_leave_days(uuid, date) to authenticated;
revoke execute on function public.report_employee_leave_days(uuid, date) from anon, public;
