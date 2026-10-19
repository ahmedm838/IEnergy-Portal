-- =====================================================================
-- "None" becomes a bus route you can choose.
--
-- The Database page is making its fields compulsory, and bus route is
-- one of them. Most employees do not take the company bus, so without a
-- way to say so the only options are to leave the field blank -- which
-- the form will now refuse -- or to exempt it and lose the distinction
-- between "no bus" and "nobody asked".
--
-- A row rather than a blank: picking None is an answer somebody gave,
-- and it reads the same on screen, in the export and in a report. It
-- sorts first because it is the common case.
--
-- The table is already editable by a super admin -- bus_routes_write
-- checks is_super_admin() -- so the Settings page needs no new rule,
-- only a place to use the one that is there.
-- =====================================================================

insert into bus_routes (name, sort_order)
select 'None', 0
where not exists (select 1 from bus_routes where lower(name) = 'none');

comment on table bus_routes is
  'Company bus routes, including None for employees who do not take it. Read by anyone with access, changed only by a super admin.';
