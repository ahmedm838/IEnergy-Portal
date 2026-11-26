-- The contacts page searches by Arabic name as well as code and English
-- name, so the view carries it. Added last: create or replace view can
-- only append columns.
create or replace view public.employee_contacts as
 select e.code,
    e.name,
    e.title,
    d.name as department,
    s.name as site,
    e.email,
    e.company_mobile,
    e.office_number,
    e.code::text as code_text,
    l.code as level,
    sec.name as sector,
    e.arabic_name
   from employees e
     left join departments d on d.id = e.department_id
     left join sectors sec on sec.id = d.sector_id
     left join sites s on s.id = e.site_id
     left join employee_levels l on l.id = e.level_id
  where e.is_active;
