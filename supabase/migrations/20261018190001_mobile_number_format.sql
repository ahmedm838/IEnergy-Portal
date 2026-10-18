-- =====================================================================
-- Company mobile numbers: eleven digits, starting with zero, stored as
-- 000-0000-0000.
--
-- The dashes are stored rather than added when displaying. Two places
-- show these numbers -- the Employees table here and the contacts card in
-- the company portal, a separate repository reading the same view -- and
-- keeping one canonical shape in the column means neither needs its own
-- formatting pass, and they cannot drift apart.
--
-- The column stays nullable. Not everyone has a company mobile, and a
-- blank is different from a wrong one.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Existing values first, or the constraint cannot be added.
--
-- Anything that is eleven digits beginning with zero is reformatted.
-- Anything else is cleared rather than trimmed into shape: padding or
-- truncating a wrong number invents a plausible one, and a number that
-- silently dials the wrong person is worse than an empty field.
-- ---------------------------------------------------------------------

do $$
declare
  r       record;
  digits  text;
  cleared integer := 0;
  fixed   integer := 0;
begin
  for r in select id, name, company_mobile from employees where company_mobile is not null loop
    digits := regexp_replace(r.company_mobile, '\D', '', 'g');

    if digits ~ '^0[0-9]{10}$' then
      update employees
         set company_mobile = substr(digits, 1, 3) || '-' || substr(digits, 4, 4) || '-' || substr(digits, 8, 4)
       where id = r.id;
      fixed := fixed + 1;
    else
      update employees set company_mobile = null where id = r.id;
      cleared := cleared + 1;
      raise notice 'cleared % for % -- % is not 11 digits starting with zero',
        r.company_mobile, r.name, digits;
    end if;
  end loop;

  raise notice '% number(s) reformatted, % cleared', fixed, cleared;
end $$;

-- The leave-balance guard on employees is a DEFERRABLE constraint
-- trigger, so the updates above leave pending trigger events and
-- PostgreSQL will not ALTER a table that has any.
set constraints all immediate;

-- ---------------------------------------------------------------------
-- The rule.
-- ---------------------------------------------------------------------

alter table employees
  drop constraint if exists employees_company_mobile_format;

alter table employees
  add constraint employees_company_mobile_format
  check (company_mobile is null or company_mobile ~ '^0[0-9]{2}-[0-9]{4}-[0-9]{4}$');

comment on column employees.company_mobile is
  'Company mobile, stored formatted as 000-0000-0000: eleven digits beginning with zero. Null when the employee has none.';
