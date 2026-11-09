import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

/*
 * Reading the fingerprint machine's export.
 *
 * The module is loaded from source rather than restated here, so these
 * run against the code that ships.
 */

const source = readFileSync(new URL('../src/lib/importAttendance.js', import.meta.url), 'utf8')
  .replace(/^export /gm, '')
const api = new Function(
  `${source}\nreturn { acNumberFor, parseSheetDate, parseTimes, findColumns, findHeaderRow, buildImport, applyImport, notUploadedRows }`,
)()
const {
  acNumberFor, parseSheetDate, parseTimes, findHeaderRow, buildImport, applyImport, notUploadedRows,
} = api

/* ---- the code-to-machine mapping ---- */

test('the whole six-digit code is the machine number', () => {
  // Matched exactly. It used to drop the first two digits, so 240001
  // meant AC-No. 1; that mapping is gone and must not creep back.
  assert.equal(acNumberFor('240001'), 240001)
  assert.equal(acNumberFor('260028'), 260028)
  assert.equal(acNumberFor('240010'), 240010)
  assert.equal(acNumberFor(240100), 240100)
})

test('a code of another shape matches nobody rather than guessing', () => {
  // Matching the wrong person is the worst thing this could do, so a
  // code that is not six digits gets no number at all.
  for (const bad of ['', null, undefined, '2400', '24000A', '2400011']) {
    assert.equal(acNumberFor(bad), null, `${bad} should not map`)
  }
})

/* ---- dates ---- */

test('the machine writes the day first', () => {
  assert.equal(parseSheetDate('01-07-2026'), '2026-07-01')
  assert.equal(parseSheetDate('29-10-2026'), '2026-10-29')
  assert.equal(parseSheetDate('5-7-2026'), '2026-07-05')
})

test('ISO is taken as written', () => {
  assert.equal(parseSheetDate('2026-07-01'), '2026-07-01')
})

test('an Excel serial date is a date', () => {
  // 1 July 2026.
  assert.equal(parseSheetDate(46204), '2026-07-01')
})

test('nonsense is null, not a date near today', () => {
  for (const bad of ['', null, 'Sunday', '32-01-2026', '01-13-2026']) {
    assert.equal(parseSheetDate(bad), null, `${bad} should not parse`)
  }
})

/* ---- times ---- */

test('one time in a cell', () => {
  assert.deepEqual(parseTimes('09:44'), ['09:44'])
  assert.deepEqual(parseTimes('9:44'), ['09:44'])
  assert.deepEqual(parseTimes('09:44:15'), ['09:44'])
})

test('several times in a cell all come back', () => {
  // The caller has to see that there was more than one; returning the
  // first would hide exactly the case the rules are about.
  assert.deepEqual(parseTimes('08:01 12:30 13:02'), ['08:01', '12:30', '13:02'])
  assert.deepEqual(parseTimes('08:01, 17:04'), ['08:01', '17:04'])
})

test('a time-formatted cell is a fraction of a day', () => {
  assert.deepEqual(parseTimes(0.5), ['12:00'])
  assert.deepEqual(parseTimes(0.40555555), ['09:44'])
})

test('blank and impossible times give nothing', () => {
  assert.deepEqual(parseTimes(''), [])
  assert.deepEqual(parseTimes(null), [])
  assert.deepEqual(parseTimes('25:00'), [])
  assert.deepEqual(parseTimes('12:75'), [])
})

/* ---- the whole thing, on a made-up sheet ---- */

const HEADER = ['Emp No.', 'AC-No.', 'Name', 'Date', 'Clock In', 'Clock Out']
const sheet = (...rows) => [['Attendance report'], [], HEADER, ...rows]
const RANGE = { acNo: 240001, from: '2026-07-01', to: '2026-07-31' }

test('a day with both times is filled in', () => {
  const out = buildImport(sheet(['3', '240001', 'A', '05-07-2026', '09:44', '16:18']), RANGE)
  assert.deepEqual(out.days, { '2026-07-05': { clock_in: '09:44', clock_out: '16:18' } })
  assert.deepEqual(out.issues, [])
})

test('a day missing one of the two is an issue, not half a day', () => {
  const out = buildImport(
    sheet(
      ['3', '240001', 'A', '06-07-2026', '10:01', ''],
      ['3', '240001', 'A', '07-07-2026', '', '16:22'],
    ),
    RANGE,
  )
  assert.deepEqual(out.days, {})
  assert.deepEqual(out.issues.map((i) => [i.date, i.reason]), [
    ['2026-07-06', 'Missing clock out'],
    ['2026-07-07', 'Missing clock in'],
  ])
})

