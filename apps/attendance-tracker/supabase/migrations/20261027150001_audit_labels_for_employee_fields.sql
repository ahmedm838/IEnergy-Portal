-- =====================================================================
-- Employee changes read like the form they were made on.
--
-- Changes to employee records were already being logged: the employees
-- table has carried a trigger since 20261027140001, the Employee
-- Database page writes to that same table in that same project, and its
-- edits land in the same export under the same columns. Nothing about
-- what is captured changes here.
--
-- What changes is whether the lines can be read. audit_field_label knew
-- about a dozen columns and fell back to the column name with its
-- underscores opened out for the rest, which is fine for "Work date" and
-- poor for the employee record's forty-nine fields:
--
--   Doc Graduation Certificate   ->  Document: Graduation certificate
--   Has Meal                     ->  Payroll: Meal
--   Si Basic Wage                ->  S.I. basic wage
--   Secondary Mobile Name        ->  Secondary number belongs to
--
-- The labels below are the Employee Database page's own, read out of its
-- field definitions rather than invented here, so the log says what the
-- person clicking Save was looking at.
--
-- Two columns collided. military_service is the field on the record and
-- doc_military_certificate is the tick box for the certificate, and both
-- were labelled "Military service" -- in a log that is worse than a
-- clumsy name, because two different changes read identically. The
-- documents are prefixed "Document:" and the payroll switches "Payroll:",
-- which separates them and groups them at the same time.
--
-- weekend is given its words too. 'fri_sat' is what is stored and
-- "Friday + Saturday" is what the form offers.
-- =====================================================================

create or replace function audit_field_label(p_column text)
returns text
language sql
immutable
as $function$
  select coalesce(
    (select v from (values
      -- Attendance
      ('attendance_type_id',       'Attendance type'),
      ('work_date',                'Work date'),
      ('late_minutes',             'Late (minutes)'),
      ('transport',                'Transport'),
      ('add_to_leave_balance',     'Add to leave balance'),
      ('clock_in',                 'Clock in'),
      ('clock_out',                'Clock out'),
      -- Adjustments
      ('adj_date',                 'Adjustment date'),
      ('incentive',                'Incentive'),
      ('bonus',                    'Bonus'),
      ('penalties',                'Penalties (days)'),
      ('adjusted_days',            'Adjusted days'),
      ('adjusted_minutes',         'Adjusted hours (minutes)'),
      ('salary_adjust',            'Salary adjustment'),
      ('salary_advance',           'Salary advance'),
      -- Employee record: identity
      ('code',                     'Code'),
      ('name',                     'Name (English)'),
      ('arabic_name',              'Arabic name as in ID'),
      ('national_id',              'ID No.'),
      ('id_expiry_date',           'ID expiry date'),
      -- Employee record: employment
      ('title',                    'Job title'),
      ('site_id',                  'Site'),
      ('department_id',            'Department'),
      ('weekend',                  'Weekend'),
      ('bus_route_id',             'Bus route'),
      ('hired_on',                 'Hiring date'),
      ('renewals',                 'Renewals'),
      ('annual_leave_balance',     'Annual leave (days)'),
      ('unplanned_leave_balance',  'Un-planned leave (days)'),
      ('status_id',                'Status'),
      -- Employee record: social insurance
      ('si_no',                    'S.I. No.'),
      ('si_date',                  'S.I. date'),
      ('si_code',                  'S.I. code'),
      ('si_basic_wage',            'S.I. basic wage'),
      ('si_gross_wage',            'S.I. gross wage'),
      -- Employee record: contact
      ('email',                    'Email'),
      ('company_mobile',           'Company mobile'),
      ('personal_mobile',          'Personal mobile'),
      ('secondary_mobile',         'Secondary mobile'),
      ('secondary_mobile_name',    'Secondary number belongs to'),
      ('office_number',            'Office number'),
      -- Employee record: personal
      ('military_service',         'Military service'),
      ('marital_status',           'Marital status'),
      ('religion',                 'Religion'),
      ('qualification_degree_id',  'Qualification degree'),
      ('education_field',          'Education field'),
      -- Employee record: leaving
      ('notice_date',              'Notice date'),
      ('resignation_date',         'Resignation date'),
      ('resignation_reason',       'Resignation reason'),
      -- Documents. Prefixed so a tick box is not mistaken for the field
      -- of the same name -- doc_military_certificate and
      -- military_service both read "Military service" before this.
      ('doc_graduation_certificate', 'Document: Graduation certificate'),
      ('doc_military_certificate',   'Document: Military service'),
      ('doc_birth_certificate',      'Document: Birth certificate'),
      ('doc_criminal_clearance',     'Document: Criminal clearance'),
      ('doc_id_copy',                'Document: ID (copy)'),
      ('doc_personal_photos',        'Document: 6 personal photos'),
      ('doc_medical_form_111',       'Document: Medical form No. 111'),
      ('doc_si_record_copy',         'Document: SI record (copy)'),
      ('doc_si_form_1',              'Document: SI form 1 (copy)'),
      ('doc_contract',               'Document: Contract'),
      -- Payroll switches
      ('has_meal',                 'Payroll: Meal'),
      ('has_allowance',            'Payroll: Allowance'),
      ('has_overtime',             'Payroll: Overtime'),
      ('has_incentive',            'Payroll: Incentive'),
      ('has_deductions',           'Payroll: Deductions'),
      -- Access. Not on the Employee Database form, but the changes that
      -- matter most in a log of who did what.
      ('role',                     'Role'),
      ('is_active',                'Active'),
      ('username',                 'Username'),
      ('auth_user_id',             'Linked account'),
      -- Settings
      ('value',                    'Value'),
      ('description',              'Description'),
      ('note',                     'Note')
    ) as t(k, v) where t.k = p_column),
    initcap(replace(p_column, '_', ' ')));
