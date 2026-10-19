-- =====================================================================
-- Every employee has a bus route.
--
-- The form is dropping its empty option, so the question is answered for
-- everybody or for nobody. Half the records hold null, which on screen
-- would be a dropdown showing nothing with no way back to a blank -- so
-- they are filled in here, once and visibly, rather than drifting into
-- None the next time somebody happens to open and save them.
--
-- Null meant "nobody asked"; None means "does not take the bus". For
-- these records those are the same thing, and nobody can tell them apart
-- now anyway.
--
-- The column gets None as its default and stops accepting null, so the
-- rule holds for anything that writes an employee, not only this form.
-- =====================================================================

do $$
declare
  v_none smallint;
begin
  select id into v_none from bus_routes where lower(name) = 'none' order by id limit 1;
  if v_none is null then
    raise exception 'The None bus route is missing; 20261019180001 must run first.';
  end if;

  update employees set bus_route_id = v_none where bus_route_id is null;

  -- The employees table carries deferrable constraint triggers, and a
  -- table with trigger events still queued refuses to be altered. Firing
  -- them now clears the queue; it also means any one of them that would
  -- have failed fails here, before the column is changed.
  set constraints all immediate;

  execute format('alter table employees alter column bus_route_id set default %s', v_none);
  alter table employees alter column bus_route_id set not null;
end $$;

comment on column employees.bus_route_id is
  'Which company bus the employee takes. Never null: None is a route, so "does not take the bus" is recorded rather than left blank.';
