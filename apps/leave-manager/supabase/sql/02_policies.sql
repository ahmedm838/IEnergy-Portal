
-- 02_policies.sql
-- RLS policies for Leave Manager

alter table public.roles enable row level security;
alter table public.employees enable row level security;
alter table public.leave_types enable row level security;
alter table public.employee_leave_years enable row level security;
alter table public.leave_records enable row level security;

-- Roles: readable by authenticated
drop policy if exists "roles_read" on public.roles;
create policy "roles_read"
on public.roles for select
to authenticated
using (true);

-- Leave types: readable by authenticated
drop policy if exists "leave_types_read" on public.leave_types;
create policy "leave_types_read"
on public.leave_types for select
to authenticated
using (true);

-- Employees: users can read their own row; admins can read all
drop policy if exists "employees_read_self" on public.employees;
create policy "employees_read_self"
on public.employees for select
to authenticated
using (auth_user_id = auth.uid() or public.fn_is_admin());

-- Employees: only admins can insert/update (through Edge Function/service role or admin UI)
drop policy if exists "employees_admin_write" on public.employees;
create policy "employees_admin_write"
on public.employees for all
to authenticated
using (public.fn_is_admin())
with check (public.fn_is_admin());

-- Employee leave years: self read or admin read; admin write
drop policy if exists "employee_leave_years_read" on public.employee_leave_years;
create policy "employee_leave_years_read"
on public.employee_leave_years for select
to authenticated
using (employee_id = public.fn_current_employee_id() or public.fn_is_admin());

drop policy if exists "employee_leave_years_admin_write" on public.employee_leave_years;
create policy "employee_leave_years_admin_write"
on public.employee_leave_years for all
to authenticated
using (public.fn_is_admin())
with check (public.fn_is_admin());

-- Leave records: self read or admin read
drop policy if exists "leave_records_read" on public.leave_records;
create policy "leave_records_read"
on public.leave_records for select
to authenticated
using (employee_id = public.fn_current_employee_id() or public.fn_is_admin());

-- Leave records: self insert only for own employee_id is allowed? Spec implies employees only view.
-- Therefore: only admins can insert/update/delete.
drop policy if exists "leave_records_admin_write" on public.leave_records;
create policy "leave_records_admin_write"
on public.leave_records for insert
to authenticated
with check (public.fn_is_admin());

drop policy if exists "leave_records_admin_update" on public.leave_records;
create policy "leave_records_admin_update"
on public.leave_records for update
to authenticated
using (public.fn_is_admin())
with check (public.fn_is_admin());

drop policy if exists "leave_records_admin_delete" on public.leave_records;
create policy "leave_records_admin_delete"
on public.leave_records for delete
to authenticated
using (public.fn_is_admin());