test('more than one punch is an issue, in one cell or in two rows', () => {
  const out = buildImport(
    sheet(
      ['3', '240001', 'A', '08-07-2026', '08:01 12:30', '17:00'],
      // Some exports write a row per punch instead of a row per day.
      ['3', '240001', 'A', '09-07-2026', '08:00', '12:00'],
      ['3', '240001', 'A', '09-07-2026', '13:00', '17:00'],
    ),
    RANGE,
  )
  assert.deepEqual(out.days, {})
  assert.deepEqual(out.issues.map((i) => i.reason), ['Multiple punches', 'Multiple punches'])
  // The detail has to show what was found, or there is nothing to act on.
  assert.match(out.issues[1].fileStatus, /08:00, 13:00/)
})

test('a day with no punches at all is not an issue, but is reported', () => {
  // An ordinary absence: nothing to fix, so it is kept out of the
  // issues, and still listed because a run of them across one week is
  // as likely to be a machine that was off as a person who was away.
  const out = buildImport(
    sheet(
      ['3', '240001', 'A', '02-07-2026', '', ''],
      ['3', '240001', 'A', '01-07-2026', '', ''],
    ),
    RANGE,
  )
  assert.deepEqual(out.days, {})
  assert.deepEqual(out.issues, [])
  // In date order, whatever order the file had them in.
  assert.deepEqual(out.noPunchDays, ['2026-07-01', '2026-07-02'])
})

test('other people and other dates are left out', () => {
  const out = buildImport(
    sheet(
      ['3', '240002', 'B', '05-07-2026', '08:00', '16:00'],
      ['3', '240001', 'A', '05-08-2026', '08:00', '16:00'],
      ['3', '240001', 'A', '05-07-2026', '08:00', '16:00'],
    ),
    RANGE,
  )
  assert.deepEqual(Object.keys(out.days), ['2026-07-05'])
  assert.equal(out.matched, 1)
})

test('the columns are found by name, wherever they sit', () => {
  const rows = [
    ['Date', 'Clock Out', 'AC-No.', 'Clock In'],
    ['05-07-2026', '16:18', '240001', '09:44'],
  ]
  const out = buildImport(rows, RANGE)
  assert.deepEqual(out.days, { '2026-07-05': { clock_in: '09:44', clock_out: '16:18' } })
})

test('a header below a title block is still found', () => {
  assert.equal(findHeaderRow(sheet()), 2)
})

test('a file that is not an attendance export says so', () => {
  const out = buildImport([['Name', 'Amount'], ['A', 1]], RANGE)
  assert.match(out.error, /AC-No/)
})

test('a sheet with no times says so rather than reporting nothing found', () => {
  const out = buildImport([['AC-No.', 'Date'], ['240001', '05-07-2026']], RANGE)
  assert.match(out.error, /Clock In or Clock Out/)
})

test('an employee with no machine number is refused', () => {
  const out = buildImport(sheet(), { ...RANGE, acNo: null })
  assert.match(out.error, /six digits/)
})

test('a heading cell named __proto__ cannot poison the result', () => {
  // The rows are arrays for this reason; the test holds the line.
  const out = buildImport(
    [['AC-No.', 'Date', 'Clock In', 'Clock Out', '__proto__'],
     ['240001', '05-07-2026', '09:00', '17:00', 'polluted']],
    RANGE,
  )
  assert.equal({}.polluted, undefined)
  assert.deepEqual(out.days, { '2026-07-05': { clock_in: '09:00', clock_out: '17:00' } })
})

/* ---- applying it to the grid ----
 *
 * The counts and the new grid come back from one call on purpose. They
 * were apart once: the page counted inside a setRows updater and read
 * the counters on the next line, and React runs an updater later than
 * that, so the grid filled correctly while the message said "0 days
 * filled". Everything below checks that the two agree.
 */

const EMPTY = { attendance_type_id: null, clock_in: '', clock_out: '', note: '' }
const WEEK = ['2026-07-01', '2026-07-02', '2026-07-03']
const never = () => false

const apply = (over = {}) =>
  applyImport({
    rows: {},
    dirty: new Set(),
    days: WEEK,
    imported: {},
    typeId: 7,
    emptyRow: EMPTY,
    blocked: never,
    ...over,
  })

