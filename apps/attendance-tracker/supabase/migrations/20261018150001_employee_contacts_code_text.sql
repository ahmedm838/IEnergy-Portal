-- =====================================================================
-- A text form of the employee code on the contacts view.
--
-- The portal's contacts page now searches the database on every
-- keystroke rather than downloading the directory once when the page
-- opens, so that an edit made in the tracker shows up immediately. That
-- means the "starts with 98" style of code search has to run in SQL, and
-- code is an integer -- PostgREST has no cast syntax in filters, so it
-- cannot pattern-match one.
--
-- The column is appended rather than inserted: CREATE OR REPLACE VIEW
-- only allows new columns at the end, and dropping the view would drop
-- the grant to anon with it.
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
    e.office_number,
    e.code::text as code_text
  from employees e
  left join departments d on d.id = e.department_id
  left join sites s       on s.id = e.site_id
  where e.is_active;

comment on view employee_contacts is
  'Narrow read-only contact directory for the portal. Intentionally readable by anon; see the 20261018100001 migration header. code_text exists so the portal can pattern-match on the code.';

-- CREATE OR REPLACE keeps existing grants, but state it rather than
-- assume it: without this the portal silently loses the directory.
grant select on employee_contacts to anon, authenticated;
