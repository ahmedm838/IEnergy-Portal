-- =====================================================================
-- A contract runs a calendar year, ending the day before the anniversary.
--
-- It was the anniversary itself: hired on 11 Nov 2025, expiring 11 Nov
-- 2026 -- a year and a day. The last day of a one-year contract starting
-- 11 Nov 2025 is 10 Nov 2026.
--
-- The subtraction comes first on purpose. Postgres clamps a date that
-- overshoots the month, so for somebody hired on 29 Feb 2024:
--
--   + 1 year then - 1 day  ->  2025-02-28 then 2025-02-27   (a day short)
--   - 1 day then + 1 year  ->  2024-02-28 then 2025-02-28   (correct)
--
-- Adding the year first loses a day for every leap-day hire, and does so
-- silently. The two orderings agree on every other date.
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
  -- One calendar year from the hiring date, ending the day before the
  -- anniversary. Null when there is no hiring date, which reads as "not
  -- known" rather than putting an employee with no start date into the
  -- expired pile.
  (e.hired_on - interval '1 day' + interval '1 year')::date as contract_expiry,
  missing_documents(e)                      as missing_documents,
  cardinality(missing_documents(e)) = 0     as file_complete
from employees e
left join governorates g          on g.code = id_governorate_code(e.national_id)
left join si_codes s              on s.code = e.si_code
left join qualification_degrees d on d.id   = e.qualification_degree_id
left join bus_routes b            on b.id   = e.bus_route_id;

comment on view employee_profiles is
  'Employee rows with the values that are derived rather than stored: birth date, gender and governorate out of the national ID, the insurance job title, contract expiry one calendar year from hiring (the day before the anniversary), and which of the ten personnel documents are still missing. Runs as the caller, so row level security applies.';

grant select on employee_profiles to authenticated;
