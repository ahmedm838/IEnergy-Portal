import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

/*
 * S.I. No. in the monthly report's Excel file.
 *
 * It is a text column in the database, so it arrived as a string and
 * ExcelJS wrote a text cell. A number format on the column does nothing
 * to a value that is not a number -- which is why the column looked
 * unchanged however it was formatted. The value itself has to be
 * converted, and the conversion has to refuse the cases where turning
 * text into a number would change what the number is.
 *
 * The real function is lifted out of MonthlyReport.jsx and run here.
 */

const source = readFileSync(new URL('../src/pages/MonthlyReport.jsx', import.meta.url), 'utf8')
const start = source.indexOf('function digitsOrText')
assert.ok(start > 0, 'found digitsOrText in the page')
const end = source.indexOf('\n}', start) + 2
const digitsOrText = new Function(`${source.slice(start, end)}\nreturn digitsOrText`)()

test('an ordinary insurance number becomes a number', () => {
  assert.strictEqual(digitsOrText('123456789'), 123456789)
  assert.strictEqual(typeof digitsOrText('123456789'), 'number')
})

test('surrounding whitespace does not stop it', () => {
  assert.strictEqual(digitsOrText('  123456789 '), 123456789)
})

test('a leading zero is kept as text, because a number would lose it', () => {
  // 0123 as a number is 123 -- a different insurance number. Silently
  // changing one in a payroll sheet is worse than leaving it as text.
  assert.strictEqual(digitsOrText('0123456789'), '0123456789')
})

test('a single zero is still a number', () => {
  assert.strictEqual(digitsOrText('0'), 0)
})

test('anything not all digits is left exactly as it came', () => {
  assert.strictEqual(digitsOrText('12-345'), '12-345')
  assert.strictEqual(digitsOrText('N/A'), 'N/A')
  assert.strictEqual(digitsOrText('123 456'), '123 456')
})

test('blank stays blank rather than becoming zero', () => {
  // Number('') is 0, which would put a 0 in every row that has no
  // insurance number -- a figure where there was none.
  assert.strictEqual(digitsOrText(''), '')
  assert.strictEqual(digitsOrText(null), '')
  assert.strictEqual(digitsOrText(undefined), '')
})

test('a number too large to hold exactly stays text', () => {
  // Beyond 2^53 a number is rounded rather than stored, so the cell
  // would show a different value from the record.
  const huge = '123456789012345678'
  assert.strictEqual(digitsOrText(huge), huge)
})

test('the column asks for a whole-number format', () => {
  const column = /\{\s*header:\s*'S\.I\. No\.',[^}]*\}/.exec(source)?.[0]
  assert.ok(column, 'found the S.I. No. column')
  assert.match(column, /numFmt:\s*'0'/)
})

test('the export actually passes si_no through the conversion', () => {
  // The conversion existing is not the same as it being used, and the
  // column looks identical either way until somebody opens the file.
  assert.match(source, /si_no:\s*digitsOrText\(r\.si_no\)/)
})
