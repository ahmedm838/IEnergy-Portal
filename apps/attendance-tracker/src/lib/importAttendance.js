/**
 * Reading a fingerprint machine's attendance export.
 *
 * The machine exports one row per employee per day, with the columns it
 * chooses to include. Four of them matter: AC-No., Date, Clock In and
 * Clock Out. Everything else -- the shift name, the machine's own
 * absence and overtime arithmetic -- is ignored, because the tracker
 * works those out from its own rules and two answers to the same
 * question is worse than one.
 *
 * Nothing here touches the database or the page. It takes rows and
 * returns what should happen, so it can be run against a real export
 * without a browser.
 */

/* Column headings, lower-cased and stripped of spaces, dots and dashes.
 *
 * NOT "Emp No." for the machine number, though it reads like it. The
 * export carries both, and Emp No. is 3 for every row in it -- a
 * company or department number, not a person. Accepting it as an alias
 * matched column one instead of column two and read nobody's
 * attendance while looking like it worked. A heading this cannot
 * recognise is an error the person sees, which is the better failure. */
const WANTED = {
  ac: ['acno', 'acnumber', 'acn'],
  date: ['date', 'attdate', 'attendancedate'],
  clockIn: ['clockin', 'checkin', 'in', 'timein'],
  clockOut: ['clockout', 'checkout', 'out', 'timeout'],
}

const normalise = (text) => String(text ?? '').toLowerCase().replace(/[\s._-]/g, '')

/**
 * The AC-No. an employee code corresponds to.
 *
 * The machine numbers people from 1; the tracker's codes are six digits
 * whose first two are a prefix (240001 and 260028 are both on the same
 * machine, as 1 and 28). So the first two digits come off and the rest
 * is read as a number, which also drops the leading zeros.
 *
 * Null for anything that is not six digits, rather than a guess: a code
 * of another shape means this mapping was not what was meant, and
 * silently matching the wrong person is the worst thing this could do.
 */
export function acNumberFor(code) {
  const digits = String(code ?? '').trim()
  if (!/^\d{6}$/.test(digits)) return null
  return Number(digits.slice(2))
}

/**
 * A date cell as YYYY-MM-DD, or null.
 *
 * The export writes 01-07-2026 for the first of July: day first. That
 * is ambiguous with month-first for the first twelve days of a month,
 * and guessing wrong moves a day's attendance to another month without
 * anything looking wrong, so only the machine's own format is accepted.
 * ISO (2026-07-01) is accepted too because some firmware writes it.
 *
 * A number is an Excel serial date, which is what a cell formatted as a
 * date gives when read raw.
 */
export function parseSheetDate(value) {
  if (value == null || value === '') return null

  if (typeof value === 'number' && Number.isFinite(value)) {
    // Excel's epoch is 30 Dec 1899; the 1900 leap-year bug is already
    // accounted for by that date rather than by 31 Dec.
    const ms = Math.round((value - 25569) * 86400000)
    const d = new Date(ms)
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
  }

  const text = String(value).trim()

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`

  const dmy = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(text)
  if (dmy) {
    const [, d, m, y] = dmy
    const day = Number(d)
    const month = Number(m)
    if (month < 1 || month > 12 || day < 1 || day > 31) return null
    return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }

  return null
}

/**
 * Every time in a cell, as HH:MM.
 *
 * A cell usually holds one time. It can hold several -- some exports
 * put every punch of the day in one cell, separated by spaces or
 * commas -- and that is the case the caller has to know about, so they
 * all come back rather than the first one.
 *
 * Seconds are dropped: the tracker records minutes.
 */
export function parseTimes(value) {
  if (value == null || value === '') return []

  // A fraction of a day, which is what a time-formatted cell reads as.
  if (typeof value === 'number' && Number.isFinite(value)) {
    const minutes = Math.round((value % 1) * 1440)
    if (minutes < 0 || minutes >= 1440) return []
    const h = String(Math.floor(minutes / 60)).padStart(2, '0')
    const m = String(minutes % 60).padStart(2, '0')
    return [`${h}:${m}`]
  }

  const found = String(value).match(/\d{1,2}:\d{2}(?::\d{2})?/g) ?? []
  const times = []
  for (const hit of found) {
    const [h, m] = hit.split(':')
    const hour = Number(h)
    const minute = Number(m)
    if (hour > 23 || minute > 59) continue
    times.push(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`)
  }
  return times
}

