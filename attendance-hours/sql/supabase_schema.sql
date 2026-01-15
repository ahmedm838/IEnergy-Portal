-- ============================================================
-- iEnergy Attendance Tracker - Supabase SQL
-- ============================================================
-- IMPORTANT (recommended approach):
-- Run this SQL in the SAME Supabase project used by Leave Manager.
-- This is the only way to guarantee "same credentials" (Supabase Auth is per-project)
-- and to reuse existing tables: roles, employees, leave_types.
--
-- If you insist on a separate Attendance Tracker project, see the OPTIONAL
-- postgres_fdw section at the end (requires additional steps, including Auth migration).
--
-- References:
-- - postgres_fdw (query remote Postgres): https://supabase.com/docs/guides/database/extensions/postgres_fdw
-- - Migrating Auth between projects: https://supabase.com/docs/guides/troubleshooting/migrating-auth-users-between-projects
-- ============================================================

-- ---------- helpers ----------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Admin check (expects employees.role_id -> roles.id and roles.name has 'admin')
create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.employees e
    join public.roles r on r.id = e.role_id
    where e.user_id = auth.uid()
      and lower(r.name) = 'admin'
  );
$$;

-- ---------- main table ----------
create table if not exists public.attendance_records (
  id bigserial primary key,
  employee_id uuid not null,
  record_date date not null,
  sign_in time,
  sign_out time,
  leave_type_id bigint,
  working_hours numeric(6,2) not null default 0,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Unique per employee per day
  constraint attendance_unique_emp_day unique (employee_id, record_date),

  -- Basic consistency checks
  constraint attendance_sign_order_check
    check (
      (sign_in is null and sign_out is null)
      or (sign_in is not null and sign_out is not null and sign_out > sign_in)
    )
);

-- FKs (these require the tables to exist in the SAME DB)
do $$
begin
  -- employees
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='employees') then
    begin
      alter table public.attendance_records
        add constraint attendance_employee_fk
        foreign key (employee_id) references public.employees(id) on delete cascade;
    exception when duplicate_object then null;
    end;
  end if;

  -- leave_types
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='leave_types') then
    begin
      alter table public.attendance_records
        add constraint attendance_leave_type_fk
        foreign key (leave_type_id) references public.leave_types(id);
    exception when duplicate_object then null;
    end;
  end if;
end $$;

-- updated_at trigger
drop trigger if exists trg_attendance_records_updated_at on public.attendance_records;
create trigger trg_attendance_records_updated_at
before update on public.attendance_records
for each row execute function public.set_updated_at();

-- Business rule enforcement:
-- If leave_type_id is not null -> force 08:00-16:00 and 8 hours
create or replace function public.attendance_apply_leave_rules()
returns trigger
language plpgsql
as $$
begin
  if new.leave_type_id is not null then
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
$$;

drop trigger if exists trg_attendance_apply_leave_rules on public.attendance_records;
create trigger trg_attendance_apply_leave_rules
before insert or update on public.attendance_records
for each row execute function public.attendance_apply_leave_rules();

-- ---------- RLS ----------
alter table public.attendance_records enable row level security;

-- Admin: full access
drop policy if exists attendance_admin_all on public.attendance_records;
create policy attendance_admin_all
on public.attendance_records
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- User: read only own employee_id
drop policy if exists attendance_user_read_own on public.attendance_records;
create policy attendance_user_read_own
on public.attendance_records
for select
to authenticated
using (
  exists (
    select 1 from public.employees e
    where e.id = attendance_records.employee_id
      and e.user_id = auth.uid()
  )
);

-- ------------------------------------------------------------
-- OPTIONAL (advanced): Access Leave Manager tables from a separate project
-- ------------------------------------------------------------
-- Supabase supports connecting to another Postgres database using postgres_fdw.
-- This can IMPORT remote tables as FOREIGN TABLES.
--
-- However, Auth is still per-project. To truly share "same credentials", you must
-- migrate the auth schema (users/password hashes) or use an external auth provider.
--
-- Steps (high level):
-- 1) Enable postgres_fdw extension in Attendance Tracker project
-- 2) Create SERVER pointing to Leave Manager Postgres (host/port/dbname)
-- 3) Create USER MAPPING (requires a DB user + password)
-- 4) IMPORT FOREIGN SCHEMA public LIMIT TO (employees, roles, leave_types)
-- 5) Create attendance_records locally (as above), but note: FKs to foreign tables
--    cannot be enforced, and RLS logic depends on matching auth.uid() across projects.
--
-- Full docs: https://supabase.com/docs/guides/database/extensions/postgres_fdw
-- Auth migration: https://supabase.com/docs/guides/troubleshooting/migrating-auth-users-between-projects
