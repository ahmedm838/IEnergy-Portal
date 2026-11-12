-- =====================================================================
-- Departments get an Arabic name.
--
-- The HR forms are Arabic -- the work start acknowledgement and the
-- social status declaration both state the employee's department
-- ("الإدارة") -- and departments had an English name only. name_ar holds
-- the Arabic one; a department without it shows its English name on the
-- forms, so nothing breaks for a department added later and not yet
-- translated.
--
-- The departments the system was seeded with are given their Arabic
-- names here, matched on the English name. A department that has since
-- been renamed is not matched and keeps an empty name_ar; set it with
--   update departments set name_ar = '...' where name = '...';
-- =====================================================================

alter table public.departments
  add column if not exists name_ar text;

update public.departments d
   set name_ar = t.name_ar
  from (values
    ('Puplic Relations',   'العلاقات العامة'),
    ('Public Relations',   'العلاقات العامة'),
    ('Production',         'الإنتاج'),
    ('Quality',            'الجودة'),
    ('Engineering',        'الهندسة'),
    ('Human Resources',    'الموارد البشرية'),
    ('HSE',                'السلامة والصحة المهنية والبيئة'),
    ('Transportation',     'النقل'),
    ('Maintenance',        'الصيانة'),
    ('Tendering',          'المناقصات'),
    ('Local Purchasing',   'المشتريات المحلية'),
    ('Foreign Purchasing', 'المشتريات الخارجية'),
    ('Logistics',          'الخدمات اللوجستية')
  ) as t(name, name_ar)
 where d.name = t.name
   and d.name_ar is null;