/**
 * Find the four columns, wherever the export has put them.
 *
 * Matching the heading text rather than the position, because the
 * machine's export settings decide which columns are included and a
 * fixed column number would read the shift name as a date the first
 * time somebody changes them.
 */
export function findColumns(headerRow) {
  const columns = {}
  headerRow.forEach((cell, index) => {
    const key = normalise(cell)
    for (const [name, candidates] of Object.entries(WANTED)) {
      if (columns[name] === undefined && candidates.includes(key)) columns[name] = index
    }
  })
  return columns
}

/**
 * The header row's index, or -1.
 *
 * Exports often begin with a title and a date range before the table,
 * so the first row is not reliably the header. The header is the first
 * row that carries both an AC-No. and a Date column.
 */
export function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 25); i += 1) {
    const columns = findColumns(rows[i] ?? [])
    if (columns.ac !== undefined && columns.date !== undefined) return i
  }
  return -1
}

/**
 * What an export says about one employee over one date range.
 *
 * `rows` is the sheet as arrays -- not objects. That is deliberate: a
 * sheet whose heading cell reads "__proto__" turns into a dangerous
 * object key if the rows are built as objects, and an array has no such
 * edge.
 *
 * Returns:
 *   days         { iso: { clock_in, clock_out } } -- the days to fill in
 *   issues       [ { date, reason, detail } ]     -- the days left alone
 *   noPunchDays  [ iso ] -- days in range the machine saw nothing on
 *   matched      how many rows were this employee's, inside the range
 *
 * THE TWO RULES, both of which mean "do not guess":
 *
 *   A day with only one of the two times is an issue, not a half-filled
 *   day. The tracker computes worked hours from the pair, so inventing
 *   the missing half would produce a figure nobody entered.
 *
 *   A day with more than one of either is an issue too. Which punch was
 *   the real start and which was lunch is not something this can know,
 *   and picking the earliest would quietly turn a late arrival into an
 *   on-time one.
 *
 * A day with neither time is not an issue -- it is an ordinary absence
 * or a day off, and the machine has nothing to say about it. It is
 * still reported, separately from the issues, because "the machine saw
 * nothing on these days" is worth reading before marking a month
 * absent; it is just not something anybody has to fix.
 */
export function buildImport(rows, { acNo, from, to }) {
  if (acNo == null) {
    return { error: 'This employee\'s code is not six digits, so it has no AC-No. on the machine.' }
  }

  const headerIndex = findHeaderRow(rows)
  if (headerIndex < 0) {
    return { error: 'No AC-No. and Date columns were found in this file. Is it an attendance export?' }
  }

  const columns = findColumns(rows[headerIndex])
  if (columns.clockIn === undefined && columns.clockOut === undefined) {
    return { error: 'This file has no Clock In or Clock Out column, so there are no times to read.' }
  }

  // Collected per day first, so several rows for one day are seen as
  // the several punches they are rather than overwriting each other.
  const perDay = new Map()
  let matched = 0

  for (let i = headerIndex + 1; i < rows.length; i += 1) {
    const row = rows[i] ?? []
    const ac = Number(String(row[columns.ac] ?? '').trim())
    if (!Number.isFinite(ac) || ac !== acNo) continue

    const iso = parseSheetDate(row[columns.date])
    if (!iso || iso < from || iso > to) continue

    matched += 1
    if (!perDay.has(iso)) perDay.set(iso, { in: [], out: [] })
    const day = perDay.get(iso)
    day.in.push(...parseTimes(columns.clockIn === undefined ? '' : row[columns.clockIn]))
    day.out.push(...parseTimes(columns.clockOut === undefined ? '' : row[columns.clockOut]))
  }

  const days = {}
  const issues = []
  const noPunchDays = []

  for (const iso of [...perDay.keys()].sort()) {
    const { in: ins, out: outs } = perDay.get(iso)

    if (ins.length === 0 && outs.length === 0) {
      noPunchDays.push(iso)
      continue
    }
    if (ins.length > 1 || outs.length > 1) {
      issues.push({
        date: iso,
        reason: 'Multiple punches',
        fileStatus: `In ${ins.join(', ') || '—'} · Out ${outs.join(', ') || '—'}`,
      })
      continue
    }
    if (ins.length === 0) {
      issues.push({ date: iso, reason: 'Missing clock in', fileStatus: `Out ${outs[0]}` })
      continue
    }
    if (outs.length === 0) {
      issues.push({ date: iso, reason: 'Missing clock out', fileStatus: `In ${ins[0]}` })
      continue
    }

    days[iso] = { clock_in: ins[0], clock_out: outs[0] }
  }

  return { days, issues, noPunchDays, matched }
}

