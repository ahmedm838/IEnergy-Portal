import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, run } from './supabase'

/*
 * The comment below always said "fetched once per session and shared".
 * It was not: every page that called the hook got its own state and its
 * own six requests, so moving between pages re-fetched all of it. From
 * Frankfurt that is about a third of a second of waiting per navigation,
 * for data that changes when somebody edits Settings.
 *
 * The cache lives at module scope so every caller shares one fetch.
 * `lookupsValue` is kept beside the promise so a page that mounts after
 * the first load renders immediately instead of flashing a spinner.
 */
let lookupsCache = null
let lookupsValue = null

/** Drop the cache: on sign-out, and whenever Settings changes something. */
export function clearLookupsCache() {
  lookupsCache = null
  lookupsValue = null
}

/**
 * Arrange the raw tables into what the pages read.
 *
 * Both paths below end here, so the one RPC and the seven requests
 * cannot drift into returning different shapes.
 */
function shapeLookups({ sites, sectors, departments, statuses, allTypes, busRoutes, settings }) {
  const settingsMap = Object.fromEntries(settings.map((s) => [s.key, s.value]))
  return {
    sites,
    sectors,
    departments,
    statuses,
    // What a picker offers.
    types: allTypes.filter((t) => t.is_active),
    // What a record can be read through, and what Settings manages.
    allTypes,
    busRoutes,
    settings: settingsMap,
  }
}

/*
 * One request instead of seven.
 *
 * app_lookups() is SECURITY INVOKER, so row-level security applies to
 * each table inside it exactly as it applied when the client asked for
 * them one at a time. This is a cheaper way to ask the same question,
 * not a wider one.
 *
 * If the function is not there -- a browser holding a newer bundle than
 * the database has migrations, which is the ordinary state of affairs
 * for the few minutes between a deploy and a migration -- it falls back
 * to the seven requests rather than leaving the app with no reference
 * data. The fallback is the old code, unchanged, and is kept for that
 * reason; it is not dead.
 */
async function fetchLookups() {
  const { data, error } = await supabase.rpc('app_lookups')

  // PGRST202: PostgREST cannot find the function. 42883: Postgres cannot.
  if (error && (error.code === 'PGRST202' || error.code === '42883')) {
    return fetchLookupsSeparately()
  }
  if (error) throw new Error(error.message ?? 'Request failed')

  return shapeLookups({
    sites: data.sites ?? [],
    sectors: data.sectors ?? [],
    departments: data.departments ?? [],
    statuses: data.statuses ?? [],
    allTypes: data.types ?? [],
    busRoutes: data.bus_routes ?? [],
    settings: data.settings ?? [],
  })
}

async function fetchLookupsSeparately() {
  const [sites, sectors, departments, statuses, allTypes, busRoutes, settings] = await Promise.all([
    run(supabase.from('sites').select('*').order('sort_order')),
    run(supabase.from('sectors').select('*').order('sort_order')),
    run(
      supabase
        .from('departments')
        .select('id, name, sector_id, sort_order, sectors ( id, name )')
        .order('sort_order'),
    ),
    run(supabase.from('employee_statuses').select('*').order('sort_order')),
    /* Every type, available or not.

       Availability means "not offered when recording a new day", not
       "gone". Filtering it out of the query had two consequences that
       only show up once somebody actually unticks one:

         * Settings lists types from here, so an unavailable type would
           disappear from the page that unticked it, and could only be
           brought back with SQL.
         * typeById is built from here, and the Attendance page resolves
           every existing record through it. A day recorded last March
           against a type retired since would have resolved to nothing.

       So the whole table is fetched, and `types` below is the filtered
       view of it. The split is in one named place rather than implied by
       a query nobody reads. */
    run(supabase.from('attendance_types').select('*').order('sort_order')),
    run(supabase.from('bus_routes').select('*').order('sort_order')),
    run(supabase.from('app_settings').select('*')),
  ])

  return shapeLookups({ sites, sectors, departments, statuses, allTypes, busRoutes, settings })
}

/**
 * Reference data (sites, sectors, departments, statuses, attendance types,
 * settings): needed on almost every page, changed rarely, so it is fetched
 * once and shared by every caller.
 */
export function useLookups() {
  const [data, setData] = useState(lookupsValue)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(lookupsValue === null)

  const load = useCallback(async ({ force = false } = {}) => {
    if (force) clearLookupsCache()

    if (!lookupsCache) {
      lookupsCache = fetchLookups().then(
        (value) => {
          lookupsValue = value
          return value
        },
        (err) => {
          // A failed fetch must not be cached, or one dropped connection
          // leaves the app with no reference data until a reload.
          lookupsCache = null
          throw err
        },
      )
    }

    const pending = lookupsCache
    if (lookupsValue === null) setLoading(true)
    try {
      setData(await pending)
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const reload = useCallback(() => load({ force: true }), [load])

  /* Built from every type, not only the available ones: this is how a
     saved record is read back, and a record outlives the availability of
     the type it was recorded against. */
  const typeById = useMemo(() => {
    const map = new Map()
    for (const type of data?.allTypes ?? []) map.set(type.id, type)
    return map
  }, [data])

  const defaultTypeId = useMemo(
    () => data?.types?.find((t) => t.code === 'no_status')?.id ?? data?.types?.[0]?.id ?? null,
    [data],
  )

  const requiredHoursPerDay = Number(data?.settings?.required_hours_per_day ?? 8)
  const mealRate = Number(data?.settings?.meal_allowance_rate ?? 0)
  const lateGraceHours = Number(data?.settings?.late_grace_hours ?? 2)
  const currency = String(data?.settings?.currency ?? 'EGP')

  return {
    ...(data ?? {}),
    typeById,
    defaultTypeId,
    requiredHoursPerDay,
    mealRate,
    lateGraceHours,
    currency,
    loading,
    error,
    reload,
  }
}

/** Employees the current user may see, for pickers and report filters. */
export function useEmployees({ activeOnly = true } = {}) {
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      let query = supabase
        .from('employees')
        .select(
          `id, code, name, arabic_name, title, email, username, role, is_active, si_no, auth_user_id,
           company_mobile, office_number, weekend,
           site_id, department_id, status_id,
           has_meal, has_allowance, has_overtime, has_incentive, has_deductions,
           annual_leave_balance, unplanned_leave_balance,
           sites ( id, name ),
           departments ( id, name ),
           employee_statuses ( id, name, in_payroll, allows_records )`,
        )
        .order('code')
      if (activeOnly) query = query.eq('is_active', true)
      setEmployees(await run(query))
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [activeOnly])

  useEffect(() => {
    load()
  }, [load])

  return { employees, loading, error, reload: load }
}
