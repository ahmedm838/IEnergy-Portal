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

/** First and last day of the month containing `date`, as ISO strings. */
export function monthBounds(date = new Date()) {
  const from = new Date(date.getFullYear(), date.getMonth(), 1)
  const to = new Date(date.getFullYear(), date.getMonth() + 1, 0)
  return { from: toISODate(from), to: toISODate(to) }
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
