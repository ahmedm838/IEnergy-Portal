-- =====================================================================
-- Contact directory for the company portal.
--
-- Readable without signing in, by decision: the portal's contacts page has
-- no real login -- auth.js is a client-side gate with its passwords in the
-- source -- and it already served these same fields from a publicly
-- downloadable spreadsheet.
--
-- Note what that means, because it is not obvious: employees.email is also
-- the username people sign in with, so this view publishes a live list of
-- every valid username. That is accepted here; if it ever stops being
-- acceptable, drop `email` from the column list below and the portal falls
-- back to showing phone numbers only.
--
-- The view is deliberately narrow. Roles, leave balances, payroll
-- switches, S.I. numbers and internal ids stay behind RLS where they are.
-- Granting the underlying table to anon would have exposed all of it; this
-- grants one view with eight columns and active employees only.
-- =====================================================================

create or replace view employee_contacts as
  select
    e.code,
    e.name,
    e.title,
    d.name as department,
    s.name as site,
    e.email,
    e.company_mobile,
    e.office_number
  from employees e
  left join departments d on d.id = e.department_id
  left join sites s       on s.id = e.site_id
  where e.is_active;

comment on view employee_contacts is
  'Narrow read-only contact directory for the portal. Intentionally readable by anon; see the migration header.';

-- Read only, and only this view. No grant is made on employees itself.
grant select on employee_contacts to anon, authenticated;
