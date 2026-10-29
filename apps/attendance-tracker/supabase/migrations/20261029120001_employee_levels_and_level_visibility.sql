-- =====================================================================
-- Job levels, and a visibility rule built on them.
--
-- THE LEVELS, from the attached sheet. L7 is the highest.
--
--   L7  Chief Executive Officer
--   L6  Director
--   L5  Senior Manager
--   L4  Manager
--   L3  Section Head/Senior/Supervisor
--   L2  Engineer/Specialist
--   L1  Worker
--
-- `rank` is the number in the code, held as its own column rather than
-- parsed out of the text: the comparison below is the whole point of
-- this table and it should not depend on substring arithmetic. A level
-- inserted between two others later gets a rank between theirs, and
-- nothing else has to change.
--
-- ---------------------------------------------------------------------
-- THE RULE. A 'user' sees, within their own department, the people
-- below them. Not their own level, not above it.
--
-- This REPLACES the sector rule applied on 27 Oct, and it narrows in two
-- directions at once:
--
--   scope   sector-wide  ->  department-wide
--   people  everyone     ->  strictly lower rank only
--
-- READ THIS BEFORE APPLYING. can_see_employee() is not only the employee
-- list. It is also the read policy on attendance_records and on
-- adjustments, and adjustments carries money -- incentive, bonus,
-- penalties, salary adjustment, salary advance. All three narrow
-- together. The reports follow on their own, because
-- report_employee_summary and the dashboard run as the caller.
--
-- AND THE DAY THIS IS APPLIED, EVERY EXISTING EMPLOYEE HAS NO LEVEL.
-- level_id is null on every row until somebody sets it, and null has no
-- rank to compare. So on the morning after this is applied, every person
-- whose role is 'user' sees themself and nobody else, and keeps seeing
-- only themself until levels are filled in. Admins and super admins are
-- unaffected -- they see everyone, as before. This is a deliberate
-- choice: a null level must not be treated as "below everything", or an
-- unfilled record would be the most visible one in the company.
--
-- SELF IS ALWAYS VISIBLE. "Same level employees cannot see each other"
-- is read as being about other people. A person who could not read their
-- own row would have no dashboard, no employee report and no attendance
-- -- the app would be empty for them. The self test stays first, exactly
-- as it has since the original rules.
--
-- WHAT IS UNCHANGED.
--   * admin and super_admin see everyone. is_admin() covers both.
--   * no_access sees nothing.
--   * Writing. A user has never been able to write; the write policies
--     still say is_admin().
-- =====================================================================

-- ---------------------------------------------------------------------
-- The table.
-- ---------------------------------------------------------------------
create table if not exists employee_levels (
  id         smallint generated always as identity primary key,
  code       text     not null unique,
  name       text     not null,
  -- Higher number, higher level. The comparison the rule is made of.
  rank       smallint not null unique,
  sort_order smallint not null default 0
);

comment on table employee_levels is
  'Job grades. rank orders them: higher is more senior, and is what the visibility rule compares.';

-- Seeded by code, so re-running this changes nothing and does not
-- renumber anybody's level_id.
insert into employee_levels (code, name, rank, sort_order)
values
  ('L7', 'Chief Executive Officer',        7, 1),
  ('L6', 'Director',                       6, 2),
  ('L5', 'Senior Manager',                 5, 3),
  ('L4', 'Manager',                        4, 4),
  ('L3', 'Section Head/Senior/Supervisor', 3, 5),
  ('L2', 'Engineer/Specialist',            2, 6),
  ('L1', 'Worker',                         1, 7)
on conflict (code) do nothing;

-- The lookup-table policies, same shape as sites and departments:
-- readable by any signed-in user who is not 'no_access', written by
-- admins. Stated here rather than added to the loop in the original
-- RLS migration, which has already run.
alter table employee_levels enable row level security;

drop policy if exists employee_levels_read  on employee_levels;
drop policy if exists employee_levels_write on employee_levels;

create policy employee_levels_read on employee_levels
  for select to authenticated
  using (my_role() <> 'no_access'::app_role);

create policy employee_levels_write on employee_levels
  for all to authenticated
  using (is_admin()) with check (is_admin());

grant select on employee_levels to authenticated;
grant insert, update, delete on employee_levels to authenticated;

-- ---------------------------------------------------------------------
-- The column.
--
-- Nullable, and it has to be: every existing row predates it, and a NOT
-- NULL column with no default cannot be added to a table with rows in
-- it. The Employee Database page requires it on save, which is where
-- "mandatory" is enforced -- see the note at the top about what a null
-- level means for visibility until the records are filled in.
--
-- on delete restrict: a level that somebody holds cannot be deleted out
-- from under them. Silently nulling it would silently change who can see
-- whom, which is the one thing this table must not do quietly.
-- ---------------------------------------------------------------------
alter table employees
  add column if not exists level_id smallint
    references employee_levels (id) on delete restrict;

