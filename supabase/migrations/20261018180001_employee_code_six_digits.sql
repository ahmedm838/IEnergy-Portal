-- =====================================================================
-- Employee codes are at least six digits.
--
-- code is an integer, so a leading zero cannot be stored in the first
-- place -- "not starting with zero" and "at least six digits" are the
-- same rule here, and it is simply a minimum of 100000.
--
-- Changing a code is safe: attendance_records and adjustments reference
-- the employee's internal id, not the code, so nothing is re-pointed and
-- no history moves. The code is a human label, and that is all.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Bring the existing rows up to the new shape first, or the constraint
-- below cannot be added.
--
-- Written as a loop over whatever is actually there rather than a
-- hardcoded mapping of the four rows in this database today: the
-- bootstrap migration inserts Ahmed Moustafa as code 1, so a fresh
-- install arrives here needing exactly the same treatment.
--
-- Numbers are handed out in the order the codes are in now, continuing
-- after the highest six-digit code already in use, so an existing code is
-- never collided with.
-- ---------------------------------------------------------------------

do $$
declare
  r          record;
  next_code  integer;
begin
  select coalesce(max(code), 100000) into next_code
    from employees
   where code >= 100000;

  for r in select id, code from employees where code < 100000 order by code loop
    next_code := next_code + 1;
    update employees set code = next_code where id = r.id;
    raise notice 'employee code % is now %', r.code, next_code;
  end loop;
end $$;

-- The leave-balance guard on employees is a DEFERRABLE constraint
-- trigger, so the updates above leave pending trigger events, and
-- PostgreSQL refuses to ALTER a table that has any. Firing them now both
-- clears that and checks the renumbered rows still satisfy the guard --
-- they do, since only the code moved.
set constraints all immediate;

-- ---------------------------------------------------------------------
-- The rule itself. A check constraint rather than application code: the
-- Employees form is not the only way a row can arrive, and a rule that
-- lives next to the column cannot be bypassed by the REST API or by a
-- later page that forgets it.
-- ---------------------------------------------------------------------

alter table employees
  drop constraint if exists employees_code_min_six_digits;

alter table employees
  add constraint employees_code_min_six_digits check (code >= 100000);

comment on column employees.code is
  'Human-facing employee number. At least six digits (>= 100000); stored as an integer, so it can never carry a leading zero.';
