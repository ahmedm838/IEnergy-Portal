-- =====================================================================
-- Personnel file: the military certificate is not asked of women.
--
-- The Employee Database page now attaches a PDF to each personnel-file
-- box, and the box is ticked by uploading and unticked by deleting
-- (api/employee-file.php writes the doc_ flag). For a female ID No. the
-- military box and its buttons are disabled, so it can never be ticked
-- -- which would leave every woman's file "Missing (1)" forever.
--
-- So missing_documents skips it when id_gender says Female. Same
-- signature, so employee_profiles picks the change up as it is.
-- =====================================================================

create or replace function public.missing_documents(p public.employees)
returns text[]
language sql
stable
as $$
  select coalesce(array_agg(label order by ord), array[]::text[])
    from (values
      (1,  'Graduation certificate', p.doc_graduation_certificate),
      (2,  'Military service',       p.doc_military_certificate
                                       or coalesce(id_gender(p.national_id) = 'Female', false)),
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
$$;