comment on column employees.level_id is
  'Job grade. Null means unset: such an employee is visible to admins and to themself only.';

-- level_id joins the hot read path -- every employee row read compares
-- it -- on the same reasoning as employees_department_idx.
create index if not exists employees_level_idx on employees (level_id);

-- ---------------------------------------------------------------------
-- The caller's own rank.
--
-- SECURITY DEFINER for the reason every helper here is: a policy on
-- employees that reads employees would recurse. Null when the caller has
-- no employee row or no level, and null is what makes the comparison
-- below false rather than true.
-- ---------------------------------------------------------------------
create or replace function my_level_rank()
returns smallint
language sql
stable
security definer
set search_path = public
as $$
  select l.rank
    from employees e
    join employee_levels l on l.id = e.level_id
   where e.auth_user_id = auth.uid()
   limit 1;
$$;

comment on function my_level_rank() is
  'The rank of the signed-in employee''s level, or null when they have no level.';

grant execute on function my_level_rank() to authenticated;

-- ---------------------------------------------------------------------
-- Is that employee below me, in my department?
--
-- One function, so the employees policy and can_see_employee() cannot
-- drift apart -- they are the same question asked about the same row,
-- and when they disagree an employee appears in a list whose attendance
-- then refuses to load.
--
-- Every comparison here is false when either side is null, which is the
-- behaviour wanted at both ends: no level of my own, or no level on
-- them, and the answer is no.
-- ---------------------------------------------------------------------
create or replace function is_below_me(p_department_id smallint, p_level_id smallint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    p_department_id = my_department_id()
    and (select l.rank from employee_levels l where l.id = p_level_id) < my_level_rank(),
    false
  );
$$;

comment on function is_below_me(smallint, smallint) is
  'True when that department is the caller''s and that level ranks strictly below the caller''s. False if either level is unset.';

grant execute on function is_below_me(smallint, smallint) to authenticated;

