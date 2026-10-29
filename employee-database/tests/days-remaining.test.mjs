import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

/*
 * "Days remaining" in the Contracts due/expired list.
 *
 * Two things here are easy to get wrong and impossible to notice:
 *
 *   The count must not change with the hour. Subtracting two Dates and
 *   dividing gives a fraction, and flooring it makes a contract that
 *   expires tomorrow read "1" in the morning and "0" at night.
 *
 *   A past date must not read as a small positive number. The column is
 *   headed Days remaining; a bare "-12" in it is read as twelve days
 *   left by anybody scanning the list, which is the opposite of true.
 *
 * The real function is lifted out of the page and run here.
 */

const source = readFileSync(new URL('../employee-database.js', import.meta.url), 'utf8')
const start = source.indexOf('function daysRemaining')
assert.ok(start > 0, 'found daysRemaining in the page')
const end = source.indexOf('\n}', start) + 2
const daysRemaining = new Function(`${source.slice(start, end)}\nreturn daysRemaining`)()

// A fixed "today" so these do not start failing tomorrow.
const TODAY = new Date('2026-10-29T12:00:00Z')

test('a future date is the number of days', () => {
  assert.equal(daysRemaining('2026-10-30', TODAY), '1')
  assert.equal(daysRemaining('2026-11-28', TODAY), '30')
})

test('today says so rather than reading as zero days left', () => {
  assert.equal(daysRemaining('2026-10-29', TODAY), 'Expires today')
})

test('a past date says it expired, and how long ago', () => {
  assert.equal(daysRemaining('2026-10-28', TODAY), 'Expired 1 day ago')
  assert.equal(daysRemaining('2026-10-01', TODAY), 'Expired 28 days ago')
})

test('the answer does not change with the hour', () => {
  // The bug this guards: flooring a fractional day difference.
  const target = '2026-10-30'
  for (const hour of ['00:00:01', '09:30:00', '12:00:00', '23:59:59']) {
    assert.equal(
      daysRemaining(target, new Date(`2026-10-29T${hour}Z`)),
      '1',
      `reads differently at ${hour}`,
    )
  }
})

test('it crosses a month and a year without drifting', () => {
  assert.equal(daysRemaining('2026-11-01', new Date('2026-10-31T12:00:00Z')), '1')
  assert.equal(daysRemaining('2027-01-01', new Date('2026-12-31T12:00:00Z')), '1')
})

test('a leap day is one day like any other', () => {
  assert.equal(daysRemaining('2028-03-01', new Date('2028-02-29T12:00:00Z')), '1')
  assert.equal(daysRemaining('2028-02-29', new Date('2028-02-28T12:00:00Z')), '1')
})

test('no date, or a broken one, is a dash and not a crash', () => {
  assert.equal(daysRemaining(null, TODAY), '—')
  assert.equal(daysRemaining('', TODAY), '—')
  assert.equal(daysRemaining('not a date', TODAY), '—')
})
