-- ============================================================
-- iEnergy Attendance Tracker - Supabase SQL (Leave Manager DB)
-- ============================================================
-- Run this SQL in the SAME Supabase project used by Leave Manager.
-- Reason: Supabase Auth (credentials) is per-project; using the same project
-- guarantees the Attendance Tracker uses the same users and the same tables.
--
-- This script is defensive:
-- - Works whether employees.id is UUID or BIGINT
-- - Works whether employees.user_id is UUID or TEXT
-- - Uses leave_types if present (leave_type_id), otherwise stores leave_type as TEXT
-- - Provides RLS: Admin full access, Users read only their own records
-- ============================================================

do $$
declare
  emp_id_type text;
  has_leave_types boolean;
  leave_id_type text;
  has_roles boolean;
  has_emp_role_id boolean;
  has_emp_role_text boolean;
begin
  -- Validate required base table
  if to_regclass('public.employees') is null then
    raise exception 'Required table public.employees not found. Run this in the Leave Manager database.';
  end if;

  -- Detect employees.id type
  select format_type(a.atttypid, a.atttypmod)
    into emp_id_type
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'employees'
    and a.attname = 'id'
    and a.attnum > 0
    and not a.attisdropped;

  if emp_id_type is null then
    raise exception 'Column public.employees.id not found.';
  end if;

  has_leave_types := (to_regclass('public.leave_types') is not null);
  if has_leave_types then
    select format_type(a.atttypid, a.atttypmod)
      into leave_id_type
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'leave_types'
      and a.attname = 'id'
      and a.attnum > 0
      and not a.attisdropped;
  end if;

  has_roles := (to_regclass('public.roles') is not null);
  select exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='employees' and column_name='role_id'
  ) into has_emp_role_id;

  select exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='employees' and column_name='role'
  ) into has_emp_role_text;

  -- =========================
  -- Table
  -- =========================
  if to_regclass('public.attendance_records') is null then
    if has_leave_types and leave_id_type is not null then
      execute format($sql$
        create table public.attendance_records (
          id bigserial primary key,
          employee_id %s not null references public.employees(id) on delete cascade,
          record_date date not null,
          sign_in time,
          sign_out time,
          leave_type_id %s references public.leave_types(id),
          working_hours numeric(6,2) not null default 0,
          notes text,
          created_by uuid default auth.uid(),
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now(),
          constraint attendance_unique_emp_day unique (employee_id, record_date),
          constraint attendance_sign_order_check
            check (
              (leave_type_id is not null)
              or (sign_in is not null and sign_out is not null and sign_out > sign_in)
            )
        );
      $sql$, emp_id_type, leave_id_type);
    else
      execute format($sql$
        create table public.attendance_records (
          id bigserial primary key,
          employee_id %s not null references public.employees(id) on delete cascade,
          record_date date not null,
          sign_in time,
          sign_out time,
          leave_type text,
          working_hours numeric(6,2) not null default 0,
          notes text,
          created_by uuid default auth.uid(),
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now(),
          constraint attendance_unique_emp_day unique (employee_id, record_date),
          constraint attendance_sign_order_check
            check (
              (leave_type is not null and btrim(leave_type) <> '')
              or (sign_in is not null and sign_out is not null and sign_out > sign_in)
            )
        );
      $sql$, emp_id_type);
    end if;

    execute 'create index if not exists idx_attendance_employee_date on public.attendance_records(employee_id, record_date);';
  end if;

  -- =========================
  -- updated_at trigger
  -- =========================
  execute $sql$
    create or replace function public.set_updated_at()
    returns trigger
    language plpgsql
    as $func$
    begin
      new.updated_at := now();
      return new;
    end;
    $func$;
  $sql$;

  execute $sql$
    do $inner$
    begin
      if not exists (select 1 from pg_trigger where tgname = 'trg_attendance_set_updated_at') then
        create trigger trg_attendance_set_updated_at
        before update on public.attendance_records
        for each row
        execute function public.set_updated_at();
      end if;
    end
    $inner$;
  $sql$;

  -- =========================
  -- Business rules trigger
  -- Leave => 08:00-16:00 and 8 hours
  -- Attendance => sign_in/out required and same-day order
  -- =========================
  execute $sql$
    create or replace function public.attendance_apply_rules()
    returns trigger
    language plpgsql
    as $func$
    declare
      is_leave boolean := false;
    begin
      if exists (
        select 1 from information_schema.columns
        where table_schema='public' and table_name='attendance_records' and column_name='leave_type_id'
      ) then
        is_leave := (new.leave_type_id is not null);
      else
        is_leave := (new.leave_type is not null and btrim(new.leave_type) <> '');
      end if;

      if is_leave then
        new.sign_in := time '08:00';
        new.sign_out := time '16:00';
        new.working_hours := 8;
      else
        if new.sign_in is null or new.sign_out is null then
          raise exception 'For attended days, sign_in and sign_out are required';
        end if;
        if new.sign_out <= new.sign_in then
          raise exception 'sign_out must be after sign_in (same day)';
        end if;
        new.working_hours := round(extract(epoch from (new.sign_out - new.sign_in)) / 3600.0, 2);
      end if;

      return new;
    end;
    $func$;
  $sql$;

  execute $sql$
    do $inner$
    begin
      if not exists (select 1 from pg_trigger where tgname = 'trg_attendance_apply_rules') then
        create trigger trg_attendance_apply_rules
        before insert or update on public.attendance_records
        for each row
        execute function public.attendance_apply_rules();
      end if;
    end
    $inner$;
  $sql$;

  -- =========================
  -- Admin detection helper
  -- (supports employees.role_id -> roles.name OR employees.role text)
  -- Uses e.user_id::text = auth.uid()::text to avoid TEXT/UUID mismatch
  -- =========================
  execute $sql$
    create or replace function public.is_admin_user()
    returns boolean
    language plpgsql
    security definer
    set search_path = public
    as $func$
    declare
      is_admin boolean := false;
    begin
      -- (A) role_id -> roles
      if to_regclass('public.roles') is not null
         and exists (select 1 from information_schema.columns where table_schema='public' and table_name='employees' and column_name='role_id')
      then
        select exists (
          select 1
          from public.employees e
          join public.roles r on r.id = e.role_id
          where e.user_id::text = auth.uid()::text
            and lower(r.name) = 'admin'
        ) into is_admin;
        if is_admin then return true; end if;
      end if;

      -- (B) role text
      if exists (select 1 from information_schema.columns where table_schema='public' and table_name='employees' and column_name='role') then
        select exists (
          select 1
          from public.employees e
          where e.user_id::text = auth.uid()::text
            and lower(e.role) = 'admin'
        ) into is_admin;
        if is_admin then return true; end if;
      end if;

      return false;
    end;
    $func$;
  $sql$;

  -- =========================
  -- RLS
  -- =========================
  execute 'alter table public.attendance_records enable row level security;';

  execute 'drop policy if exists attendance_admin_all on public.attendance_records;';
  execute 'create policy attendance_admin_all on public.attendance_records for all to authenticated using (public.is_admin_user()) with check (public.is_admin_user());';

  execute 'drop policy if exists attendance_user_read_own on public.attendance_records;';
  execute $sql$
    create policy attendance_user_read_own
    on public.attendance_records
    for select
    to authenticated
    using (
      exists (
        select 1
        from public.employees e
        where e.id = attendance_records.employee_id
          and e.user_id::text = auth.uid()::text
      )
    );
  $sql$;

  -- =========================================================
  -- Optional (but usually required): allow Attendance Tracker
  -- to READ employees / leave_types / roles when those tables
  -- have RLS enabled in the Leave Manager project.
  --
  -- Symptoms without these policies:
  -- - Employee dropdown is empty for admin (employees SELECT returns 0 rows)
  -- - Leave Types dropdown is empty
  -- - Admin detection may fail if roles are not readable
  --
  -- These policies are additive (they do not disable existing rules).
  -- They only take effect if RLS is enabled on those tables.
  -- =========================================================

  -- Employees: admin can read all, users can read their own row
  execute 'drop policy if exists employees_admin_select_all_attendance on public.employees;';
  execute 'create policy employees_admin_select_all_attendance on public.employees for select to authenticated using (public.is_admin_user());';

  execute 'drop policy if exists employees_user_select_own_attendance on public.employees;';
  execute $sql$
    create policy employees_user_select_own_attendance
    on public.employees
    for select
    to authenticated
    using (user_id::text = auth.uid()::text);
  $sql$;

  -- Leave types: allow read for authenticated users
  if has_leave_types then
    execute 'drop policy if exists leave_types_read_all_attendance on public.leave_types;';
    execute 'create policy leave_types_read_all_attendance on public.leave_types for select to authenticated using (true);';
  end if;

  -- Roles: allow read for authenticated users (used for admin detection)
  if has_roles then
    execute 'drop policy if exists roles_read_all_attendance on public.roles;';
    execute 'create policy roles_read_all_attendance on public.roles for select to authenticated using (true);';
  end if;

end $$;

-- Quick validation
-- select * from public.attendance_records limit 5;