test('a filled day gets the type and both times', () => {
  const out = apply({ imported: { '2026-07-01': { clock_in: '08:00', clock_out: '16:00' } } })
  assert.equal(out.filled, 1)
  assert.deepEqual(out.next['2026-07-01'], {
    ...EMPTY, attendance_type_id: 7, clock_in: '08:00', clock_out: '16:00',
  })
  assert.deepEqual([...out.touched], ['2026-07-01'])
})

test('the count matches the grid, which is the whole point', () => {
  const out = apply({
    imported: {
      '2026-07-01': { clock_in: '08:00', clock_out: '16:00' },
      '2026-07-02': { clock_in: '09:00', clock_out: '17:00' },
      '2026-07-03': { clock_in: '08:30', clock_out: '16:30' },
    },
  })
  const actuallyFilled = Object.values(out.next).filter((r) => r.attendance_type_id === 7).length
  assert.equal(out.filled, 3)
  assert.equal(out.filled, actuallyFilled)
  assert.equal(out.touched.size, out.filled)
})

test('a day that already has a type is kept, not overwritten', () => {
  const rows = { '2026-07-01': { ...EMPTY, attendance_type_id: 4, note: 'annual leave' } }
  const out = apply({ rows, imported: { '2026-07-01': { clock_in: '08:00', clock_out: '16:00' } } })
  assert.equal(out.kept, 1)
  assert.equal(out.filled, 0)
  assert.equal(out.next['2026-07-01'].attendance_type_id, 4)
  assert.equal(out.next['2026-07-01'].note, 'annual leave')
  assert.equal(out.touched.size, 0)
})

test('a locked or future day is counted as blocked and left alone', () => {
  const out = apply({
    imported: {
      '2026-07-01': { clock_in: '08:00', clock_out: '16:00' },
      '2026-07-02': { clock_in: '08:00', clock_out: '16:00' },
    },
    blocked: (iso) => iso === '2026-07-02',
  })
  assert.equal(out.filled, 1)
  assert.equal(out.blocked, 1)
  assert.equal(out.next['2026-07-02'], undefined)
})

test('a day outside the shown range is not counted at all', () => {
  // Not filled, not kept, not blocked: it is not part of this view.
  const out = apply({ imported: { '2026-08-15': { clock_in: '08:00', clock_out: '16:00' } } })
  assert.deepEqual(out, {
    next: {}, touched: new Set(), filled: 0,
    keptDays: [], blockedDays: [], kept: 0, blocked: 0,
  })
})

test('days already unsaved stay unsaved', () => {
  const out = apply({
    dirty: new Set(['2026-07-03']),
    imported: { '2026-07-01': { clock_in: '08:00', clock_out: '16:00' } },
  })
  assert.deepEqual([...out.touched].sort(), ['2026-07-01', '2026-07-03'])
})

test('the grid handed in is not modified', () => {
  // It is React state; changing it in place would skip a render.
  const rows = { '2026-07-01': { ...EMPTY } }
  const before = JSON.stringify(rows)
  apply({ rows, imported: { '2026-07-01': { clock_in: '08:00', clock_out: '16:00' } } })
  assert.equal(JSON.stringify(rows), before)
})

/* ---- the one table under the grid ---- */

const typeName = (id) => ({ 4: 'Annual Leave', 7: 'Paid Day' })[id] ?? 'Unknown type'

test('three kinds of day become one list, in date order', () => {
  const out = notUploadedRows(
    {
      issues: [
        { date: '2026-07-10', reason: 'Missing clock out', fileStatus: 'In 09:25' },
        { date: '2026-07-02', reason: 'Missing clock in', fileStatus: 'Out 16:22' },
      ],
      noPunchDays: ['2026-07-20', '2026-07-05'],
      keptDays: [{ date: '2026-07-15', typeId: 4, clock_in: '08:00', clock_out: '16:00' }],
    },
    typeName,
  )
  // Sorted across all three sources, not grouped by where they came
  // from: the point of one table is reading down a month.
  assert.deepEqual(out.map((r) => r.date), [
    '2026-07-02', '2026-07-05', '2026-07-10', '2026-07-15', '2026-07-20',
  ])
  assert.deepEqual(out.map((r) => r.reason), [
    'Missing clock in', 'No punch', 'Missing clock out', 'Already recorded', 'No punch',
  ])
})

