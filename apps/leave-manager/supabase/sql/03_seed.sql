
-- 03_seed.sql
-- Seed roles and leave types per specification

insert into public.roles(name)
values ('Admin'), ('User')
on conflict (name) do nothing;

-- Leave types with deduction mapping:
-- Planned + Forced => deduct planned
-- Un-Planned => deduct unplanned
-- Others => none
insert into public.leave_types(name, deduct_from)
values
  ('Planned', 'planned'),
  ('Un-Planned', 'unplanned'),
  ('Sick', 'none'),
  ('Un-paid', 'none'),
  ('Maternity/Paternity', 'none'),
  ('Forced', 'planned'),
  ('Compensatory', 'none'),
  ('Granted', 'none'),
  ('Bereavement', 'none'),
  ('Absent', 'none')
on conflict (name) do update set deduct_from = excluded.deduct_from;

