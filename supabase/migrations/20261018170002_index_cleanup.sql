-- =====================================================================
-- Index tidy-up.
--
-- Two indexes are exact duplicates of a unique constraint's own index --
-- same columns, same order, same method -- so they were being kept up to
-- date on every write and never chosen by the planner. Verified against
-- pg_indexes before dropping:
--
--   attendance_emp_date_idx (employee_id, work_date)
--     == attendance_records_employee_id_work_date_key, unique
--   employees_auth_idx (auth_user_id)
--     == employees_auth_user_id_key, unique
--
-- Dropping the non-unique copy changes nothing a query can see: a unique
-- btree serves every lookup the plain one did.
-- =====================================================================

drop index if exists attendance_emp_date_idx;
drop index if exists employees_auth_idx;

-- ---------------------------------------------------------------------
-- Foreign keys that are joined on but had no index of their own. None of
-- this is measurable at today's size, where a sequential scan of four
-- employees wins every time; it stops those joins degrading as the tables
-- fill.
--
-- employees.status_id is the one that earns its place soonest: every
-- attendance and adjustment write now joins it, through the guard that
-- only lets active employees be recorded.
-- ---------------------------------------------------------------------

create index if not exists employees_status_idx     on employees (status_id);
create index if not exists departments_sector_idx   on departments (sector_id);
create index if not exists locked_periods_locked_by_idx   on locked_periods (locked_by);
create index if not exists locked_periods_unlocked_by_idx on locked_periods (unlocked_by);

-- ---------------------------------------------------------------------
-- created_by and updated_by on attendance_records and adjustments are
-- also unindexed foreign keys, and are left that way on purpose. Nothing
-- queries by them. The only operation they would speed up is deleting an
-- auth user, which happens approximately never, and the cost would be
-- four more index writes on every attendance row saved -- the hottest
-- write path in the application. Not a trade worth making.
-- ---------------------------------------------------------------------
