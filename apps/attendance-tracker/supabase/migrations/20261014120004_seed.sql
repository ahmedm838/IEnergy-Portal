-- =====================================================================
-- IEnergy Attendance Tracker — reference data
-- Transcribed verbatim from Tables.xlsx. Idempotent: safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Sites  (Sites sheet)
-- ---------------------------------------------------------------------
insert into sites (name, available, sort_order) values
  ('Admin',     false, 1),
  ('Factory 1', true,  2),
  ('Factory 2', false, 3),
  ('Factory 3', false, 4),
  ('Remote',    false, 5)
on conflict (name) do update
  set available = excluded.available, sort_order = excluded.sort_order;

-- ---------------------------------------------------------------------
-- Sectors  (Sectors sheet)
-- ---------------------------------------------------------------------
insert into sectors (name, sort_order) values
  ('CEO', 1), ('Development', 2), ('Supply Chain', 3),
  ('Operations', 4), ('Finance', 5), ('Legal Affairs', 6)
on conflict (name) do update set sort_order = excluded.sort_order;

-- ---------------------------------------------------------------------
-- Departments  (Departments sheet)
-- Row 14 of the sheet is blank under Supply Chain and is skipped.
-- ---------------------------------------------------------------------
insert into departments (name, sector_id, sort_order)
select d.name, s.id, d.ord
from (values
  ('Puplic Relations',    'CEO',           1),
  ('Production',          'Operations',    2),
  ('Quality',             'Operations',    3),
  ('Engineering',         'Operations',    4),
  ('Human Resources',     'Operations',    5),
  ('HSE',                 'Operations',    6),
  ('Transportation',      'Operations',    7),
  ('Maintenance',         'Operations',    8),
  ('Tendering',           'Supply Chain',  9),
  ('Local Purchasing',    'Supply Chain', 10),
  ('Foreign Purchasing',  'Supply Chain', 11),
  ('Logistics',           'Supply Chain', 12),
  ('Compliance',          'Development',  13),
  ('Testing & Validation','Development',  14),
  ('Customer Support',    'Development',  15),
  ('Accounting',          'Finance',      16),
  ('Warehouse',           'Finance',      17),
  ('Collection',          'Finance',      18),
  ('Legal Affairs',       'Legal Affairs',19)
) as d(name, sector, ord)
join sectors s on s.name = d.sector
on conflict (name, sector_id) do update set sort_order = excluded.sort_order;

-- ---------------------------------------------------------------------
-- Employee statuses  (Status sheet) — "Payroll" = appears in monthly report
-- ---------------------------------------------------------------------
insert into employee_statuses (name, in_payroll, sort_order) values
  ('Active',    true,  1),
  ('Resigned',  true,  2),
  ('Suspended', false, 3),
  ('Absent',    false, 4),
  ('On Leave',  true,  5)
on conflict (name) do update
  set in_payroll = excluded.in_payroll, sort_order = excluded.sort_order;

-- ---------------------------------------------------------------------
-- Attendance types  (Attendance sheet / Table7)
--
-- overtime_hours is NOT inserted — it is a generated column computed as
-- extra_hours * 1.5 + added_hours, matching the sheet formula =D*1.5+E.
--
-- is_working_day marks the days that count toward
-- "monthly required hours = paid days * 8". It is set true only for days
-- the employee is actually rostered on shift: leave, rest, holiday and
-- absent days carry no 8-hour expectation, so including them would show
-- a false shortage for anyone who took leave. Adjust in Settings if your
-- payroll policy differs.
-- ---------------------------------------------------------------------
insert into attendance_types
  (code, name_ar, name_en, meal_multiplier, extra_hours, added_hours, effect, is_working_day, sort_order)
values
  ('no_status',       'غير محدد',      'No Status',          0,  0,  0, 'none',       false,  1),
  ('paid_day',        'حضور',          'Paid Day',           1,  0,  0, 'none',       true,   2),
  ('overtime_day',    'سهر',           'Overtime Day',       2,  4,  0, 'none',       true,   3),
  ('annual_leave',    'اعتيادي',       'Annual Leave',       0,  0,  0, 'annual',     false,  4),
  ('unplanned_leave', 'عارضه',         'Un Planned Leave',   0,  0,  0, 'unplanned',  false,  5),
  ('sick_leave',      'مرضي',          'Sick Leave',         0,  0,  0, 'none',       false,  6),
  ('deducted_leave',  'بالخصم',        'Deducted Leave',     0,  0,  0, 'deducted',   false,  7),
  ('absent',          'غياب',          'Absent Day',         0,  0,  0, 'absence',    false,  8),
  ('weekly_rest',     'راحة أسبوعية',  'Weekly Rest',        0,  0,  0, 'none',       false,  9),
  ('rest_day',        'بدل راحة',      'Rest Day',           0,  0,  0, 'added_days', false, 10),
  ('granted_day',     'منحة',          'Granted Day',        0,  0,  0, 'none',       false, 11),
  ('holiday',         'عطلة',          'Holiday',            0,  0,  0, 'none',       false, 12),
  ('night_shift',     'ليل',           'Night Shift',        2,  4,  0, 'none',       true,  13),
  ('double_shift',    'وردتين',        'Double Shifts',      4, 16,  0, 'none',       true,  14),
  ('holiday_8',       'جمعة 8',        'Holiday (8 hrs)',    1,  8,  4, 'none',       true,  15),
  ('holiday_12',      'جمعة 12',       'Holiday (12 hrs)',   2, 12,  6, 'none',       true,  16),
  ('holiday_24',      'جمعة 24',       'Holiday (24 hrs)',   4, 24, 12, 'none',       true,  17),
  ('offsite_8',       'مأمورية 8',     'Off-site (8 Hrs)',   1,  0,  0, 'none',       true,  18),
  ('offsite_12',      'مأمورية 12',    'Off-site (12 Hrs)',  2,  4,  0, 'none',       true,  19),
  ('ramadan',         'رمضان حضور',    'Ramadan',            1,  0,  0, 'none',       true,  20),
  ('ramadan_ot',      'رمضان سهر',     'Ramadan OT',         2,  4,  0, 'none',       true,  21),
  ('ramadan_ns',      'رمضان ليل',     'Ramadan NS',         2,  4,  0, 'none',       true,  22),
  ('ramadan_24',      'رمضان وردتين',  'Ramadan (24 hrs)',   4, 16,  0, 'none',       true,  23)
on conflict (code) do update set
  name_ar         = excluded.name_ar,
  name_en         = excluded.name_en,
  meal_multiplier = excluded.meal_multiplier,
  extra_hours     = excluded.extra_hours,
  added_hours     = excluded.added_hours,
  effect          = excluded.effect,
  sort_order      = excluded.sort_order;

-- ---------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------
insert into app_settings (key, value, description) values
  ('meal_allowance_rate',    '0',             'EGP paid per meal unit (monthly report cell B1)'),
  ('required_hours_per_day', '8',             'Hours expected per working day'),
  ('company_name',           '"IEnergy"',     'Shown in the app header and on exports'),
  ('currency',               '"EGP"',         'Currency label used across reports')
on conflict (key) do nothing;
