-- =====================================================================
-- The employee profile fields from the "Database Fields" workbook.
--
-- Every one is nullable. The four employees already on file have none of
-- this recorded, and a NOT NULL would make the table unwritable until
-- somebody went and filled in thirty fields for each of them. The rules
-- below therefore all read "null, or the right shape".
--
-- Hiring Date is not added: employees.hired_on already holds it.
-- S.I. No. is likewise already there as si_no, and is a different thing
-- from the S.I. Code added here -- one is the employee's insurance
-- number, the other is the official job-title code.
-- =====================================================================

alter table employees
  add column if not exists arabic_name              text,
  add column if not exists national_id              text,
  add column if not exists id_expiry_date           date,
  add column if not exists weekend                  text not null default 'fri_sat',
  add column if not exists si_date                  date,
  add column if not exists si_basic_wage            numeric(7,2),
  add column if not exists si_gross_wage            numeric(7,2),
  add column if not exists si_code                  text,
  add column if not exists personal_mobile          text,
  add column if not exists secondary_mobile         text,
  add column if not exists secondary_mobile_name    text,
  add column if not exists bus_route_id             smallint,
  add column if not exists military_service         text,
  add column if not exists marital_status           text,
  add column if not exists religion                 text,
  add column if not exists qualification_degree_id  smallint,
  add column if not exists education_field          text,
  add column if not exists notice_date              date,
  add column if not exists resignation_date         date,
  add column if not exists resignation_reason       text;

-- The personnel file checklist. Named with a doc_ prefix so the eleven of
-- them stay together and cannot be confused with the payroll switches.
alter table employees
  add column if not exists doc_graduation_certificate boolean not null default false,
  add column if not exists doc_military_certificate   boolean not null default false,
  add column if not exists doc_birth_certificate      boolean not null default false,
  add column if not exists doc_fingerprint_record     boolean not null default false,
  add column if not exists doc_id_copy                boolean not null default false,
  add column if not exists doc_personal_photos        boolean not null default false,
  add column if not exists doc_medical_form_111       boolean not null default false,
  add column if not exists doc_si_record_copy         boolean not null default false,
  add column if not exists doc_si_form_1              boolean not null default false,
  add column if not exists doc_si_form_6              boolean not null default false,
  add column if not exists doc_contract               boolean not null default false;

-- ---------------------------------------------------------------------
-- Foreign keys to the reference lists.
-- ---------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'employees_si_code_fkey') then
    alter table employees add constraint employees_si_code_fkey
      foreign key (si_code) references si_codes (code);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'employees_bus_route_fkey') then
    alter table employees add constraint employees_bus_route_fkey
      foreign key (bus_route_id) references bus_routes (id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'employees_degree_fkey') then
    alter table employees add constraint employees_degree_fkey
      foreign key (qualification_degree_id) references qualification_degrees (id);
  end if;
end $$;

create index if not exists employees_si_code_idx     on employees (si_code);
create index if not exists employees_bus_route_idx   on employees (bus_route_id);
create index if not exists employees_degree_idx      on employees (qualification_degree_id);
create unique index if not exists employees_national_id_uq
  on employees (national_id) where national_id is not null;

-- ---------------------------------------------------------------------
-- The rules.
-- ---------------------------------------------------------------------

alter table employees drop constraint if exists employees_national_id_format;
alter table employees add constraint employees_national_id_format
  check (national_id is null or national_id ~ '^[23][0-9]{13}$');

-- "Arabic letters only", enforced as "no Latin letters and no digits"
-- rather than a whitelist of Arabic code points: a whitelist has to
-- enumerate diacritics, the hamza forms and the tatweel, and quietly
-- rejects a legitimate name the day it misses one.
alter table employees drop constraint if exists employees_arabic_name_script;
alter table employees add constraint employees_arabic_name_script
  check (arabic_name is null or arabic_name !~ '[A-Za-z0-9]');

alter table employees drop constraint if exists employees_weekend_valid;
alter table employees add constraint employees_weekend_valid
  check (weekend in ('fri_sat', 'fri'));

-- Five digits is the stated maximum, so the ceiling is 99999.
alter table employees drop constraint if exists employees_si_basic_wage_range;
alter table employees add constraint employees_si_basic_wage_range
  check (si_basic_wage is null or (si_basic_wage >= 5500 and si_basic_wage <= 99999));

alter table employees drop constraint if exists employees_si_gross_wage_range;
alter table employees add constraint employees_si_gross_wage_range
  check (si_gross_wage is null or (si_gross_wage >= 7100 and si_gross_wage <= 99999));

