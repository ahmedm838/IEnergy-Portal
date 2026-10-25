-- Renewals are additional years beyond the initial one-year contract.
-- Existing employees retain their expiry with the default of zero.
begin;

alter table public.employees
  add column if not exists renewals integer not null default 0
  constraint employees_renewals_range check (renewals between 0 and 50);

comment on column public.employees.renewals is
  'Additional whole contract years beyond the initial year, from 0 to 50.';

-- Keep existing columns in place and append Renewals, preserving dependents.
create or replace view public.employee_profiles
with (security_invoker = true)
as
select
  e.id, e.auth_user_id, e.code, e.name, e.si_no, e.title, e.email,
  e.site_id, e.department_id, e.has_meal, e.has_allowance, e.has_overtime,
  e.has_incentive, e.has_deductions, e.status_id, e.annual_leave_balance,
  e.unplanned_leave_balance, e.role, e.hired_on, e.is_active, e.created_at,
  e.updated_at, e.username, e.company_mobile, e.office_number, e.arabic_name,
  e.national_id, e.id_expiry_date, e.weekend, e.si_date, e.si_basic_wage,
  e.si_gross_wage, e.si_code, e.personal_mobile, e.secondary_mobile,
  e.secondary_mobile_name, e.bus_route_id, e.military_service, e.marital_status,
  e.religion, e.qualification_degree_id, e.education_field, e.notice_date,
  e.resignation_date, e.resignation_reason, e.doc_graduation_certificate,
  e.doc_military_certificate, e.doc_birth_certificate, e.doc_criminal_clearance,
  e.doc_id_copy, e.doc_personal_photos, e.doc_medical_form_111,
  e.doc_si_record_copy, e.doc_si_form_1, e.doc_contract,
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
  cardinality(missing_documents(e)) = 0 as file_complete,
  e.renewals
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
