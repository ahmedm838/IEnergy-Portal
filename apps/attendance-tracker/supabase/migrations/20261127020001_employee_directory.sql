-- The company directory: every active employee, with only what a form
-- or the company structure needs to name them -- never national IDs,
-- wages, contacts or documents.
--
-- Row level security lets a user read their own record and the people
-- in their sector at levels below theirs. Two places need more than that,
-- and only the names: Employee Documents, where any employee can be
-- picked (a guarantor, a manager, the person a request is for), and the
-- Company structure page, which shows the whole company. This function
-- gives them that list and nothing else; the full records stay behind
-- row level security as before.
--
-- Any role that can sign in reads it; no_access gets nothing.

create or replace function employee_directory()
returns table (
  id            uuid,
  code          integer,
  name          text,
  arabic_name   text,
  title         text,
  si_title      text,
  department_id smallint,
  level_id      smallint,
  hired_on      date
)
language sql
stable
security definer
set search_path = public
as $$
  select e.id, e.code, e.name, e.arabic_name, e.title, s.title, e.department_id, e.level_id, e.hired_on
    from employees e
    left join si_codes s on s.code = e.si_code
   where e.is_active
     and my_role() <> 'no_access'::app_role
   order by e.code;
$$;

comment on function employee_directory() is
  'Every active employee by name, title, department, level and hiring date, for Employee Documents pickers and Company structure. No sensitive fields.';

revoke all on function employee_directory() from public, anon;
grant execute on function employee_directory() to authenticated;

-- The Company structure page, in Settings > Page access: open to users
-- and admins until a super admin says otherwise.
insert into page_access (page, role, allowed) values
  ('company-structure', 'user',  true),
  ('company-structure', 'admin', true)
on conflict (page, role) do nothing;
