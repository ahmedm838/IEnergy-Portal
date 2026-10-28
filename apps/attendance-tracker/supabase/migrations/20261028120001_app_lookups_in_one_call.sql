-- =====================================================================
-- Seven lookup requests become one.
--
-- WHY. Opening the tracker asked PostgREST for sites, sectors,
-- departments, employee statuses, attendance types, bus routes and
-- app_settings -- seven round trips, every one of them logged, for a few
-- hundred rows of reference data that changes when somebody edits the
-- Settings page. On the free plan the log volume is the bill, and seven
-- lines per sign-in across a shift's worth of staff is the single
-- largest block of requests after the session heartbeat.
--
-- WHAT THIS IS NOT. It is not a cache and it does not widen anybody's
-- access. The function is SECURITY INVOKER -- the default, stated here
-- because it is the whole point -- so each select inside it runs as the
-- caller with row-level security applied exactly as it is applied today.
-- A person who can read four of these tables and not the fifth gets the
-- same four rows back and an empty array for the fifth, which is what
-- seven separate requests would have given them.
--
-- SHAPE. Each key holds the same rows, in the same order, with the same
-- columns the client asked for before, so nothing downstream has to
-- change its reading of them:
--
--   sites, sectors, statuses, types, bus_routes  select * order by sort_order
--   departments   id, name, sector_id, sort_order and the nested sector
--   settings      the key/value rows, left as rows -- the client builds
--                 the map, as it did before
--
-- departments carries its sector nested under `sectors` because that is
-- the shape PostgREST's embed produced and the pages read it by that
-- name. It is built here by hand rather than by join so a department
-- with no sector still comes back, with null, instead of vanishing.
--
-- TYPES. Every attendance type, available or not. Availability means
-- "not offered when recording a new day", not "gone": Settings has to
-- list the type somebody just unticked, and a day recorded last March
-- against a type retired since still has to resolve to a name. The
-- client splits the two views; the filtering is deliberately not here.
--
-- COMPATIBILITY. Nothing is dropped and no existing grant changes. The
-- seven tables keep their own grants and policies, so a client that has
-- not been updated -- a cached page, the portal, anything -- keeps
-- working exactly as before. This only adds a faster way to ask.
-- =====================================================================

create or replace function app_lookups()
returns jsonb
language sql
stable
-- security invoker is the default; named so nobody "tidies" it to definer
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
                 -- The embed PostgREST used to return: null when the
                 -- department has no sector, never a missing department.
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

    'settings', coalesce((
      select jsonb_agg(to_jsonb(a) order by a.key) from app_settings a
    ), '[]'::jsonb)
  );
$$;

comment on function app_lookups() is
  'All reference data in one call, with the caller''s own row-level security applied. Replaces seven separate table reads from the client.';

grant execute on function app_lookups() to authenticated;
