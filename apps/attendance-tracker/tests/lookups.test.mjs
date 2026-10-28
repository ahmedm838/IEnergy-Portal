import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

/*
 * Reference data now arrives in one request instead of seven.
 *
 * The thing worth testing is not that the RPC is called -- it is that
 * the two paths cannot drift. A page reads `allTypes`, `busRoutes` and a
 * `settings` map; if the RPC path spelled any of those differently the
 * app would come up with empty pickers and nobody would see a failure,
 * because both paths "succeed". So the central test runs the real
 * fetchLookups against both and asserts the results are deeply equal.
 *
 * The real source is loaded and run here, so a change to useLookups.js
 * that breaks either path fails this file.
 */

const source = readFileSync(new URL('../src/lib/useLookups.js', import.meta.url), 'utf8')
  .replace(/^import[\s\S]*?from\s+'[^']+'\n/gm, '')
  .replace(/^export /gm, '')

/* ---- the rows, as each path would receive them ---- */

const SITES = [{ id: 1, name: 'Factory', sort_order: 1 }]
const SECTORS = [{ id: 7, name: 'Production', sort_order: 1 }]
const DEPARTMENTS = [
  { id: 3, name: 'Assembly', sector_id: 7, sort_order: 1, sectors: { id: 7, name: 'Production' } },
  // A department with no sector still has to come back, with null.
  { id: 4, name: 'Unassigned', sector_id: null, sort_order: 2, sectors: null },
]
const STATUSES = [{ id: 1, name: 'Active', sort_order: 1, in_payroll: true, allows_records: true }]
const ALL_TYPES = [
  { id: 1, code: 'no_status', name_en: 'No status', sort_order: 1, is_active: true },
  { id: 2, code: 'attended', name_en: 'Attended', sort_order: 2, is_active: true },
  // Retired: Settings must still list it, pickers must not offer it.
  { id: 9, code: 'old_leave', name_en: 'Old leave', sort_order: 9, is_active: false },
]
const BUS_ROUTES = [{ id: 1, name: 'October', sort_order: 1 }]
const SETTINGS = [
  { key: 'required_hours_per_day', value: '8' },
  { key: 'currency', value: 'EGP' },
]

const TABLES = {
  sites: SITES,
  sectors: SECTORS,
  departments: DEPARTMENTS,
  employee_statuses: STATUSES,
  attendance_types: ALL_TYPES,
  bus_routes: BUS_ROUTES,
  app_settings: SETTINGS,
}

/* What app_lookups() returns: the same rows, under the SQL function's
   own key names, which are not all the client's names. */
const rpcPayload = {
  sites: SITES,
  sectors: SECTORS,
  departments: DEPARTMENTS,
  statuses: STATUSES,
  types: ALL_TYPES,
  bus_routes: BUS_ROUTES,
  settings: SETTINGS,
}

/* ---- the module, with its two dependencies replaced ---- */

function load({ rpc }) {
  const calls = { rpc: 0, tables: [] }
  const supabase = {
    rpc: async (name) => {
      calls.rpc += 1
      assert.equal(name, 'app_lookups')
      return rpc()
    },
    from: (table) => {
      calls.tables.push(table)
      const query = { select: () => query, order: () => query, table }
      return query
    },
  }
  // The seven-request path goes through run(), which unwraps the query.
  const run = async (query) => TABLES[query.table]
  const noop = () => {}
  const api = new Function(
    'supabase', 'run', 'useCallback', 'useEffect', 'useMemo', 'useState',
    `${source}\nreturn { fetchLookups, fetchLookupsSeparately, clearLookupsCache }`,
  )(supabase, run, (fn) => fn, noop, (fn) => fn(), () => [null, noop])
  return { ...api, calls }
}

const ok = () => ({ data: rpcPayload, error: null })

test('one request returns exactly what the seven returned', async () => {
  const viaRpc = await load({ rpc: ok }).fetchLookups()
  const viaTables = await load({ rpc: ok }).fetchLookupsSeparately()
  assert.deepEqual(viaRpc, viaTables)
})

test('the shape the pages read', async () => {
  const lookups = await load({ rpc: ok }).fetchLookups()

  // Settings arrive as rows and are read as a map.
  assert.deepEqual(lookups.settings, { required_hours_per_day: '8', currency: 'EGP' })

  // Pickers offer the available types; Settings and old records need all.
  assert.deepEqual(lookups.types.map((t) => t.code), ['no_status', 'attended'])
  assert.deepEqual(lookups.allTypes.map((t) => t.code), ['no_status', 'attended', 'old_leave'])

  // Named busRoutes here, bus_routes in SQL.
  assert.equal(lookups.busRoutes.length, 1)

  // A department with no sector survives the trip.
  assert.equal(lookups.departments.at(-1).sectors, null)
})

test('one request, not seven', async () => {
  const api = load({ rpc: ok })
  await api.fetchLookups()
  assert.equal(api.calls.rpc, 1)
  assert.deepEqual(api.calls.tables, [])
})

test('a bundle newer than the database falls back to the seven', async () => {
  const missing = () => ({ data: null, error: { code: 'PGRST202', message: 'not found' } })
  const api = load({ rpc: missing })
  const lookups = await api.fetchLookups()
  assert.deepEqual(lookups.allTypes, ALL_TYPES)
  assert.equal(api.calls.tables.length, 7)
})

test('a real failure is not mistaken for a missing function', async () => {
  const denied = () => ({ data: null, error: { code: '42501', message: 'permission denied' } })
  const api = load({ rpc: denied })
  await assert.rejects(api.fetchLookups(), /permission denied/)
  // It must not quietly retry as seven requests and look like it worked.
  assert.deepEqual(api.calls.tables, [])
})