/**
 * Work out the grid after an import, and what it did, together.
 *
 * These used to be apart: the page looped inside a setRows updater and
 * incremented counters the next line then read to build its message.
 * React queues an updater rather than running it there and then, so the
 * days were filled correctly and the message was written while every
 * counter was still zero -- "0 days filled" over a grid that had
 * visibly just been filled.
 *
 * Returning both from one pass is what stops that coming back: there is
 * no moment where the figures and the rows can disagree, because
 * neither exists without the other.
 *
 * `blocked(iso)` is the page's -- a locked period or a day that has not
 * happened yet. Kept out here so this knows nothing about either.
 */
export function applyImport({ rows, dirty, days, imported, typeId, emptyRow, blocked }) {
  const next = { ...rows }
  const touched = new Set(dirty)
  const inRange = new Set(days)
  // Not just counted: each kept day goes in the table below the grid
  // with what the file had for it, so "already recorded" can be checked
  // rather than taken on trust.
  const keptDays = []
  const blockedDays = []
  let filled = 0

  for (const [iso, times] of Object.entries(imported)) {
    if (!inRange.has(iso)) continue
    if (blocked(iso)) { blockedDays.push({ date: iso, ...times }); continue }
    // A day already given a type is left as it is. The machine knows
    // somebody badged in; it does not know the day was agreed as annual
    // leave, and overwriting would lose a person's decision in favour
    // of a turnstile.
    if (next[iso]?.attendance_type_id) {
      keptDays.push({ date: iso, typeId: next[iso].attendance_type_id, ...times })
      continue
    }
    next[iso] = {
      ...emptyRow,
      ...next[iso],
      attendance_type_id: typeId,
      clock_in: times.clock_in,
      clock_out: times.clock_out,
    }
    touched.add(iso)
    filled += 1
  }

  return {
    next,
    touched,
    filled,
    keptDays,
    blockedDays,
    kept: keptDays.length,
    blocked: blockedDays.length,
  }
}

/**
 * Every day the upload did not fill in, as one list in date order.
 *
 * Three things end up here and they are different in kind -- a day the
 * machine recorded nothing on, a day it recorded half of, and a day
 * that already had a type -- but they are one question to whoever is
 * looking: what did this upload not do, and why. Separate tables made
 * that three places to look and no way to read down a month.
 *
 * `typeName` turns a type id into its name, so the already-recorded
 * rows can say what they are recorded as. It is passed in because this
 * file knows nothing about the lookups.
 */
export function notUploadedRows({ issues = [], noPunchDays = [], keptDays = [], blockedDays = [] }, typeName) {
  const rows = [
    ...issues.map((issue) => ({
      date: issue.date,
      reason: issue.reason,
      fileStatus: issue.fileStatus,
    })),
    ...noPunchDays.map((date) => ({
      date,
      reason: 'No punch',
      fileStatus: 'No punch',
    })),
    ...keptDays.map((day) => ({
      date: day.date,
      reason: 'Already recorded',
      // What it is recorded as, beside what the file would have made it
      // -- the two together are what tells you whether to go and change
      // the day by hand.
      fileStatus: `${typeName(day.typeId)} · In ${day.clock_in} · Out ${day.clock_out}`,
    })),
    ...blockedDays.map((day) => ({
      date: day.date,
      reason: 'Locked or future',
      fileStatus: `In ${day.clock_in} · Out ${day.clock_out}`,
    })),
  ]

  return rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}
