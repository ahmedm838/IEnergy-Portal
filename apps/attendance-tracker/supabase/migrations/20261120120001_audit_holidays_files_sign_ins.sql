-- =====================================================================
-- The change log, widened:
--
--   1. Company holidays: every declare, change and delete.
--   2. Personnel file attachments replaced with a new file. An upload or
--      a delete already shows, as the box being ticked or unticked; a
--      replacement changes no box, so the cPanel script reports it here.
--   3. Sign-ins and password changes, read off auth.users.
--
-- Plus verify_my_password(), so the "Change password" panel can check
-- the current password without signing in again (which would log a
-- sign-in that never happened).
--
-- Events that are not a row being inserted, updated or deleted -- a
-- sign-in, a password change, a file replaced -- are written with op
-- 'event' and read out by the export as "Event".
-- =====================================================================

alter table audit_log drop constraint if exists audit_log_op_check;
alter table audit_log add constraint audit_log_op_check
  check (op in ('insert', 'update', 'delete', 'event'));

-- ---------------------------------------------------------------------
-- 1. Company holidays. The same trigger as the other tables; only the
--    subject line is new.
-- ---------------------------------------------------------------------
create or replace function write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
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

  if tg_op = 'UPDATE' and v_changes = '[]'::jsonb then
    return null;
  end if;

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
    when 'company_holidays' then
      v_emp_id  := null;
      v_subject := 'Company holiday ' || coalesce(v_row ->> 'holiday_date', '');
    else
      v_emp_id  := null;
      v_subject := 'Setting ' || coalesce(v_row ->> 'key', '');
  end case;

  if v_emp_id is not null then
    select code, name into v_code, v_name from employees where id = v_emp_id;
  end if;

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

-- Logging must never be able to refuse a save: see 20261027140001.
exception when others then
  raise warning 'audit_log write failed for % on %: %', tg_op, tg_table_name, sqlerrm;
  return null;
end $function$;

drop trigger if exists company_holidays_audit on company_holidays;
create trigger company_holidays_audit
  after insert or update or delete on company_holidays
  for each row execute function write_audit_log();

-- ---------------------------------------------------------------------
-- 2. A personnel file attachment replaced.
--
-- Called by api/employee-file.php with the uploader's own token, after
-- the new file is in place over an old one. Admins only, as the upload
-- itself is; the actor is whoever the token belongs to, never a value
-- the caller passes.
-- ---------------------------------------------------------------------
create or replace function log_employee_file(p_employee_id uuid, p_doc text, p_action text)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_actor employees%rowtype;
  v_emp   employees%rowtype;
begin
  if not is_admin() then
    raise exception 'Only admins can change personnel files.' using errcode = '42501';
  end if;
  if p_action not in ('replaced') then
    raise exception 'Unknown file action %', p_action;
  end if;
  if p_doc !~ '^doc_[a-z0-9_]+$' then
    raise exception 'Unknown document %', p_doc;
  end if;
  select * into v_emp from employees where id = p_employee_id;
  if not found then
    raise exception 'No such employee';
  end if;
  select * into v_actor from employees where auth_user_id = auth.uid() limit 1;

  insert into audit_log (
    actor_id, actor_name, actor_role, table_name, op, row_id,
    employee_id, employee_code, employee_name, subject, changes)
  values (
    auth.uid(), coalesce(v_actor.name, 'Unknown account'), coalesce(v_actor.role::text, 'unknown'),
    'employee_files', 'event', p_employee_id::text,
    v_emp.id, v_emp.code, v_emp.name, 'Personnel file',
    jsonb_build_array(jsonb_build_object(
      'field', audit_field_label(p_doc), 'from', null, 'to', 'File replaced with a new one')));
end $function$;

revoke all on function log_employee_file(uuid, text, text) from public, anon;
grant execute on function log_employee_file(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Sign-ins and password changes.
--
-- Supabase Auth writes last_sign_in_at on every sign-in with a password
-- (not on the silent token refreshes in between), and encrypted_password
-- on every password change. Both are read here.
--
-- auth.uid() is not set inside Auth's own requests, so who did it is
-- read from the account itself: a sign-in and a password the user chose
-- are that user's. A temporary password is the other case -- only a
-- super admin can set one (set-employee-password), and it is the one
-- that raises must_set_password.
--
-- Like the rest of the log, this must never stop anybody signing in.
-- ---------------------------------------------------------------------
create or replace function audit_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_emp  employees%rowtype;
  v_temp boolean;
begin
  select * into v_emp from employees where auth_user_id = new.id limit 1;

  if new.last_sign_in_at is distinct from old.last_sign_in_at and new.last_sign_in_at is not null then
    insert into audit_log (
      at, actor_id, actor_name, actor_role, table_name, op, row_id,
      employee_id, employee_code, employee_name, subject, changes)
    values (
      new.last_sign_in_at, new.id, coalesce(v_emp.name, new.email), coalesce(v_emp.role::text, 'unknown'),
      'accounts', 'event', new.id::text,
      v_emp.id, v_emp.code, v_emp.name, 'Sign in',
      jsonb_build_array(jsonb_build_object('field', 'Account', 'from', null, 'to', 'Signed in')));
  end if;

  if new.encrypted_password is distinct from old.encrypted_password then
    v_temp := coalesce((new.raw_user_meta_data ->> 'must_set_password')::boolean, false);
    insert into audit_log (
      actor_id, actor_name, actor_role, table_name, op, row_id,
      employee_id, employee_code, employee_name, subject, changes)
    values (
      case when v_temp then null else new.id end,
      case when v_temp then 'Super admin' else coalesce(v_emp.name, new.email) end,
      case when v_temp then 'super_admin' else coalesce(v_emp.role::text, 'unknown') end,
      'accounts', 'event', new.id::text,
      v_emp.id, v_emp.code, v_emp.name, 'Password',
      jsonb_build_array(jsonb_build_object('field', 'Password', 'from', null,
        'to', case when v_temp then 'Temporary password set by a super admin'
                   else 'Changed by the user' end)));
  end if;

  return null;
exception when others then
  raise warning 'audit_log write failed for auth.users %: %', new.id, sqlerrm;
  return null;
end $function$;

revoke all on function audit_auth_user() from public, anon, authenticated;

drop trigger if exists auth_users_audit on auth.users;
create trigger auth_users_audit
  after update of last_sign_in_at, encrypted_password on auth.users
  for each row execute function public.audit_auth_user();

-- ---------------------------------------------------------------------
-- The current password, checked for the signed-in user only.
-- ---------------------------------------------------------------------
create or replace function verify_my_password(p_password text)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $function$
  select exists (
    select 1 from auth.users u
     where u.id = auth.uid()
       and u.encrypted_password is not null
       and u.encrypted_password = extensions.crypt(p_password, u.encrypted_password));
$function$;

revoke all on function verify_my_password(text) from public, anon;
grant execute on function verify_my_password(text) to authenticated;

-- ---------------------------------------------------------------------
-- The export: events read as what happened.
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
    coalesce((
      select string_agg(
               c ->> 'field' ||
               case
                 when a.op = 'event'  then ': ' || coalesce(c ->> 'to', '')
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
