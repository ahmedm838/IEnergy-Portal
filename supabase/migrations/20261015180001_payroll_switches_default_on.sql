-- =====================================================================
-- Payroll switches default to on.
--
-- A new employee is assumed to earn every component unless someone turns
-- one off. The column defaults were mostly false, which disagreed with
-- the Add employee form -- so a record created through the API or SQL got
-- a quietly different payroll setup from one typed into the app.
--
-- Defaults apply to NEW rows only. Existing employees keep whatever is
-- set against them: changing those would silently alter what people are
-- paid.
-- =====================================================================

alter table employees alter column has_meal       set default true;
alter table employees alter column has_allowance  set default true;
alter table employees alter column has_overtime   set default true;
alter table employees alter column has_incentive  set default true;
alter table employees alter column has_deductions set default true;
