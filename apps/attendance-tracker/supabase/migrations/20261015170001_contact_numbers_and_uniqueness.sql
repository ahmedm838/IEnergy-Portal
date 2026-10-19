-- =====================================================================
-- Company mobile / office number, and uniqueness on the identifying fields.
-- =====================================================================

alter table employees
  add column if not exists company_mobile text,
  add column if not exists office_number  text;

comment on column employees.company_mobile is 'Company-issued mobile number';
comment on column employees.office_number  is 'Desk or extension number';

-- ---------------------------------------------------------------------
-- Resolve the one existing collision before the constraint goes on:
-- employees #2 and #3 both carry S.I. No. 12345678. #3's is cleared,
-- which touches that single field and leaves both employees and all of
-- their attendance records intact.
-- ---------------------------------------------------------------------

update employees
   set si_no = null
 where code = 3
   and btrim(si_no) = '12345678';

-- ---------------------------------------------------------------------
-- Uniqueness.
--
-- Compared case-insensitively and with surrounding spaces stripped, so
-- " Ahmed  " cannot slip past as different from "Ahmed". Blank strings
-- are excluded alongside NULLs: an unfilled optional field is absent, and
-- several of them must not collide with each other.
--
-- code already carries a unique constraint from the original schema, and
-- email has employees_email_lower_idx.
-- ---------------------------------------------------------------------

create unique index if not exists employees_name_unique_idx
  on employees (lower(btrim(name)))
  where btrim(name) <> '';

create unique index if not exists employees_si_no_unique_idx
  on employees (btrim(si_no))
  where si_no is not null and btrim(si_no) <> '';

-- Tighten the existing email index so a blank string cannot be stored
-- twice; the app already writes NULL for an empty box, but the database
-- should not depend on the app getting that right.
drop index if exists employees_email_lower_idx;
create unique index if not exists employees_email_lower_idx
  on employees (lower(btrim(email)))
  where email is not null and btrim(email) <> '';
