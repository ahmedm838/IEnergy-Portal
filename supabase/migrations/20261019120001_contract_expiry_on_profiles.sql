-- =====================================================================
-- Contract expiry becomes a column of the profile view.
--
-- It was worked out in the browser, from the hiring date plus a year, on
-- the record being looked at. That is fine for one employee and useless
-- for a question about all of them: counting how many contracts are
-- expired or nearly so would have meant fetching every hiring date and
-- doing the arithmetic client side.
--
-- Putting it in the view means the count is a filter, the export stops
-- recomputing what the database already knows, and the two can no longer
-- disagree about when a contract ends.
-- =====================================================================

drop view if exists employee_profiles;

create view employee_profiles
with (security_invoker = true)
as
select
  e.*,
  id_birth_date(e.national_id)              as birth_date,
  id_gender(e.national_id)                  as gender,
  id_governorate_code(e.national_id)        as governorate_code,
  g.name_ar                                 as governorate,
  s.title                                   as si_title,
  d.name_en                                 as qualification_degree,
  d.name_ar                                 as qualification_degree_ar,
  b.name                                    as bus_route,
  -- One year from the hiring date, as the workbook defines it. Null when
  -- there is no hiring date, which reads as "not known" rather than
  -- putting an employee with no start date into the expired pile.
  (e.hired_on + interval '1 year')::date    as contract_expiry,
  missing_documents(e)                      as missing_documents,
  cardinality(missing_documents(e)) = 0     as file_complete
from employees e
left join governorates g          on g.code = id_governorate_code(e.national_id)
left join si_codes s              on s.code = e.si_code
left join qualification_degrees d on d.id   = e.qualification_degree_id
left join bus_routes b            on b.id   = e.bus_route_id;

comment on view employee_profiles is
  'Employee rows with the values that are derived rather than stored: birth date, gender and governorate out of the national ID, the insurance job title, contract expiry a year from hiring, and which of the ten personnel documents are still missing. Runs as the caller, so row level security applies.';

grant select on employee_profiles to authenticated;
