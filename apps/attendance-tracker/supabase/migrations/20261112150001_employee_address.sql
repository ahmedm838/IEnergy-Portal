-- =====================================================================
-- The employee's address.
--
-- The hiring contract states where the employee lives ("ومحل إقامته"),
-- and until now the HR Documents page had to ask for it every time: the
-- record had nowhere to keep it. It is kept on the record from here on,
-- entered on the Employee Database page under Personal, exported beside
-- the other personal fields, and read by the hiring contract.
--
-- Free text, nullable. An address has no shape worth a check constraint
-- -- buildings, districts, "ش" and "عمارة", numbers in either script --
-- and the employees already on file have none recorded. The page asks
-- for it in Arabic, as the contract is written.
-- =====================================================================

alter table public.employees
  add column if not exists address text;

-- ---------------------------------------------------------------------
-- employee_profiles carries the address.
--
-- The form, the export and the HR Documents page all read this view.
-- Appended at the end: CREATE OR REPLACE VIEW can only add columns
-- there, and dropping the view would drop its grants. Otherwise the
-- definition is the one from 20261029120001, unchanged.
-- ---------------------------------------------------------------------
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
  e.renewals,
  e.level_id,
  e.address
from public.employees e
left join public.governorates g on g.code = id_governorate_code(e.national_id)
left join public.si_codes s on s.code = e.si_code
left join public.qualification_degrees d on d.id = e.qualification_degree_id
left join public.bus_routes b on b.id = e.bus_route_id;

comment on view public.employee_profiles is
  'Employee profiles with derived identity, insurance title, contract expiry including renewals, missing personnel documents, job level and address. Uses caller row-level security.';

grant select on public.employee_profiles to authenticated;