-- ---------------------------------------------------------------------
-- The shared scope test: employees, attendance_records, adjustments.
--
-- The super_admin branch stays. It was added on 27 Oct and the reasoning
-- is in that migration: the original CASE was written before the role
-- existed and fell through to false, which left a super admin unable to
-- read any attendance record or adjustment at all.
-- ---------------------------------------------------------------------
create or replace function can_see_employee(p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case my_role()
    when 'admin' then true
    when 'super_admin' then true
    when 'user'  then exists (
        select 1 from employees e
         where e.id = p_employee_id
           and (e.id = my_employee_id()
                or is_below_me(e.department_id, e.level_id))
      )
    else false
  end;
$$;

comment on function can_see_employee(uuid) is
  'Is this employee inside the caller''s scope? Admins: everyone. A user: themself, and the people below their level in their own department.';

-- ---------------------------------------------------------------------
-- The employees list itself. Same question, same helper.
-- ---------------------------------------------------------------------
drop policy if exists employees_read on employees;

create policy employees_read on employees
  for select to authenticated
  using (
    is_admin()
    or (
      my_role() = 'user'::app_role
      and (
        auth_user_id = auth.uid()
        or is_below_me(department_id, level_id)
      )
    )
  );

-- ---------------------------------------------------------------------
-- The contacts directory gains the level.
--
-- NOTE ON WHAT THIS PUBLISHES. employee_contacts is readable by anon,
-- deliberately -- see the 20261018100001 migration header. It already
-- carries every active employee's name, job title, department, site,
-- email and both phone numbers; the grade now joins them. That is a
-- widening of what an anonymous reader can see, small beside what is
-- already there, and it is what the contacts list was asked to show.
--
-- The new column goes last because CREATE OR REPLACE VIEW can only
-- append -- putting `level` where it reads best would mean dropping the
-- view, and dropping it drops the grants with it.
-- ---------------------------------------------------------------------
create or replace view employee_contacts as
  select
    e.code,
    e.name,
    e.title,
    d.name as department,
    s.name as site,
    e.email,
    e.company_mobile,
    e.office_number,
    e.code::text as code_text,
    l.code as level
  from employees e
  left join departments d       on d.id = e.department_id
  left join sites s             on s.id = e.site_id
  left join employee_levels l   on l.id = e.level_id
  where e.is_active;

comment on view employee_contacts is
  'Narrow read-only contact directory for the portal. Intentionally readable by anon; see the 20261018100001 migration header. code_text exists so the portal can pattern-match on the code. level is the grade code, e.g. L4.';

grant select on employee_contacts to anon, authenticated;

-- ---------------------------------------------------------------------
-- employee_profiles carries level_id.
--
-- Both the edit form and the Excel export read this view with select *,
-- so without this the Level box would open empty on a record that has
-- one and the export column would be blank on every row.
--
-- Appended, for the same reason as above: CREATE OR REPLACE VIEW can add
-- columns only at the end, and dropping the view would drop its grants
-- and anything depending on it. Only level_id is added -- the id, like
-- site_id and department_id beside it, with the page resolving the label
-- from its own lookup list.
-- ---------------------------------------------------------------------
create or replace view public.employee_profiles
with (security_invoker = true)
as
select
  e.id, e.auth_user_id, e.code, e.name, e.si_no, e.title, e.email,
  e.site_id, e.department_id, e.has_meal, e.has_allowance, e.has_overtime,
  e.has_incentive, e.has_deductions, e.status_id, e.annual_leave_balance,
  e.unplanned_leave_balance, e.role, e.hired_on, e.is_active, e.created_at,
  e.updated_at, e.username, e.company_mobile, e.office_number, e.arabic_name,
  e.national_id, e.id_expiry_date, e.weekend, e.si_date, e.si_basic_wage,
  e.si_gross_wage, e.si_code, e.personal_mobile, e.secondary_mobile,
  e.secondary_mobile_name, e.bus_route_id, e.military_service, e.marital_status,
  e.religion, e.qualification_degree_id, e.education_field, e.notice_date,
  e.resignation_date, e.resignation_reason, e.doc_graduation_certificate,
  e.doc_military_certificate, e.doc_birth_certificate, e.doc_criminal_clearance,
  e.doc_id_copy, e.doc_personal_photos, e.doc_medical_form_111,
  e.doc_si_record_copy, e.doc_si_form_1, e.doc_contract,
  id_birth_date(e.national_id) as birth_date,
  id_gender(e.national_id) as gender,
  id_governorate_code(e.national_id) as governorate_code,
  g.name_ar as governorate,
  s.title as si_title,
  d.name_en as qualification_degree,
  d.name_ar as qualification_degree_ar,
  b.name as bus_route,
  (e.hired_on - interval '1 day' + make_interval(years => 1 + e.renewals))::date as contract_expiry,
  missing_documents(e) as missing_documents,
  cardinality(missing_documents(e)) = 0 as file_complete,
  e.renewals,
  e.level_id
from public.employees e
left join public.governorates g on g.code = id_governorate_code(e.national_id)
left join public.si_codes s on s.code = e.si_code
left join public.qualification_degrees d on d.id = e.qualification_degree_id
left join public.bus_routes b on b.id = e.bus_route_id;

comment on view public.employee_profiles is
  'Employee profiles with derived identity, insurance title, contract expiry including renewals, missing personnel documents, and job level. Uses caller row-level security.';

grant select on public.employee_profiles to authenticated;

-- ---------------------------------------------------------------------
-- The levels join the one-call reference data, so the tracker does not
-- go back to a request per table for them.
--
-- Nothing else about app_lookups() changes; the key is added, and a
-- client that does not read it is unaffected.
-- ---------------------------------------------------------------------
create or replace function app_lookups()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'sites', coalesce((
      select jsonb_agg(to_jsonb(s) order by s.sort_order, s.id) from sites s
    ), '[]'::jsonb),

    'sectors', coalesce((
      select jsonb_agg(to_jsonb(s) order by s.sort_order, s.id) from sectors s
    ), '[]'::jsonb),

    'departments', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id', d.id,
                 'name', d.name,
                 'sector_id', d.sector_id,
                 'sort_order', d.sort_order,
                 'sectors', (
                   select jsonb_build_object('id', sec.id, 'name', sec.name)
                   from sectors sec where sec.id = d.sector_id
                 )
               )
               order by d.sort_order, d.id
             )
      from departments d
    ), '[]'::jsonb),

    'statuses', coalesce((
      select jsonb_agg(to_jsonb(s) order by s.sort_order, s.id)
      from employee_statuses s
    ), '[]'::jsonb),

    'types', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.sort_order, t.id)
      from attendance_types t
    ), '[]'::jsonb),

    'bus_routes', coalesce((
      select jsonb_agg(to_jsonb(b) order by b.sort_order, b.id)
      from bus_routes b
    ), '[]'::jsonb),

    'levels', coalesce((
      select jsonb_agg(to_jsonb(l) order by l.sort_order, l.id)
      from employee_levels l
    ), '[]'::jsonb),

    'settings', coalesce((
      select jsonb_agg(to_jsonb(a) order by a.key) from app_settings a
    ), '[]'::jsonb)
  );
$$;

grant execute on function app_lookups() to authenticated;

notify pgrst, 'reload schema';
