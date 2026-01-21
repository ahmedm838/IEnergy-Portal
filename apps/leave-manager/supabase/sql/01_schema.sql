
-- 01_schema.sql
-- Core schema for Leave Manager

create extension if not exists pgcrypto;

-- 1) Roles
create table if not exists public.roles (
  id smallint generated always as identity primary key,
  name text not null unique
);

-- 2) Employees
create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique, -- maps to auth.users.id
  code text not null unique,
  name text not null,
  user_id text not null unique, -- login username (dots allowed)
  hiring_date date not null,
  role_id smallint not null references public.roles(id),
  password_hash text, -- stored as salted hash (not plaintext)
  planned_annual_balance int not null default 14,
  unplanned_annual_balance int not null default 7,
  created_at timestamptz not null default now()
);

-- Constraints from spec
alter table public.employees
  add constraint employees_code_format_chk
  check (code ~ '^[2][0-9]{5}$');

alter table public.employees
  add constraint employees_user_id_chk
  check (user_id ~ '^[A-Za-z0-9]+(\.[A-Za-z0-9]+)*$');

alter table public.employees
  add constraint employees_name_3_words_chk
  check (array_length(regexp_split_to_array(trim(name), '\s+'), 1) >= 3);

alter table public.employees
  add constraint employees_balances_nonneg_chk
  check (planned_annual_balance >= 0 and unplanned_annual_balance >= 0);

-- 3) Leave Types
create table if not exists public.leave_types (
  id smallint generated always as identity primary key,
  name text not null unique,
  deduct_from text not null default 'none' -- 'planned' | 'unplanned' | 'none'
);

-- 4) Leave Years (the "5th table" to handle annual renewal per calendar year)
create table if not exists public.employee_leave_years (
  employee_id uuid not null references public.employees(id) on delete cascade,
  year int not null,
  planned_balance int not null,
  unplanned_balance int not null,
  created_at timestamptz not null default now(),
  primary key (employee_id, year)
);

alter table public.employee_leave_years
  add constraint employee_leave_years_year_chk
  check (year between 2000 and 2100);

-- 5) Leave Records
create table if not exists public.leave_records (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references public.employees(id) on delete cascade,
  code text not null references public.employees(code),
  start_date date not null,
  end_date date not null,
  leave_days int generated always as ((end_date - start_date) + 1) stored,
  leave_type_id smallint not null references public.leave_types(id),
  remarks text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.leave_records
  add constraint leave_records_dates_chk
  check (end_date >= start_date);

-- Keep annual-renewal logic sane: do not allow cross-year records
alter table public.leave_records
  add constraint leave_records_same_year_chk
  check (extract(year from start_date) = extract(year from end_date));

-- ---- Helper functions

create or replace function public.fn_is_admin()
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.employees e
    join public.roles r on r.id = e.role_id
    where e.auth_user_id = auth.uid()
      and r.name = 'Admin'
  );
$$;

create or replace function public.fn_current_employee_id()
returns uuid
language sql
stable
as $$
  select e.id from public.employees e where e.auth_user_id = auth.uid();
$$;

-- Ensure employee_id is populated when inserting with code
create or replace function public.tg_leave_records_fill_employee_id()
returns trigger
language plpgsql
as $$
begin
  if new.employee_id is null then
    select id into new.employee_id from public.employees where code = new.code;
  end if;

  if new.employee_id is null then
    raise exception 'Invalid employee code';
  end if;

  new.updated_at := now();
  if new.created_by is null then
    new.created_by := auth.uid();
  end if;

  return new;
end;
$$;

drop trigger if exists trg_leave_records_fill_employee_id on public.leave_records;
create trigger trg_leave_records_fill_employee_id
before insert or update on public.leave_records
for each row execute function public.tg_leave_records_fill_employee_id();

-- Create a leave-year row on-demand (annual renewal each Jan 1 is handled by per-year computation)
create or replace function public.fn_ensure_employee_year(p_employee_id uuid, p_year int)
returns void
language plpgsql
as $$
declare
  e public.employees%rowtype;
begin
  if not exists (
    select 1 from public.employee_leave_years
    where employee_id = p_employee_id and year = p_year
  ) then
    select * into e from public.employees where id = p_employee_id;
    if not found then
      raise exception 'Employee not found';
    end if;

    insert into public.employee_leave_years(employee_id, year, planned_balance, unplanned_balance)
    values (p_employee_id, p_year, e.planned_annual_balance, e.unplanned_annual_balance);
  end if;
