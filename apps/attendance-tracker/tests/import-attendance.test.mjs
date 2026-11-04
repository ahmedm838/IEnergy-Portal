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
  `${source}\nreturn { acNumberFor, parseSheetDate, parseTimes, findColumns, findHeaderRow, buildImport }`,
)()
const { acNumberFor, parseSheetDate, parseTimes, findHeaderRow, buildImport } = api

/* ---- the code-to-machine mapping ---- */

test('an employee code becomes the machine number', () => {
  assert.equal(acNumberFor('240001'), 1)
  assert.equal(acNumberFor('260028'), 28)
  assert.equal(acNumberFor('240010'), 10)
  assert.equal(acNumberFor(240100), 100)
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
const RANGE = { acNo: 1, from: '2026-07-01', to: '2026-07-31' }

test('a day with both times is filled in', () => {
  const out = buildImport(sheet(['3', '1', 'A', '05-07-2026', '09:44', '16:18']), RANGE)
  assert.deepEqual(out.days, { '2026-07-05': { clock_in: '09:44', clock_out: '16:18' } })
  assert.deepEqual(out.issues, [])
})

test('a day missing one of the two is an issue, not half a day', () => {
  const out = buildImport(
    sheet(
      ['3', '1', 'A', '06-07-2026', '10:01', ''],
      ['3', '1', 'A', '07-07-2026', '', '16:22'],
    ),
    RANGE,
  )
  assert.deepEqual(out.days, {})
  assert.deepEqual(out.issues.map((i) => [i.date, i.reason]), [
    ['2026-07-06', 'No clock out'],
    ['2026-07-07', 'No clock in'],
  ])
})

test('more than one punch is an issue, in one cell or in two rows', () => {
  const out = buildImport(
    sheet(
      ['3', '1', 'A', '08-07-2026', '08:01 12:30', '17:00'],
      // Some exports write a row per punch instead of a row per day.
      ['3', '1', 'A', '09-07-2026', '08:00', '12:00'],
      ['3', '1', 'A', '09-07-2026', '13:00', '17:00'],
    ),
    RANGE,
  )
  assert.deepEqual(out.days, {})
  assert.deepEqual(out.issues.map((i) => i.reason), ['More than one punch', 'More than one punch'])
  // The detail has to show what was found, or there is nothing to act on.
  assert.match(out.issues[1].detail, /08:00, 13:00/)
})

test('a day with no punches at all is not an issue', () => {
  // An ordinary absence. Listing a thousand of these would bury the
  // handful that need somebody to look.
  const out = buildImport(sheet(['3', '1', 'A', '02-07-2026', '', '']), RANGE)
  assert.deepEqual(out.days, {})
  assert.deepEqual(out.issues, [])
  assert.equal(out.noPunch, 1)
})

test('other people and other dates are left out', () => {
  const out = buildImport(
    sheet(
      ['3', '2', 'B', '05-07-2026', '08:00', '16:00'],
      ['3', '1', 'A', '05-08-2026', '08:00', '16:00'],
      ['3', '1', 'A', '05-07-2026', '08:00', '16:00'],
    ),
    RANGE,
  )
  assert.deepEqual(Object.keys(out.days), ['2026-07-05'])
  assert.equal(out.matched, 1)
})

test('the columns are found by name, wherever they sit', () => {
  const rows = [
    ['Date', 'Clock Out', 'AC-No.', 'Clock In'],
    ['05-07-2026', '16:18', '1', '09:44'],
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
  const out = buildImport([['AC-No.', 'Date'], ['1', '05-07-2026']], RANGE)
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
     ['1', '05-07-2026', '09:00', '17:00', 'polluted']],
    RANGE,
  )
  assert.equal({}.polluted, undefined)
  assert.deepEqual(out.days, { '2026-07-05': { clock_in: '09:00', clock_out: '17:00' } })
})