test('a no-punch day says so in both columns', () => {
  const [row] = notUploadedRows({ noPunchDays: ['2026-07-05'] }, typeName)
  assert.equal(row.reason, 'No punch')
  assert.equal(row.fileStatus, 'No punch')
})

test('an already-recorded day shows its type and the times the file had', () => {
  // Both together are what says whether to go and change the day: what
  // it is recorded as, and what the machine would have made it.
  const [row] = notUploadedRows(
    { keptDays: [{ date: '2026-07-15', typeId: 4, clock_in: '08:03', clock_out: '16:11' }] },
    typeName,
  )
  assert.equal(row.reason, 'Already recorded')
  assert.equal(row.fileStatus, 'Annual Leave · In 08:03 · Out 16:11')
})

test('a type that is no longer in the lookups does not blank the row', () => {
  const [row] = notUploadedRows(
    { keptDays: [{ date: '2026-07-15', typeId: 999, clock_in: '08:00', clock_out: '16:00' }] },
    typeName,
  )
  assert.match(row.fileStatus, /Unknown type/)
})

test('a locked or future day is listed too, with what the file had', () => {
  const [row] = notUploadedRows(
    { blockedDays: [{ date: '2026-07-15', clock_in: '08:00', clock_out: '16:00' }] },
    typeName,
  )
  assert.equal(row.reason, 'Locked or future')
  assert.equal(row.fileStatus, 'In 08:00 · Out 16:00')
})

test('nothing left out means an empty list, not a missing one', () => {
  assert.deepEqual(notUploadedRows({}, typeName), [])
})

test('every row carries the three columns the table shows', () => {
  const out = notUploadedRows(
    {
      issues: [{ date: '2026-07-10', reason: 'Multiple punches', fileStatus: 'In 08:00, 13:00 · Out 17:00' }],
      noPunchDays: ['2026-07-05'],
      keptDays: [{ date: '2026-07-15', typeId: 7, clock_in: '08:00', clock_out: '16:00' }],
      blockedDays: [{ date: '2026-07-16', clock_in: '08:00', clock_out: '16:00' }],
    },
    typeName,
  )
  for (const row of out) {
    assert.deepEqual(Object.keys(row).sort(), ['date', 'fileStatus', 'reason'])
    for (const key of ['date', 'reason', 'fileStatus']) {
      assert.ok(row[key], `${key} is empty on ${JSON.stringify(row)}`)
    }
  }
})

/* ---- the code is matched whole, not by its last four digits ---- */

test('a machine still exporting 1, 2, 3 matches nobody', () => {
  // This is the case the old rule handled and the new one refuses: 1 is
  // not 240001. It must not quietly fall back, because 240001 and
  // 260001 would both match a row of 1 and they are different people.
  const out = buildImport(sheet(['3', '1', 'A', '05-07-2026', '09:00', '17:00']), RANGE)
  assert.equal(out.matched, 0)
  assert.deepEqual(out.days, {})
})

test('a code sharing the last four digits is a different person', () => {
  // 260001 ends 0001 just as 240001 does. Under the old rule both were
  // AC-No. 1 and either file filled in either person's month.
  const out = buildImport(sheet(['3', '260001', 'B', '05-07-2026', '09:00', '17:00']), RANGE)
  assert.equal(out.matched, 0)
  assert.deepEqual(out.days, {})
})

test('when nothing matched, the AC-No. values in the file come back', () => {
  // The usual reason for no match is a machine exporting its own
  // numbering, and saying what is in the column names it at a glance.
  const out = buildImport(
    sheet(
      ['3', '1', 'A', '05-07-2026', '09:00', '17:00'],
      ['3', '28', 'B', '05-07-2026', '09:00', '17:00'],
      ['3', '3', 'C', '05-07-2026', '09:00', '17:00'],
    ),
    RANGE,
  )
  assert.equal(out.matched, 0)
  // Sorted as numbers, not as text: 3 before 28.
  assert.deepEqual(out.acNumbersInFile, ['1', '3', '28'])
  assert.equal(out.acNumbersTotal, 3)
})

test('the reported AC-No. list is capped so a message stays readable', () => {
  const many = Array.from({ length: 50 }, (_, i) =>
    ['3', String(100000 + i), 'X', '05-07-2026', '09:00', '17:00'])
  const out = buildImport(sheet(...many), RANGE)
  assert.equal(out.acNumbersInFile.length, 30)
  assert.equal(out.acNumbersTotal, 50)
})
