/** Formatting and date helpers. Everything here is pure and timezone-safe. */

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** 'YYYY-MM-DD' for a Date, using local parts (never toISOString, which shifts to UTC). */
export function toISODate(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Parse 'YYYY-MM-DD' as a local date, not UTC midnight. */
export function fromISODate(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** Inclusive list of 'YYYY-MM-DD' between two ISO dates. */
export function dateRange(fromISO, toISO) {
  const out = []
  const end = fromISODate(toISO)
  for (let d = fromISODate(fromISO); d <= end; d.setDate(d.getDate() + 1)) {
    out.push(toISODate(d))
  }
  return out
}

/** First and last day of the calendar month containing `date`, as ISO strings. */
export function monthBounds(date = new Date()) {
  const from = new Date(date.getFullYear(), date.getMonth(), 1)
  const to = new Date(date.getFullYear(), date.getMonth() + 1, 0)
  return { from: toISODate(from), to: toISODate(to) }
}

/**
 * Day of the month a payroll period opens on.
 *
 * 21 means a period runs from the 21st to the 20th of the next month.
 * Set it to 1 to go back to plain calendar months.
 */
export const PAYROLL_CYCLE_START_DAY = 21

/**
 * The payroll period containing `date`.
 *
 * A period is named after the month it ENDS in, which is how payroll talks
 * about it: 21 September to 20 October is "October". So a date on or after
 * the 21st already belongs to next month's period.
 */
export function payrollPeriod(date = new Date()) {
  const start = PAYROLL_CYCLE_START_DAY
  if (start <= 1) return monthBounds(date)

  const year = date.getFullYear()
  // Past the cycle start, we are already in the period that ends next month.
  const month = date.getMonth() + (date.getDate() >= start ? 1 : 0)

  // Date normalises month overflow, so December rolls into the next year.
  return {
    from: toISODate(new Date(year, month - 1, start)),
    to: toISODate(new Date(year, month, start - 1)),
  }
}

/** The payroll period `delta` periods away from the one ending on `toISO`. */
export function shiftPayrollPeriod(toISO, delta) {
  const end = fromISODate(toISO)
  // Day 1 is always before the cycle start, so the shifted date names the
  // period we want rather than spilling into the following one.
  return payrollPeriod(new Date(end.getFullYear(), end.getMonth() + delta, 1))
}

/** 'October 2026' for the period ending on `toISO`. */
export function payrollPeriodLabel(toISO) {
  const end = fromISODate(toISO)
  return end.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}

/** 'Tue, 14-10-26' — the workbook's "ddd, dd-mm-yy" day label. */
export function dayLabel(iso) {
  const d = fromISODate(iso)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yy = String(d.getFullYear()).slice(-2)
  return `${WEEKDAYS[d.getDay()]}, ${dd}-${mm}-${yy}`
}

export function isFriday(iso) {
  return fromISODate(iso).getDay() === 5
}

export function isWeekend(iso) {
  const day = fromISODate(iso).getDay()
  return day === 5 || day === 6 // Fri/Sat — the Egyptian working week
}

/** 90 -> '01:30'. Durations are stored as integer minutes to avoid float drift. */
export function minutesToHHMM(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0))
  const h = Math.floor(total / 60)
  const m = total % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** '01:30' | '1:30' | '1.5' -> 90. Returns 0 for anything unparseable. */
export function hhmmToMinutes(value) {
  if (value == null || value === '') return 0
  const text = String(value).trim()
  if (text.includes(':')) {
    const [h, m] = text.split(':')
    return (parseInt(h, 10) || 0) * 60 + (parseInt(m, 10) || 0)
  }
  const asHours = Number(text)
  return Number.isFinite(asHours) ? Math.round(asHours * 60) : 0
}

export function hoursToHHMM(hours) {
  return minutesToHHMM(Math.round((Number(hours) || 0) * 60))
}

/** Postgres `time` comes back as 'HH:MM:SS'; <input type="time"> wants 'HH:MM'. */
export function trimTime(value) {
  if (!value) return ''
  return String(value).slice(0, 5)
}

export function money(value, currency = 'EGP') {
  const n = Number(value) || 0
  return `${n.toLocaleString('en-EG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${currency}`
}

export function num(value, decimals = 2) {
  const n = Number(value) || 0
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

/* ---------------------------------------------------------------------
 * Company mobile numbers.
 *
 * Stored in the formatted shape, 000-0000-0000, and a check constraint on
 * the column keeps it that way. Storing the dashes means every place that
 * shows a number -- this app's employee table, the company portal's
 * contacts card -- prints it correctly without each one needing its own
 * formatting pass.
 * ------------------------------------------------------------------- */

export const MOBILE_DIGITS = 11

/** Digits only, never more than a whole number's worth. */
export function mobileDigits(value) {
  return String(value ?? '').replace(/\D/g, '').slice(0, MOBILE_DIGITS)
}

/**
 * 01271301076 -> 012-7130-1076.
 *
 * Partial input formats as far as it reaches, so the dashes appear while
 * someone is still typing rather than all at the end.
 */
export function formatMobile(value) {
  const digits = mobileDigits(value)
  if (digits.length <= 3) return digits
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`
}

/** Eleven digits, the first of them a zero. */
export function isValidMobile(value) {
  const digits = mobileDigits(value)
  return digits.length === MOBILE_DIGITS && digits.startsWith('0')
}
