
-- 04_bootstrap_admin.sql
-- Use this ONCE to create the first Admin employee row after you create the auth user in Dashboard → Authentication → Users.

-- Replace the UUID below with the auth user's id (copy from Auth users table)
-- Replace code/name/user_id/hiring_date as needed

with admin_role as (
  select id as role_id from public.roles where name = 'Admin'
)
insert into public.employees(auth_user_id, code, name, user_id, hiring_date, role_id, planned_annual_balance, unplanned_annual_balance)
select
  '00000000-0000-0000-0000-000000000000'::uuid, -- TODO
  '200000'::text,
  'First Admin User'::text,
  'first.admin'::text,
  '2026-01-01'::date,
  admin_role.role_id,
  14,
  7
from admin_role;
