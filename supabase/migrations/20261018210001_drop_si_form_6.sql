-- =====================================================================
-- SI form 6 is no longer part of the personnel file.
--
-- The column goes, and with it the one tick currently recorded against
-- it. That is the point of the request rather than a side effect, but it
-- is worth saying plainly: dropping a column discards its data, and only
-- a backup brings it back.
--
-- The checklist is now ten documents, and a file counts as complete when
-- those ten are ticked. Anyone whose file was short only of SI form 6
-- therefore becomes complete the moment this runs -- which is the
-- intended reading of "amend the file status check".
-- =====================================================================

-- employee_profiles was created with select e.*, which freezes the column
-- list at creation, so it holds a reference to the column and has to come
-- down before the column can.
drop view if exists employee_profiles;

-- Rewritten before the column disappears, so it never refers to something
-- that is no longer there.
create or replace function missing_documents(p employees)
returns text[]
language sql
stable
as $fn$
  select coalesce(array_agg(label order by ord), array[]::text[])
    from (values
      (1,  'Graduation certificate', p.doc_graduation_certificate),
      (2,  'Military certificate',   p.doc_military_certificate),
      (3,  'Birth certificate',      p.doc_birth_certificate),
      (4,  'Finger print record',    p.doc_fingerprint_record),
      (5,  'ID copy',                p.doc_id_copy),
      (6,  '6 personal photos',      p.doc_personal_photos),
      (7,  'Medical form 111',       p.doc_medical_form_111),
      (8,  'SI record copy',         p.doc_si_record_copy),
      (9,  'SI form 1',              p.doc_si_form_1),
      (10, 'Contract',               p.doc_contract)
    ) as t(ord, label, present)
   where not present;
$fn$;

alter table employees drop column if exists doc_si_form_6;

-- Same view as before, rebuilt so e.* expands to the columns that remain.
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
  missing_documents(e)                      as missing_documents,
  cardinality(missing_documents(e)) = 0     as file_complete
from employees e
left join governorates g          on g.code = id_governorate_code(e.national_id)
left join si_codes s              on s.code = e.si_code
left join qualification_degrees d on d.id   = e.qualification_degree_id
left join bus_routes b            on b.id   = e.bus_route_id;

comment on view employee_profiles is
  'Employee rows with the values that are derived rather than stored: birth date, gender and governorate out of the national ID, the insurance job title, and which of the ten personnel documents are still missing. Runs as the caller, so row level security applies.';

grant select on employee_profiles to authenticated;
