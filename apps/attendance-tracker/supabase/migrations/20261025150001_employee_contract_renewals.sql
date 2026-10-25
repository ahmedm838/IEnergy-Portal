-- Renewals are additional years beyond the initial one-year contract.
-- Existing employees retain their expiry with the default of zero.
begin;

alter table public.employees
  add column if not exists renewals integer not null default 0
  constraint employees_renewals_range check (renewals between 0 and 50);

comment on column public.employees.renewals is
  'Additional whole contract years beyond the initial year, from 0 to 50.';

-- Rebuild the view to expose the new employee column and renewed expiry.
drop view public.employee_profiles;
create view public.employee_profiles
with (security_invoker = true)
as
select
  e.*,
  id_birth_date(e.national_id) as birth_date,
  id_gender(e.national_id) as gender,
  id_governorate_code(e.national_id) as governorate_code,
  g.name_ar as governorate,
  s.title as si_title,
  d.name_en as qualification_degree,
  d.name_ar as qualification_degree_ar,
  b.name as bus_route,
  (e.hired_on - interval '1 day' + make_interval(years => 1 + e.renewals))::date as contract_expiry,
  missing_documents(e) as missing_documents,
  cardinality(missing_documents(e)) = 0 as file_complete
from public.employees e
left join public.governorates g on g.code = id_governorate_code(e.national_id)
left join public.si_codes s on s.code = e.si_code
left join public.qualification_degrees d on d.id = e.qualification_degree_id
left join public.bus_routes b on b.id = e.bus_route_id;

comment on view public.employee_profiles is
  'Employee profiles with derived identity, insurance title, contract expiry including renewals, and missing personnel documents. Uses caller row-level security.';
grant select on public.employee_profiles to authenticated;
notify pgrst, 'reload schema';
commit;
