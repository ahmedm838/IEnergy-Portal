-- =====================================================================
-- IEnergy Attendance Tracker — schema
-- Target: Supabase / PostgreSQL 15+
-- Run order: 01_schema.sql → 02_functions.sql → 03_rls.sql → 04_seed.sql
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------

-- Roles sheet: Admin / User / No Access
do $$ begin
  create type app_role as enum ('admin', 'user', 'no_access');
exception when duplicate_object then null; end $$;

-- Attendance sheet, "Balance" column notes:
--   اعتيادي  -> Deduct from Annual Leave Balance
--   عارضه    -> Deduct from Un Planned Leave Balance
--   بدل راحة -> Deduct from Added Days
--   بالخصم   -> counted as a Deducted Leave in payroll
--   غياب     -> feeds the progressive absence penalty
do $$ begin
  create type balance_effect as enum (
    'none', 'annual', 'unplanned', 'added_days', 'deducted', 'absence'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- Lookup tables  (Sites / Sectors / Departments / Status sheets)
-- ---------------------------------------------------------------------

create table if not exists sites (
  id          smallint generated always as identity primary key,
  name        text not null unique,
  -- "Availability" column: can this site currently be assigned to employees?
  available   boolean not null default true,
  sort_order  smallint not null default 0
);

create table if not exists sectors (
  id          smallint generated always as identity primary key,
  name        text not null unique,
  sort_order  smallint not null default 0
);

create table if not exists departments (
  id          smallint generated always as identity primary key,
  name        text not null,
  sector_id   smallint not null references sectors(id) on update cascade,
  sort_order  smallint not null default 0,
  unique (name, sector_id)
);

create table if not exists employee_statuses (
  id          smallint generated always as identity primary key,
  name        text not null unique,
  -- "Payroll" column: does an employee in this status appear in the monthly report?
  in_payroll  boolean not null default true,
  sort_order  smallint not null default 0
);

-- ---------------------------------------------------------------------
-- Attendance types  (Attendance sheet / Table7)
--
-- overtime_hours is DERIVED, matching the sheet formula  =D*1.5+E
--   Overtime hours = Extra hours * 1.5 + Added Hours
-- Verified against every row of the workbook, e.g.
--   جمعة 12 : 12 * 1.5 + 6  = 24
--   وردتين  : 16 * 1.5 + 0  = 24
-- ---------------------------------------------------------------------

create table if not exists attendance_types (
  id               smallint generated always as identity primary key,
  code             text not null unique,            -- stable slug for app logic
  name_ar          text not null,
  name_en          text not null,
  meal_multiplier  numeric(6,2) not null default 0, -- meals earned that day
  extra_hours      numeric(6,2) not null default 0,
  added_hours      numeric(6,2) not null default 0,
  overtime_hours   numeric(6,2) generated always as (extra_hours * 1.5 + added_hours) stored,
  effect           balance_effect not null default 'none',
  -- Counts toward "monthly required hours = paid days * 8" in the employee report.
  -- True only for days the employee is actually expected to be on shift.
  is_working_day   boolean not null default false,
  is_active        boolean not null default true,
  sort_order       smallint not null default 0
);

comment on column attendance_types.overtime_hours is
  'Generated: extra_hours * 1.5 + added_hours (workbook Table7 formula =D*1.5+E)';
comment on column attendance_types.is_working_day is
  'Drives required-hours = count(is_working_day) * settings.required_hours_per_day';

-- ---------------------------------------------------------------------
-- Employees  (Employees sheet / Table4)
-- ---------------------------------------------------------------------

create table if not exists employees (
  id                         uuid primary key default gen_random_uuid(),
  auth_user_id               uuid unique references auth.users(id) on delete set null,
  code                       integer not null unique,
  name                       text not null,
  si_no                      text,                       -- Social Insurance No.
  title                      text,
  email                      citext,
  site_id                    smallint references sites(id) on update cascade,
  department_id              smallint references departments(id) on update cascade,

  -- Y/N switches that gate which payroll components the employee earns
  has_meal                   boolean not null default false,
  has_allowance              boolean not null default false,
  has_overtime               boolean not null default false,
  has_incentive              boolean not null default false,
  has_deductions             boolean not null default true,

  status_id                  smallint references employee_statuses(id) on update cascade,

  -- Opening balances for the leave year
  annual_leave_balance       numeric(6,2) not null default 0,   -- "Planned Leaves"
  unplanned_leave_balance    numeric(6,2) not null default 0,   -- "Un Planned Leaves"

  role                       app_role not null default 'no_access',
  hired_on                   date,
  is_active                  boolean not null default true,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

-- citext may not exist on older projects; fall back to a lower() unique index
do $$ begin
  create extension if not exists citext;
exception when others then null; end $$;

create unique index if not exists employees_email_lower_idx
  on employees (lower(email::text)) where email is not null;
create index if not exists employees_department_idx on employees (department_id);
create index if not exists employees_site_idx       on employees (site_id);
create index if not exists employees_auth_idx       on employees (auth_user_id);

-- ---------------------------------------------------------------------
-- Attendance records  ("employee report" sheet / Table5 — one row per day)
-- ---------------------------------------------------------------------

create table if not exists attendance_records (
  id                    uuid primary key default gen_random_uuid(),
  employee_id           uuid not null references employees(id) on delete cascade,
  work_date             date not null,
  attendance_type_id    smallint not null references attendance_types(id) on update cascade,
  late_minutes          integer not null default 0 check (late_minutes >= 0),
  transport             numeric(10,2) not null default 0 check (transport >= 0),
  -- "Add to Leaves Balance" y/n — when yes the day is credited to Added Days
  add_to_leave_balance  boolean not null default false,
  clock_in              time,
  clock_out             time,
  note                  text,
  created_at            timestamptz not null default now(),
  created_by            uuid references auth.users(id) on delete set null,
  updated_at            timestamptz not null default now(),
  updated_by            uuid references auth.users(id) on delete set null,
  unique (employee_id, work_date)
);

create index if not exists attendance_date_idx     on attendance_records (work_date);
create index if not exists attendance_emp_date_idx on attendance_records (employee_id, work_date);
create index if not exists attendance_type_idx     on attendance_records (attendance_type_id);

-- ---------------------------------------------------------------------
-- Adjustments  ("Others" sheet / Table710)
-- ---------------------------------------------------------------------

create table if not exists adjustments (
  id               uuid primary key default gen_random_uuid(),
  employee_id      uuid not null references employees(id) on delete cascade,
  adj_date         date not null,
  incentive        numeric(12,2) not null default 0,
  bonus            numeric(12,2) not null default 0,
  penalties        numeric(6,2)  not null default 0,  -- in days
  adjusted_days    numeric(6,2)  not null default 0,  -- in days
  adjusted_minutes integer       not null default 0,  -- "Adjusted Hours" hh:mm
  salary_adjust    numeric(12,2) not null default 0,
  salary_advance   numeric(12,2) not null default 0,
  note             text,
  created_at       timestamptz not null default now(),
  created_by       uuid references auth.users(id) on delete set null,
  updated_at       timestamptz not null default now(),
  updated_by       uuid references auth.users(id) on delete set null
);

create index if not exists adjustments_emp_date_idx on adjustments (employee_id, adj_date);
create index if not exists adjustments_date_idx     on adjustments (adj_date);

-- ---------------------------------------------------------------------
-- Settings  (single-row key/value, e.g. meal allowance rate)
-- ---------------------------------------------------------------------

create table if not exists app_settings (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------

create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  if to_jsonb(new) ? 'updated_by' then
    new.updated_by := auth.uid();
  end if;
  return new;
end $$;

drop trigger if exists employees_touch on employees;
create trigger employees_touch before update on employees
  for each row execute function touch_updated_at();

drop trigger if exists attendance_touch on attendance_records;
create trigger attendance_touch before update on attendance_records
  for each row execute function touch_updated_at();

drop trigger if exists adjustments_touch on adjustments;
create trigger adjustments_touch before update on adjustments
  for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------
-- Link a newly created auth user to its employee row by email
-- ---------------------------------------------------------------------

create or replace function link_auth_user_to_employee()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update employees
     set auth_user_id = new.id
   where auth_user_id is null
     and email is not null
     and lower(email::text) = lower(new.email);
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function link_auth_user_to_employee();
