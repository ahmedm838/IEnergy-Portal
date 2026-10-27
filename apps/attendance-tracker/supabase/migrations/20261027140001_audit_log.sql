-- =====================================================================
-- A change log: who changed what, when, and what it was before.
--
-- READ THIS FIRST. Nothing in this database has ever recorded a change.
-- attendance_records, adjustments and employees each carry updated_at
-- and updated_by, which say who touched the row last and when -- and are
-- overwritten by the next edit, and never held the previous value. So
-- "changed 14 Oct for 240006 from Attended to Absent" cannot be
-- reconstructed for anything that has already happened. There is no
-- backup of it to mine and no shadow copy to read. The log starts empty
-- and fills from the moment this is applied.
--
-- WHAT IS RECORDED. Every insert, update and delete on the four tables
-- that hold decisions somebody made:
--
--   attendance_records  the day-to-day entries -- the example above
--   adjustments         money: incentive, bonus, penalties, advances
--   employees           personnel, pay terms, role, employment status
--   app_settings        the rates and rules on the Settings page
--
-- The lookup tables are not audited. They are reference data a super
-- admin maintains, not decisions about a person, and auditing them would
-- bury the rows that matter under renames of a bus route.
--
-- WHAT IS NOT RECORDED. Reads. Nobody is logged for looking at a record,
-- only for changing one.
--
-- NAMES ARE RESOLVED WHEN THE CHANGE HAPPENS, not when the log is read.
-- An audit line has to stay true: if the type called "Absent" is renamed
-- next year, the entry still has to say what the person saw and chose at
-- the time. The same goes for who did it -- actor_name is written in,
-- so the line survives that employee being renamed or deleted.
--
-- SENSITIVE DATA. Auditing employees means old and new values of
-- national_id, wages and leave balances land in this table. That is what
-- an audit log is for, but it is a second place those values live, so
-- the table is readable by admins only, has no client write grant at
-- all, and is written solely by the trigger below, which is SECURITY
-- DEFINER precisely so that no one needs insert rights on it.
-- =====================================================================

create table if not exists audit_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  actor_id    uuid,
  -- Written in rather than joined later: see above.
  actor_name  text,
  actor_role  text,
  table_name  text not null,
  op          text not null check (op in ('insert', 'update', 'delete')),
  row_id      text,
  -- Whose record this was, where the row belongs to somebody.
  employee_id uuid,
  employee_code integer,
  employee_name text,
  -- What the change was about: a work date, an adjustment date, a
  -- setting key. Enough to say which record without opening it.
  subject     text,
  -- [{"field": "Attendance type", "from": "Attended", "to": "Absent"}, ...]
  -- Only the fields that actually changed.
  changes     jsonb not null default '[]'::jsonb
);

create index if not exists audit_log_at_idx       on audit_log (at desc);
create index if not exists audit_log_employee_idx on audit_log (employee_id);
create index if not exists audit_log_table_idx    on audit_log (table_name);

comment on table audit_log is
  'Who changed what and when, with the previous value. Written by trigger only; starts from the day it was added.';

