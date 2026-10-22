-- =====================================================================
-- "Military certificate" becomes "Military service" in the documents
-- list.
--
-- The label only. The column stays doc_military_certificate: unlike the
-- criminal clearance rename, where the stored name had drifted from what
-- the document is, this one still holds exactly what it says -- whether
-- a military certificate is in the personnel file. The tick means the
-- same thing before and after.
--
-- This label is not decoration. It comes back from missing_documents()
-- into employee_profiles.missing_documents, which the Employee Database
-- shows in its file-status panel and writes into the "Missing documents"
-- column of the export. Leaving it alone would have the checkbox say one
-- thing and the row beneath it say another.
--
-- create or replace rather than drop and recreate: the signature is
-- unchanged, so employee_profiles -- which calls this function twice --
-- keeps working without being rebuilt.
-- =====================================================================

create or replace function missing_documents(p employees)
returns text[]
language sql
stable
as $function$
  select coalesce(array_agg(label order by ord), array[]::text[])
    from (values
      (1,  'Graduation certificate', p.doc_graduation_certificate),
      (2,  'Military service',       p.doc_military_certificate),
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

comment on column employees.doc_military_certificate is
  'Whether the military service certificate is in the personnel file. Shown as "Military service" in the Database page and the export.';
