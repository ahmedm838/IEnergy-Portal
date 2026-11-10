-- =====================================================================
-- A 'user' sees the people below their level, sector-wide.
--
-- THE RULE, in the order it is applied: the caller's sector first, then
-- strictly lower level. An L4 sees L1, L2 and L3 anywhere in their
-- sector. Not L4, not L5 and above, and nothing outside the sector.
--
-- WHAT CHANGES. Only the scope: department becomes sector. The level
-- test is exactly as it was. On 29 Oct the scope was narrowed from
-- sector to department when levels arrived; this puts it back and
-- keeps the levels.
--
-- THIS WIDENS ACCESS, and in three places at once. is_below_me() is
-- not only the employee list -- can_see_employee() is built on it, and
-- that is the read policy on attendance_records and on adjustments.
-- Adjustments carry money: incentive, bonus, penalties, salary
-- adjustment, salary advance. So an L4 in Operations will now see the
-- pay figures of every L1 to L3 in Operations, not only those in their
-- own department. Operations holds seven departments, so for somebody
-- in HR that is a change from one to seven.
--
-- The reports follow on their own: report_employee_summary and the
-- dashboard run as the caller and read what these policies allow.
--
-- WHAT DOES NOT CHANGE.
--   * admin and super_admin see everyone. is_admin() covers both.
--   * no_access sees nothing.
--   * Writing. A user has never been able to write.
--   * Your own record is visible whatever your level or sector. The
--     self test stays first, as it has since the original rules: a
--     person who could not read their own row would have no dashboard,
--     no employee report and no attendance.
--   * A level that is not set still matches nothing. Null has no rank,
--     so a user with no level sees only themself, and an employee with
--     no level is visible to admins and to themself only. An unfilled
--     record must not become the most visible one in the company.
--
-- ONE FUNCTION, so the employees policy and can_see_employee() cannot
-- drift apart. They are the same question about the same row, and when
-- they disagree an employee appears in a list whose attendance then
-- refuses to load. Changing the scope here changes it everywhere, which
-- is the whole reason it was written this way.
-- =====================================================================

create or replace function is_below_me(p_department_id smallint, p_level_id smallint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    -- Sector, through the caller's own department. Empty array rather
    -- than null when the caller has no sector, so this reads false and
    -- falls back to their own record.
    p_department_id = any (my_sector_departments())
    and (select l.rank from employee_levels l where l.id = p_level_id) < my_level_rank(),
    false
  );
$$;

comment on function is_below_me(smallint, smallint) is
  'True when that department is in the caller''s sector and that level ranks strictly below the caller''s. False if either level is unset.';

-- can_see_employee() and the employees_read policy both call the above
-- and are unchanged. They are left exactly as they are on purpose:
-- re-stating them here would be two more places for this rule to live.

-- ---------------------------------------------------------------------
-- Prove it on the real database before this will apply.
--
-- The rule is read by three policies and a report; getting the
-- comparison backwards would not error anywhere, it would simply show
-- people the wrong colleagues. So the ranks are checked here.
-- ---------------------------------------------------------------------
do $$
declare
  v_l1 smallint;
  v_l4 smallint;
begin
  select rank into v_l1 from employee_levels where code = 'L1';
  select rank into v_l4 from employee_levels where code = 'L4';

  if v_l1 is null or v_l4 is null then
    raise exception 'L1 or L4 is missing from employee_levels; the visibility rule has nothing to compare.';
  end if;

  -- The example in the request: an L4 sees L1, and L1 does not see L4.
  if not (v_l1 < v_l4) then
    raise exception 'L1 does not rank below L4 (L1=%, L4=%), so "lower level" would read backwards.', v_l1, v_l4;
  end if;
end $$;

notify pgrst, 'reload schema';