end;
$$;

create or replace function public.tg_leave_records_ensure_year()
returns trigger
language plpgsql
as $$
declare
  y int;
begin
  y := extract(year from new.start_date)::int;
  perform public.fn_ensure_employee_year(new.employee_id, y);
  return new;
end;
$$;

drop trigger if exists trg_leave_records_ensure_year on public.leave_records;
create trigger trg_leave_records_ensure_year
before insert on public.leave_records
for each row execute function public.tg_leave_records_ensure_year();

-- Balance check function (planned/unplanned/forced are validated)
create or replace function public.fn_check_leave_balance(
  p_employee_id uuid,
  p_year int,
  p_leave_type_id smallint,
  p_leave_days int,
  p_exclude_record_id uuid default null
)
returns void
language plpgsql
as $$
declare
  lt public.leave_types%rowtype;
  ent public.employee_leave_years%rowtype;
  used_planned int;
  used_unplanned int;
begin
  select * into lt from public.leave_types where id = p_leave_type_id;
  if not found then
    raise exception 'Invalid leave type';
  end if;

  perform public.fn_ensure_employee_year(p_employee_id, p_year);
  select * into ent from public.employee_leave_years where employee_id = p_employee_id and year = p_year;

  -- Used days in year (only deducted types)
  select coalesce(sum(lr.leave_days),0) into used_planned
  from public.leave_records lr
  join public.leave_types t on t.id = lr.leave_type_id
  where lr.employee_id = p_employee_id
    and extract(year from lr.start_date)::int = p_year
    and t.deduct_from = 'planned'
    and (p_exclude_record_id is null or lr.id <> p_exclude_record_id);

  select coalesce(sum(lr.leave_days),0) into used_unplanned
  from public.leave_records lr
  join public.leave_types t on t.id = lr.leave_type_id
  where lr.employee_id = p_employee_id
    and extract(year from lr.start_date)::int = p_year
    and t.deduct_from = 'unplanned'
    and (p_exclude_record_id is null or lr.id <> p_exclude_record_id);

  if lt.deduct_from = 'planned' then
    if (used_planned + p_leave_days) > ent.planned_balance then
      raise exception 'Insufficient planned balance';
    end if;
  elsif lt.deduct_from = 'unplanned' then
    if (used_unplanned + p_leave_days) > ent.unplanned_balance then
      raise exception 'Insufficient un-planned balance';
    end if;
  end if;
end;
$$;

-- Trigger to enforce balance
create or replace function public.tg_leave_records_balance_guard()
returns trigger
language plpgsql
as $$
declare
  y int;
begin
  y := extract(year from new.start_date)::int;

  if tg_op = 'INSERT' then
    perform public.fn_check_leave_balance(new.employee_id, y, new.leave_type_id, new.leave_days, null);
  else
    perform public.fn_check_leave_balance(new.employee_id, y, new.leave_type_id, new.leave_days, new.id);
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_leave_records_balance_guard on public.leave_records;
create trigger trg_leave_records_balance_guard
before insert or update on public.leave_records
for each row execute function public.tg_leave_records_balance_guard();

-- View: yearly status
create or replace view public.v_employee_year_status as
select
  e.id as employee_id,
  e.code,
  e.name,
  e.hiring_date,
  y.year,
  y.planned_balance as beginning_planned_balance,
  y.unplanned_balance as beginning_unplanned_balance,
  coalesce(sum(case when lt.deduct_from = 'planned' then lr.leave_days else 0 end),0) as utilized_planned_days,
  coalesce(sum(case when lt.deduct_from = 'unplanned' then lr.leave_days else 0 end),0) as utilized_unplanned_days,
  (y.planned_balance - coalesce(sum(case when lt.deduct_from = 'planned' then lr.leave_days else 0 end),0)) as remaining_planned_days,
  (y.unplanned_balance - coalesce(sum(case when lt.deduct_from = 'unplanned' then lr.leave_days else 0 end),0)) as remaining_unplanned_days,
  coalesce(sum(case when lt.deduct_from = 'none' then lr.leave_days else 0 end),0) as utilized_other_days
from public.employees e
join public.employee_leave_years y
  on y.employee_id = e.id
left join public.leave_records lr
  on lr.employee_id = e.id
  and extract(year from lr.start_date)::int = y.year
left join public.leave_types lt
  on lt.id = lr.leave_type_id
group by e.id, e.code, e.name, e.hiring_date, y.year, y.planned_balance, y.unplanned_balance;