-- Same shape as company_mobile, for the same reason: stored formatted so
-- every page that prints one gets it right without its own pass.
alter table employees drop constraint if exists employees_personal_mobile_format;
alter table employees add constraint employees_personal_mobile_format
  check (personal_mobile is null or personal_mobile ~ '^0[0-9]{2}-[0-9]{4}-[0-9]{4}$');

alter table employees drop constraint if exists employees_secondary_mobile_format;
alter table employees add constraint employees_secondary_mobile_format
  check (secondary_mobile is null or secondary_mobile ~ '^0[0-9]{2}-[0-9]{4}-[0-9]{4}$');

alter table employees drop constraint if exists employees_military_service_valid;
alter table employees add constraint employees_military_service_valid
  check (military_service is null or military_service in ('Served', 'Postponed', 'Exempted'));

alter table employees drop constraint if exists employees_marital_status_valid;
alter table employees add constraint employees_marital_status_valid
  check (marital_status is null or marital_status in ('Single', 'Married', 'Divorced'));

alter table employees drop constraint if exists employees_religion_valid;
alter table employees add constraint employees_religion_valid
  check (religion is null or religion in ('Muslim', 'Christian'));

comment on column employees.weekend is
  'Which days the employee rests: fri_sat (Friday and Saturday) or fri (Friday only).';
comment on column employees.national_id is
  'Egyptian national ID: 14 digits beginning 2 (born 19xx) or 3 (born 20xx). Birth date, gender and governorate are read back out of it rather than stored again.';

-- ---------------------------------------------------------------------
-- Values that live inside the national ID.
--
-- Read out on demand rather than stored in their own columns: a second
-- copy of a birth date is a second thing to keep in step, and the ID is
-- already the authority. Each returns null for an ID that is missing or
-- malformed, so a half-entered record still saves and still reads.
-- ---------------------------------------------------------------------

create or replace function id_birth_date(p_id text)
returns date
language plpgsql
immutable
as $fn$
declare
  y integer; m integer; d integer;
begin
  if p_id is null or p_id !~ '^[23][0-9]{13}$' then return null; end if;
  y := (case substr(p_id, 1, 1) when '2' then 1900 else 2000 end) + substr(p_id, 2, 2)::int;
  m := substr(p_id, 4, 2)::int;
  d := substr(p_id, 6, 2)::int;
  return make_date(y, m, d);
exception
  -- The digits are in the right places but do not name a real day, such
  -- as the 31st of February. A null reads as "not known" rather than
  -- taking the whole row down.
  when others then return null;
end $fn$;

create or replace function id_gender(p_id text)
returns text
language sql
immutable
as $fn$
  select case
    when p_id ~ '^[23][0-9]{13}$'
    then case when substr(p_id, 13, 1)::int % 2 = 1 then 'Male' else 'Female' end
  end;
$fn$;

create or replace function id_governorate_code(p_id text)
returns smallint
language sql
immutable
as $fn$
  select case when p_id ~ '^[23][0-9]{13}$' then substr(p_id, 8, 2)::smallint end;
$fn$;

-- ---------------------------------------------------------------------
-- Which documents are still missing from the personnel file.
--
-- Returns the names rather than a count, because "missing" on its own
-- sends somebody back to the table to work out which.
-- ---------------------------------------------------------------------

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
      (10, 'SI form 6',              p.doc_si_form_6),
      (11, 'Contract',               p.doc_contract)
    ) as t(ord, label, present)
   where not present;
$fn$;

grant execute on function id_birth_date(text), id_gender(text),
                          id_governorate_code(text) to authenticated;

-- ---------------------------------------------------------------------
-- One row per employee with everything the Database page shows,
-- derivations included.
--
-- security_invoker is the important word. On PostgreSQL a view runs with
-- its owner's rights by default, which would hand every signed-in account
-- the national IDs and insurance wages of everyone in the company,
-- straight past the row level security on employees. With it, the view
-- sees exactly what the person querying it is allowed to see.
-- ---------------------------------------------------------------------

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
  missing_documents(e)                      as missing_documents,
  cardinality(missing_documents(e)) = 0     as file_complete
from employees e
left join governorates g          on g.code = id_governorate_code(e.national_id)
left join si_codes s              on s.code = e.si_code
left join qualification_degrees d on d.id   = e.qualification_degree_id
left join bus_routes b            on b.id   = e.bus_route_id;

comment on view employee_profiles is
  'Employee rows with the values that are derived rather than stored: birth date, gender and governorate out of the national ID, the insurance job title, and which documents are still missing. Runs as the caller, so row level security applies.';

grant select on employee_profiles to authenticated;
