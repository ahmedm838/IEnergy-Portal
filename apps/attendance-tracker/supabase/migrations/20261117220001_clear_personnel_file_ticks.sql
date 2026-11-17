-- =====================================================================
-- Clear the personnel-file ticks made before attachments existed.
--
-- From b1806c2 a box is ticked only by uploading its PDF. The ticks
-- already on record had no file behind them, so on the user's decision
-- (17 Nov 2026) they were all cleared. The old values are kept in
-- personnel_file_ticks_backup_20261117 (no API access) should any need
-- restoring.
-- =====================================================================

create table if not exists public.personnel_file_ticks_backup_20261117 as
select id, doc_graduation_certificate, doc_military_certificate, doc_birth_certificate,
       doc_criminal_clearance, doc_id_copy, doc_personal_photos, doc_medical_form_111,
       doc_si_record_copy, doc_si_form_1, doc_contract, now() as backed_up_at
  from public.employees;
alter table public.personnel_file_ticks_backup_20261117 enable row level security;
revoke all on public.personnel_file_ticks_backup_20261117 from anon, authenticated;

update public.employees set
  doc_graduation_certificate = false, doc_military_certificate = false,
  doc_birth_certificate = false, doc_criminal_clearance = false, doc_id_copy = false,
  doc_personal_photos = false, doc_medical_form_111 = false, doc_si_record_copy = false,
  doc_si_form_1 = false, doc_contract = false;