$function$;

comment on function audit_field_label(text) is
  'The column, as the Employee Database and Attendance pages name it. Unlisted columns fall back to the column name opened out, so a column added later still reads as something.';

-- ---------------------------------------------------------------------
-- The weekend pattern in the words the form offers.
--
-- Everything else about this function is unchanged; the whole body is
-- restated because create or replace takes no patches.
-- ---------------------------------------------------------------------
create or replace function audit_value_label(p_column text, p_value jsonb)
returns text
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_id   bigint;
  v_text text;
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then
    return '(blank)';
  end if;

  if jsonb_typeof(p_value) = 'boolean' then
    return case when p_value::text = 'true' then 'yes' else 'no' end;
  end if;

  if p_column = 'weekend' then
    return case p_value #>> '{}'
             when 'fri_sat' then 'Friday + Saturday'
             when 'fri'     then 'Friday only'
             else p_value #>> '{}'
           end;
  end if;

  -- Only numeric keys are worth a lookup; anything else is already text.
  if jsonb_typeof(p_value) = 'number' then
    v_id := (p_value #>> '{}')::bigint;
    case p_column
      when 'attendance_type_id' then
        select name_en into v_text from attendance_types where id = v_id;
      when 'status_id' then
        select name into v_text from employee_statuses where id = v_id;
      when 'site_id' then
        select name into v_text from sites where id = v_id;
      when 'department_id' then
        select name into v_text from departments where id = v_id;
      when 'bus_route_id' then
        select name into v_text from bus_routes where id = v_id;
      when 'qualification_degree_id' then
        select name_en into v_text from qualification_degrees where id = v_id;
      else v_text := null;
    end case;
    if v_text is not null then
      return v_text;
    end if;
  end if;

  -- #>> '{}' unwraps a json string without leaving its quotes behind.
  return p_value #>> '{}';
end $function$;

grant execute on function
  audit_field_label(text),
  audit_value_label(text, jsonb)
  to authenticated;
