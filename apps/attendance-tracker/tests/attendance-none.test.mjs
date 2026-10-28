import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

/*
 * Choosing "—" on a day in the Attendance grid.
 *
 * Two rules, both exercised against the real source rather than a
 * restatement of it: the functions under test are cut out of
 * Attendance.jsx and run here, so a change to the page that breaks
 * either one fails this file.
 *
 *   1. No type clears the day's figures.
 *   2. No type on a day that was saved removes it, instead of being
 *      quietly dropped from the save.
 */

const source = readFileSync(new URL('../src/pages/Attendance.jsx', import.meta.url), 'utf8')

/* ---- rule 1: the clearing, lifted out of the row-change handler ---- */

const clearBlock = source.slice(
  source.indexOf("if ('attendance_type_id' in patch) {"),
  source.indexOf('return { ...current, [iso]: next }'),
)
assert.ok(clearBlock.includes('next.transport'), 'found the clearing block in the page')

const applyPatch = new Function(
  'patch', 'current', 'lookups',
  `const next = { ...current, ...patch }\n${clearBlock}\nreturn next`,
)

const TYPES = new Map([
  [1, { id: 1, name_en: 'Attended', is_working_day: true }],
  [2, { id: 2, name_en: 'Absent', is_working_day: false }],
])
const lookups = { typeById: TYPES }

const aFullDay = {
  attendance_type_id: 1,
  late_minutes: 45,
  transport: '40',
  add_to_leave_balance: true,
  clock_in: '08:00',
  clock_out: '16:00',
  note: 'drove in',
}

test('choosing no type clears the figures the day carried', () => {
  const next = applyPatch({ attendance_type_id: null }, aFullDay, lookups)
  assert.equal(next.attendance_type_id, null)
  assert.equal(next.late_minutes, 0)
  assert.equal(next.transport, '')
  assert.equal(next.add_to_leave_balance, false)
  assert.equal(next.clock_in, '')
  assert.equal(next.clock_out, '')
  assert.equal(next.note, '', 'the note goes too when the day itself goes')
})

test('a not-worked type still clears the figures but keeps the note', () => {
  const next = applyPatch({ attendance_type_id: 2 }, aFullDay, lookups)
  assert.equal(next.late_minutes, 0)
  assert.equal(next.transport, '')
  assert.equal(next.clock_in, '')
  assert.equal(next.note, 'drove in', '"called in sick" belongs on an absent day')
})

test('a worked type leaves everything alone', () => {
  const next = applyPatch({ attendance_type_id: 1 }, { ...aFullDay, attendance_type_id: 2 }, lookups)
  assert.equal(next.late_minutes, 45)
  assert.equal(next.transport, '40')
  assert.equal(next.clock_in, '08:00')
})

test('editing a figure does not re-clear the day', () => {
  const next = applyPatch({ transport: '25' }, aFullDay, lookups)
  assert.equal(next.transport, '25')
  assert.equal(next.clock_in, '08:00', 'untouched: no type was chosen in this patch')
})

/* ---- rule 2: which days are removed, lifted out of the save ---- */

const clearList = source.slice(
  source.indexOf('const toClear = [...dirty].filter('),
  source.indexOf('const payload = [...dirty]'),
)
assert.ok(clearList.includes('savedDays.has(iso)'), 'found the removal list in the page')

const whichToClear = new Function(
  'dirty', 'rows', 'savedDays', 'locks', 'isFutureDay',
  `${clearList}\nreturn toClear`,
)

const NEVER_LOCKED = { isLocked: () => false }
const NOT_FUTURE = () => false

test('a saved day set to no type is removed', () => {
  const out = whichToClear(
    new Set(['2026-10-01']),
    { '2026-10-01': { attendance_type_id: null } },
    new Set(['2026-10-01']),
    NEVER_LOCKED, NOT_FUTURE,
  )
  assert.deepEqual(out, ['2026-10-01'])
})

test('a day that was never saved has nothing to remove', () => {
  const out = whichToClear(
    new Set(['2026-10-02']),
    { '2026-10-02': { attendance_type_id: null } },
    new Set(),                                  // never saved
    NEVER_LOCKED, NOT_FUTURE,
  )
  assert.deepEqual(out, [], 'no write for a blank day clicked into and back out of')
})

test('a day that still has a type is saved, not removed', () => {
  const out = whichToClear(
    new Set(['2026-10-03']),
    { '2026-10-03': { attendance_type_id: 1 } },
    new Set(['2026-10-03']),
    NEVER_LOCKED, NOT_FUTURE,
  )
  assert.deepEqual(out, [])
})

test('locked and future days are left alone, as the save path leaves them', () => {
  const rows = {
    '2026-09-01': { attendance_type_id: null },
    '2026-12-31': { attendance_type_id: null },
  }
  const saved = new Set(['2026-09-01', '2026-12-31'])
  assert.deepEqual(
    whichToClear(new Set(['2026-09-01']), rows, saved,
      { isLocked: (iso) => iso === '2026-09-01' }, NOT_FUTURE),
    [], 'locked day skipped — the database would refuse it and take the statement down',
  )
  assert.deepEqual(
    whichToClear(new Set(['2026-12-31']), rows, saved,
      NEVER_LOCKED, (iso) => iso === '2026-12-31'),
    [], 'future day skipped',
  )
})