-- ---------------------------------------------------------------------
-- Turning a stored value into the words somebody saw on screen.
--
-- A foreign key in the log is useless: "attendance_type_id 3 -> 7" is
-- not an audit line anybody can read. The handful of keys that appear on
-- these four tables are resolved here, and everything else is rendered
-- as itself.
-- ---------------------------------------------------------------------
create or replace function audit_value_label(p_column text, p_value jsonb)
returns text
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_id   bigint;
  v_text text;
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then
    return '(blank)';
  end if;

  if jsonb_typeof(p_value) = 'boolean' then
    return case when p_value::text = 'true' then 'yes' else 'no' end;
  end if;

  -- Only numeric keys are worth a lookup; anything else is already text.
  if jsonb_typeof(p_value) = 'number' then
    v_id := (p_value #>> '{}')::bigint;
    case p_column
      when 'attendance_type_id' then
        select name_en into v_text from attendance_types where id = v_id;
      when 'status_id' then
        select name into v_text from employee_statuses where id = v_id;
      when 'site_id' then
        select name into v_text from sites where id = v_id;
      when 'department_id' then
        select name into v_text from departments where id = v_id;
      when 'bus_route_id' then
        select name into v_text from bus_routes where id = v_id;
      when 'qualification_degree_id' then
        select name_en into v_text from qualification_degrees where id = v_id;
      else v_text := null;
    end case;
    if v_text is not null then
      return v_text;
    end if;
  end if;

  -- #>> '{}' unwraps a json string without leaving its quotes behind.
  return p_value #>> '{}';
end $function$;

-- ---------------------------------------------------------------------
-- The column names, as the people using the site know them.
--
-- Unlisted columns fall back to the column name with its underscores
-- opened out, so a column added later still reads as something rather
-- than being dropped from the log.
-- ---------------------------------------------------------------------
create or replace function audit_field_label(p_column text)
returns text
language sql
immutable
as $function$
  select coalesce(
    (select v from (values
      ('attendance_type_id', 'Attendance type'),
      ('work_date',          'Work date'),
      ('late_minutes',       'Late (minutes)'),
      ('transport',          'Transport'),
      ('add_to_leave_balance', 'Add to leave balance'),
      ('clock_in',           'Clock in'),
      ('clock_out',          'Clock out'),
      ('adj_date',           'Adjustment date'),
      ('salary_adjust',      'Salary adjustment'),
      ('adjusted_minutes',   'Adjusted hours (minutes)'),
      ('status_id',          'Employment status'),
      ('site_id',            'Site'),
      ('department_id',      'Department'),
      ('bus_route_id',       'Bus route'),
      ('qualification_degree_id', 'Degree'),
      ('si_no',              'S.I. No.'),
      ('si_code',            'S.I. code'),
      ('si_basic_wage',      'S.I. basic wage'),
      ('si_gross_wage',      'S.I. gross wage'),
      ('national_id',        'ID No.'),
      ('annual_leave_balance',    'Annual leave (days)'),
      ('unplanned_leave_balance', 'Un-planned leave (days)'),
      ('auth_user_id',       'Linked account'),
      ('value',              'Value')
    ) as t(k, v) where t.k = p_column),
    initcap(replace(p_column, '_', ' ')));
$function$;

-- ---------------------------------------------------------------------
-- The trigger. One function for all four tables.
--
-- SECURITY DEFINER so that nothing needs an insert grant on audit_log:
-- the only way a row gets in is by changing one of the audited tables.
-- ---------------------------------------------------------------------
create or replace function write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  /* Assigned in the body, not here. OLD does not exist on an INSERT and
     NEW does not exist on a DELETE, and a CASE in a default expression
     is a bet on the planner not touching the branch it will not use.
     An IF cannot reach the wrong one at all. */
  v_old       jsonb := '{}'::jsonb;
  v_new       jsonb := '{}'::jsonb;
  v_row       jsonb;
  v_changes   jsonb := '[]'::jsonb;
  v_key       text;
  v_emp_id    uuid;
  v_subject   text;
  v_actor     employees%rowtype;
  v_code      integer;
  v_name      text;
begin
  if tg_op <> 'INSERT' then v_old := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then v_new := to_jsonb(new); end if;
  v_row := case when tg_op = 'DELETE' then v_old else v_new end;

  -- Housekeeping columns are not changes anybody made.
  for v_key in
    select k from jsonb_object_keys(v_old || v_new) as k
     where k not in ('id', 'created_at', 'created_by', 'updated_at', 'updated_by')
     order by k
  loop
    if (v_old -> v_key) is distinct from (v_new -> v_key) then
      v_changes := v_changes || jsonb_build_object(
        'field', audit_field_label(v_key),
        'from',  case when tg_op = 'INSERT' then null
                      else audit_value_label(v_key, v_old -> v_key) end,
        'to',    case when tg_op = 'DELETE' then null
                      else audit_value_label(v_key, v_new -> v_key) end);
    end if;
  end loop;

  -- An update that changed only updated_at is not worth a line.
  if tg_op = 'UPDATE' and v_changes = '[]'::jsonb then
    return null;
  end if;

  -- Whose record, and which one.
  case tg_table_name
    when 'attendance_records' then
      v_emp_id  := (v_row ->> 'employee_id')::uuid;
      v_subject := 'Attendance ' || coalesce(v_row ->> 'work_date', '');
    when 'adjustments' then
      v_emp_id  := (v_row ->> 'employee_id')::uuid;
      v_subject := 'Adjustment ' || coalesce(v_row ->> 'adj_date', '');
    when 'employees' then
      v_emp_id  := (v_row ->> 'id')::uuid;
      v_subject := 'Employee record';
    else
      v_emp_id  := null;
      v_subject := 'Setting ' || coalesce(v_row ->> 'key', '');
  end case;

  if v_emp_id is not null then
    select code, name into v_code, v_name from employees where id = v_emp_id;
  end if;

  -- auth.uid() is null for direct SQL -- the editor, a migration, the
  -- service role. Saying so is better than an empty column.
  select * into v_actor from employees where auth_user_id = auth.uid() limit 1;

  insert into audit_log (
    actor_id, actor_name, actor_role, table_name, op, row_id,
    employee_id, employee_code, employee_name, subject, changes)
  values (
    auth.uid(),
    coalesce(v_actor.name, case when auth.uid() is null
                                then 'Database (direct SQL)' else 'Unknown account' end),
    coalesce(v_actor.role::text, case when auth.uid() is null then 'system' else 'unknown' end),
    tg_table_name,
    lower(tg_op),
    coalesce(v_row ->> 'id', v_row ->> 'key'),
    v_emp_id, v_code, v_name, v_subject, v_changes);

  return null;

/* Logging must never be able to refuse a save.

   This trigger sits on attendance_records, which is the busiest write
   path in the application: somebody filling a month of workdays writes
   thirty rows in a go. If anything in here raised -- a lookup against a
   column that gets renamed later, a type that stops casting -- it would
   abort their save and the page would report a failure they could do
   nothing about, for the sake of a log entry.

   So a failure here loses the log line and nothing else. It is raised as
   a warning rather than swallowed, so it reaches the Postgres log
   instead of disappearing: a log that quietly stops recording is worse
   than one that visibly breaks. */
exception when others then
  raise warning 'audit_log write failed for % on %: %', tg_op, tg_table_name, sqlerrm;
  return null;
end $function$;

comment on function write_audit_log() is
  'Writes one audit_log row per insert, update or delete, with field names and values as they read on screen at the time.';

-- AFTER triggers: the row is already committed-shape, and a FOR EACH ROW
-- AFTER trigger returning null changes nothing.
drop trigger if exists attendance_records_audit on attendance_records;
create trigger attendance_records_audit
  after insert or update or delete on attendance_records
  for each row execute function write_audit_log();

drop trigger if exists adjustments_audit on adjustments;
create trigger adjustments_audit
  after insert or update or delete on adjustments
  for each row execute function write_audit_log();

drop trigger if exists employees_audit on employees;
create trigger employees_audit
  after insert or update or delete on employees
  for each row execute function write_audit_log();

drop trigger if exists app_settings_audit on app_settings;
create trigger app_settings_audit
  after insert or update or delete on app_settings
  for each row execute function write_audit_log();

-- ---------------------------------------------------------------------
-- Who may read it.
--
-- Admins and super admins, and nobody else -- a user cannot see their
-- colleagues' pay changes, and nobody at all may write, which is the
-- point of a log. No insert, update or delete grant is issued: the
-- trigger is SECURITY DEFINER and needs none.
-- ---------------------------------------------------------------------
alter table audit_log enable row level security;

drop policy if exists audit_log_read on audit_log;
create policy audit_log_read on audit_log
  for select to authenticated
  using (is_admin());

revoke all on audit_log from authenticated;
grant select on audit_log to authenticated;

-- ---------------------------------------------------------------------
-- What the export reads: one row per change, already in words.
--
-- Runs as the caller, so the policy above decides what comes back.
-- ---------------------------------------------------------------------
create or replace function report_audit_log(p_from date, p_to date)
returns table (
  changed_on   date,
  changed_at   text,
  actor        text,
  actor_role   text,
  action       text,
  record       text,
  employee_code integer,
  employee_name text,
  change       text
)
language sql
stable
set search_path = public
as $function$
  select
    (a.at at time zone 'Africa/Cairo')::date                 as changed_on,
    to_char(a.at at time zone 'Africa/Cairo', 'HH24:MI:SS')  as changed_at,
    a.actor_name,
    a.actor_role,
    initcap(a.op),
    a.subject,
    a.employee_code,
    a.employee_name,
    -- "Attendance type: Attended -> Absent; Late (minutes): 0 -> 30"
    coalesce((
      select string_agg(
               c ->> 'field' ||
               case
                 when a.op = 'insert' then ' set to ' || coalesce(c ->> 'to', '(blank)')
                 when a.op = 'delete' then ' was ' || coalesce(c ->> 'from', '(blank)')
                 else ': ' || coalesce(c ->> 'from', '(blank)') ||
                      ' -> ' || coalesce(c ->> 'to', '(blank)')
               end, '; ' order by c ->> 'field')
        from jsonb_array_elements(a.changes) as c), '')
  from audit_log a
  where (a.at at time zone 'Africa/Cairo')::date between p_from and p_to
  order by a.at desc, a.id desc;
$function$;

comment on function report_audit_log(date, date) is
  'The change log over a date range, in Cairo time, one line per change with the fields written out. Runs as the caller, so only an admin sees anything.';

grant execute on function
  report_audit_log(date, date),
  audit_value_label(text, jsonb),
  audit_field_label(text)
  to authenticated;
