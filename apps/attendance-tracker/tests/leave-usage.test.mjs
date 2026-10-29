import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

/*
 * Counting a year of leave: in SQL now, in the browser before.
 *
 * The risk is the same one the lookups change had. Both paths return a
 * Map and both "succeed", so if the RPC path read a column by the wrong
 * name every figure would quietly be zero and the page would show a
 * staff of people who have taken no leave at all. Nothing would throw.
 *
 * So the central test gives both paths the same underlying rows and
 * asserts the Maps are deeply equal. The real source is sliced out of
 * Employees.jsx and run here -- the part above the component is plain
 * JavaScript -- so a change to the page that breaks either path fails
 * this file.
 */

const file = readFileSync(new URL('../src/pages/Employees.jsx', import.meta.url), 'utf8')
const start = file.indexOf('const blankUsage')
const end = file.indexOf('export default function Employees')
assert.ok(start > 0 && end > start, 'found the counting functions in the page')
const source = file.slice(start, end)

/* The slice is run through new Function, which parses JavaScript and
   not JSX. A component added between blankUsage and the page's default
   export lands inside it and fails with a bare "Unexpected token '<'"
   that says nothing about why. This has happened. Say what to do. */
assert.doesNotMatch(
  source,
  /<[A-Za-z/]/,
  'JSX between blankUsage and the default export: this slice is parsed as plain JavaScript, ' +
    'so put the component above blankUsage instead.',
)

/* ---- the rows, as each path would receive them ---- */

const ANA = '11111111-1111-1111-1111-111111111111'
const BEN = '22222222-2222-2222-2222-222222222222'
const CAI = '33333333-3333-3333-3333-333333333333'

/* Ana: 3 annual, 1 un-planned, 2 added taken, 2 added earned.
   Ben: 1 annual only.
   Cai: earned a day and took none -- the case the second browser scan
   exists for, since the day that earns it has effect 'none'. */
const TAKEN = [
  { id: 1, employee_id: ANA, attendance_types: { effect: 'annual' } },
  { id: 2, employee_id: ANA, attendance_types: { effect: 'annual' } },
  { id: 3, employee_id: ANA, attendance_types: { effect: 'annual' } },
  { id: 4, employee_id: ANA, attendance_types: { effect: 'unplanned' } },
  { id: 5, employee_id: ANA, attendance_types: { effect: 'added_days' } },
  { id: 6, employee_id: ANA, attendance_types: { effect: 'added_days' } },
  { id: 7, employee_id: BEN, attendance_types: { effect: 'annual' } },
]
const EARNED = [
  { id: 8, employee_id: ANA },
  { id: 9, employee_id: ANA },
  { id: 10, employee_id: CAI },
]

// What report_leave_usage() returns for the same rows.
const RPC_ROWS = [
  { emp_id: ANA, annual_used: 3, unplanned_used: 1, added_used: 2, added_earned: 2 },
  { emp_id: BEN, annual_used: 1, unplanned_used: 0, added_used: 0, added_earned: 0 },
  { emp_id: CAI, annual_used: 0, unplanned_used: 0, added_used: 0, added_earned: 1 },
]

/* ---- the module, with its two dependencies replaced ---- */

function load({ rpc, rpcRows = RPC_ROWS }) {
  const calls = { rpc: 0, scans: 0, year: null }

  const supabase = {
    rpc: async (name, args) => {
      calls.rpc += 1
      assert.equal(name, 'report_leave_usage')
      calls.year = args.p_year
      return rpc(rpcRows)
    },
    from: () => {
      // A fluent builder that records which of the two scans this is:
      // the taken scan joins attendance_types, the earned scan filters
      // on add_to_leave_balance.
      const q = { kind: null, offset: 0 }
      const self = {
        select: (cols) => { q.kind = cols.includes('attendance_types') ? 'taken' : 'earned'; return self },
        gte: () => self, lt: () => self, in: () => self, eq: () => self, order: () => self,
        range: (from) => { q.offset = from; calls.scans += 1; return { q } },
      }
      return self
    },
  }

  // Paging: a thousand at a time, so these short lists come back whole.
  const run = async ({ q }) => (q.kind === 'taken' ? TAKEN : EARNED).slice(q.offset, q.offset + 1000)

  const api = new Function(
    'supabase', 'run',
    `${source}\nreturn { countLeaveUsage, countLeaveUsageInBrowser, blankUsage }`,
  )(supabase, run)
  return { ...api, calls }
}

const ok = (rows) => ({ data: rows, error: null })
const never = () => false

test('SQL and the browser arrive at the same figures', async () => {
  const viaSql = await load({ rpc: ok }).countLeaveUsage(2026, never)
  const viaBrowser = await load({ rpc: ok }).countLeaveUsageInBrowser(2026, never)
  assert.deepEqual(viaSql, viaBrowser)
})

test('the figures themselves', async () => {
  const usage = await load({ rpc: ok }).countLeaveUsage(2026, never)
  assert.deepEqual(usage.get(ANA), { annual: 3, unplanned: 1, added_days: 2, addedEarned: 2 })
  assert.deepEqual(usage.get(BEN), { annual: 1, unplanned: 0, added_days: 0, addedEarned: 0 })
  // Earned without taking: the reason earning is counted separately.
  assert.deepEqual(usage.get(CAI), { annual: 0, unplanned: 0, added_days: 0, addedEarned: 1 })
})

test('one request, not a scan per thousand rows', async () => {
  const api = load({ rpc: ok })
  await api.countLeaveUsage(2026, never)
  assert.equal(api.calls.rpc, 1)
  assert.equal(api.calls.scans, 0)
  assert.equal(api.calls.year, 2026)
})

test('an employee the database left out reads as four zeros', async () => {
  // Nobody is sent a row of zeros, so the page must supply them.
  const api = load({ rpc: ok, rpcRows: [] })
  const usage = await api.countLeaveUsage(2026, never)
  assert.equal(usage.get(ANA), undefined)
  assert.deepEqual(api.blankUsage(), { annual: 0, unplanned: 0, added_days: 0, addedEarned: 0 })
})

test('a bundle newer than the database counts the rows itself', async () => {
  const missing = () => ({ data: null, error: { code: 'PGRST202', message: 'not found' } })
  const api = load({ rpc: missing })
  const usage = await api.countLeaveUsage(2026, never)
  assert.deepEqual(usage.get(ANA), { annual: 3, unplanned: 1, added_days: 2, addedEarned: 2 })
  assert.ok(api.calls.scans > 0, 'it fell back to scanning')
})

test('a real failure is not mistaken for a missing function', async () => {
  const denied = () => ({ data: null, error: { code: '42501', message: 'permission denied' } })
  const api = load({ rpc: denied })
  await assert.rejects(api.countLeaveUsage(2026, never), /permission denied/)
  // It must not quietly scan instead and look like it worked.
  assert.equal(api.calls.scans, 0)
})

test('leaving the page stops the counting', async () => {
  const api = load({ rpc: ok })
  assert.equal(await api.countLeaveUsage(2026, () => true), null)
})
