-- =====================================================================
-- Employee codes are six digits beginning with 2.
--
-- The existing rule is "at least 100000", which the six records on file
-- were renumbered to meet. The new rule is narrower -- exactly six
-- digits, starting with 2 -- and those six records do not meet it.
--
-- A check constraint is therefore the wrong instrument: adding one would
-- be refused outright, and forcing it through would mean renumbering
-- people whose codes are already written on paper files. What this does
-- instead is refuse a code that breaks the rule at the moment somebody
-- writes one: on insert always, and on update only when the code itself
-- is being changed. A record nobody touches keeps the code it has; the
-- first person to change one has to put it in the new band.
--
-- The old check stays in place underneath, so nothing can drop below six
-- digits by any route.
-- =====================================================================

create or replace function enforce_code_band()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and new.code is not distinct from old.code then
    return new;
  end if;

  if new.code < 200000 or new.code > 299999 then
    raise exception
      'employees_code_band: employee code must be exactly 6 digits starting with 2 (200000 to 299999), not %',
      new.code
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function enforce_code_band() is
  'Refuses an employee code outside 200000-299999 as it is written. Codes that predate the rule are left alone until somebody changes one.';

drop trigger if exists employees_code_band on employees;

create trigger employees_code_band
before insert or update of code on employees
for each row
execute function enforce_code_band();
