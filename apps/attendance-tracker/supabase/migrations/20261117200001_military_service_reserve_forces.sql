-- =====================================================================
-- Military service: "Served-Reserve Forces".
--
-- A fourth value. On the Employee Database page it is the one that
-- needs an expiry date along with Postponed; plain Served no longer
-- does. The expiry rule itself is enforced by the page (see
-- 20261117190001).
-- =====================================================================

alter table public.employees drop constraint if exists employees_military_service_valid;
alter table public.employees add constraint employees_military_service_valid
  check (military_service is null
         or military_service in ('Served', 'Served-Reserve Forces', 'Postponed', 'Exempted'));

comment on column public.employees.military_service_expiry is
  'Expiry of reserve service or a postponement. Required by the page when military_service is Served-Reserve Forces or Postponed.';
