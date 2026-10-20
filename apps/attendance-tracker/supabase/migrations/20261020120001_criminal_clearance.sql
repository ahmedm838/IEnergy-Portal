-- =====================================================================
-- "Finger print record" becomes "Criminal clearance".
--
-- The column is renamed too, not just the label. A column called
-- doc_fingerprint_record holding whether somebody's criminal clearance
-- is on file would mislead everyone who reads the schema from now on,
-- and the two would drift apart the first time anybody trusted the name.
--
-- The tick marks the same thing it marked before -- a document present
-- or missing in the personnel file -- so the values carry over as they
-- are. Nobody's file changes state because the document was renamed.
--
-- Order matters. The view selects e.*, so Postgres expanded that into a
-- fixed column list when the view was created: renaming the column
-- underneath would leave the view still publishing the old name. So the
-- view is dropped first and rebuilt at the end, and missing_documents is
-- replaced in between, because it names the column in its body and would
-- fail at the next call otherwise.
-- =====================================================================

drop view if exists employee_profiles;

alter table employees
  rename column doc_fingerprint_record to doc_criminal_clearance;

comment on column employees.doc_criminal_clearance is
  'Whether the criminal clearance certificate is in the personnel file.';

create or replace function missing_documents(p employees)
returns text[]
language sql
stable
as $function$
  select coalesce(array_agg(label order by ord), array[]::text[])
    from (values
      (1,  'Graduation certificate', p.doc_graduation_certificate),
      (2,  'Military certificate',   p.doc_military_certificate),
      (3,  'Birth certificate',      p.doc_birth_certificate),
      (4,  'Criminal clearance',     p.doc_criminal_clearance),
      (5,  'ID copy',                p.doc_id_copy),
      (6,  '6 personal photos',      p.doc_personal_photos),
      (7,  'Medical form 111',       p.doc_medical_form_111),
      (8,  'SI record copy',         p.doc_si_record_copy),
      (9,  'SI form 1',              p.doc_si_form_1),
      (10, 'Contract',               p.doc_contract)
    ) as t(ord, label, present)
   where not present;
$function$;

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
