import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import EmployeeSearch from '../components/EmployeeSearch'
import PeriodLabel from '../components/PeriodLabel'
import ColumnFilterTh from '../components/ColumnFilterTh'
import { supabase, run } from '../lib/supabase'
import { useLookups, useEmployees } from '../lib/useLookups'
import { useLocks, lockRangeLabel } from '../lib/useLocks'
import { recordBlockReason } from '../lib/recordable'
import { summarise } from '../lib/calc'
import { readSheetRows, prefetchWorkbookReader } from '../lib/readWorkbook'
import { acNumberFor, applyImport, buildImport, notUploadedRows } from '../lib/importAttendance'
import {
  dateRange,
  dayLabel,
  hhmmToMinutes,
  hoursToHHMM,
  isRestDay,
  minutesToHHMM,
  payrollPeriod,
  payrollPeriodLabel,
  shiftPayrollPeriod,
  toISODate,
  num,
  trimTime,
} from '../lib/format'
import {
  Alert,
  Button,
  Card,
  CardHeader,
  Checkbox,
  Field,
  Input,
  Select,
  Spinner,
  Stat,
  Td,
  Th,
  cx,
} from '../components/ui'

/* A day that has not happened yet cannot be recorded.

   Computed from the browser clock, which for this company is Cairo --
   the same boundary the database uses. It is deliberately recomputed
   on each call rather than captured once: a tab left open overnight
   would otherwise keep yesterday's idea of "today" and go on refusing
   the day that has since arrived. */
const isFutureDay = (iso) => iso > toISODate(new Date())

const EMPTY_ROW = {
  attendance_type_id: null,
  late_minutes: 0,
  transport: '',
  add_to_leave_balance: false,
  clock_in: '',
  clock_out: '',
  note: '',
}

const BLANK = '(blank)'
const EMPTY_SET = new Set()

/** A row that holds nothing worth keeping or deleting. */
const isEmptyRow = (row) =>
  !row ||
  (!row.attendance_type_id &&
    !row.late_minutes &&
    !Number(row.transport) &&
    !row.add_to_leave_balance &&
    !row.clock_in &&
    !row.clock_out &&
    !row.note)

function compareKeys(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b))
}

/**
 * The grid's columns, for sorting and filtering by value -- the same
 * shape the Employee report's Daily Records use. `value` is the text the
 * checklist lists and matches on; `sortKey` is what the column orders
 * by, null for an empty cell (always last).
 */
function gridColumns(typeById) {
  const typeOf = (r) => (r.attendance_type_id ? typeById?.get(r.attendance_type_id) : null)
  return [
    {
      key: 'date',
      label: 'Date',
      className: 'min-w-[140px]',
      value: (r) => dayLabel(r.work_date),
      sortKey: (r) => r.work_date,
    },
    {
      key: 'attendance',
      label: 'Attendance',
      className: 'min-w-[220px]',
      value: (r) => typeOf(r)?.name_en || BLANK,
      sortKey: (r) => typeOf(r)?.name_en?.toLowerCase() || null,
    },
    {
      key: 'late',
      label: 'Late (hh:mm)',
      value: (r) => minutesToHHMM(r.late_minutes),
      sortKey: (r) => Number(r.late_minutes) || 0,
    },
    {
      key: 'transport',
      label: 'Transport',
      value: (r) => num(Number(r.transport) || 0),
      sortKey: (r) => Number(r.transport) || 0,
    },
    {
      key: 'added',
      label: 'Add to balance',
      className: 'text-center',
      value: (r) => (r.add_to_leave_balance ? 'Yes' : 'No'),
      sortKey: (r) => (r.add_to_leave_balance ? 1 : 0),
    },
    {
      key: 'clock_in',
      label: 'Clock in',
      value: (r) => r.clock_in || BLANK,
      sortKey: (r) => r.clock_in || null,
    },
    {
      key: 'clock_out',
      label: 'Clock out',
      value: (r) => r.clock_out || BLANK,
      sortKey: (r) => r.clock_out || null,
    },
    {
      key: 'overtime',
      label: 'Overtime',
      value: (r) => {
        const type = typeOf(r)
        return type ? hoursToHHMM(Number(type.overtime_hours || 0)) : BLANK
      },
      sortKey: (r) => {
        const type = typeOf(r)
        return type ? Number(type.overtime_hours || 0) : null
      },
    },
    {
      key: 'note',
      label: 'Note',
      className: 'min-w-[160px]',
      value: (r) => r.note?.trim() || BLANK,
      sortKey: (r) => r.note?.trim().toLowerCase() || null,
    },
  ]
}

/**
 * The quick day filter, as on the Employee report, plus "Not recorded"
 * -- this grid draws every calendar day, recorded or not, and the empty
 * ones are the ones somebody is usually looking for here.
 */
function matchesDayFilter(row, dayFilter, typeById) {
  if (dayFilter === 'all') return true
  const type = row.attendance_type_id ? typeById?.get(row.attendance_type_id) : null
  if (dayFilter === 'blank') return !row.attendance_type_id
  if (dayFilter.startsWith('type:')) return row.attendance_type_id === Number(dayFilter.slice(5))
  if (!type) return false
  if (dayFilter === 'attended') return !!type.is_working_day
  if (dayFilter === 'not-attended') return !type.is_working_day
  if (dayFilter === 'leave') {
    // The same classification as the Employee report's Leave filter.
    return (
      !type.is_working_day &&
      type.effect !== 'absence' &&
      !['weekly_rest', 'holiday', 'no_status'].includes(type.code)
    )
  }
  return true
}

export default function Attendance() {
  const lookups = useLookups()
  const { employees, loading: employeesLoading } = useEmployees()
  const locks = useLocks()

  const [employeeId, setEmployeeId] = useState('')
  const [range, setRange] = useState(() => payrollPeriod())
  const [rows, setRows] = useState({})
  // The days as the database has them, so Discard can put back just the
  // shown days instead of reloading -- and losing -- everything.
  const [savedRows, setSavedRows] = useState({})
  const [savedDays, setSavedDays] = useState(() => new Set())
  // Filters, as on the Employee report.
  // 'all' | 'blank' | 'attended' | 'not-attended' | 'leave' | 'type:<id>'
  const [dayFilter, setDayFilter] = useState('all')
  const [columnFilters, setColumnFilters] = useState({})
  const [sort, setSort] = useState({ key: null, dir: null })
  // Bumped on every load, so the shown days are worked out again from
  // what the database returned.
  const [loadVersion, setLoadVersion] = useState(0)
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  const [dirty, setDirty] = useState(() => new Set())
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [importing, setImporting] = useState(false)
  // null until an upload has been read; [] afterwards when it was clean,
  // which is worth showing rather than leaving the last file's problems
  // on screen beside a new one's results.
  const [importReport, setImportReport] = useState(null)
  const fileInput = useRef(null)

  // The reader is a large chunk and most sessions never upload, so it is
  // warmed in the background rather than awaited inside the click.
  useEffect(() => { prefetchWorkbookReader() }, [])

  /* Everything an upload left on screen belongs to the person it was
     read for. Choosing somebody else leaves the grid showing one
     employee and "70 days filled in as attended" plus a table of dates
     describing another -- which reads as this employee's, because it
     is sitting under their name.

     The red message goes too, for the same reason: "no rows in this
     file are for AC-No. 3" is about the person who was selected when
     it was said. */
  useEffect(() => {
    setImportReport(null)
    setNotice(null)
    setError(null)
  }, [employeeId])

  // Ticked column values belong to the days that were on screen; another
  // employee or range has other values. The day filter and sort carry
  // over, as on the Employee report.
  useEffect(() => {
    setColumnFilters({})
  }, [employeeId, range.from, range.to])

  const days = useMemo(
    () => (range.from && range.to && range.from <= range.to ? dateRange(range.from, range.to) : []),
    [range],
  )

  const selectedEmployee = employees.find((e) => e.id === employeeId) || null

  // Records may only be written for an active employee. The database
  // refuses either way; this is so the grid does not invite a week of
  // typing it will then throw away.
  const employeeBlock = recordBlockReason(selectedEmployee)
  const readOnlyEmployee = employeeBlock !== null

  // Rest days are per employee: some hold Friday and Saturday, some hold
  // Friday alone, so a Saturday is time off for one person and an ordinary
  // working day for the colleague beside them. The fill buttons, and the
  // shading that marks a row as time off, both follow whoever is selected
  // rather than a single company-wide assumption.
  const weekend = selectedEmployee?.weekend === 'fri' ? 'fri' : 'fri_sat'
  const restDay = useCallback((iso) => isRestDay(iso, weekend), [weekend])

  // Warn before losing unsaved edits to a browser navigation.
  useEffect(() => {
    if (dirty.size === 0) return undefined
    const handler = (event) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  /* `keep` is the days whose unsaved edits survive the reload. Saving
     only the shown days must not throw away changes made on days a
     filter is hiding, so those are carried across. */
  const loadRecords = useCallback(async ({ keep } = {}) => {
    if (!employeeId || days.length === 0) {
      setRows({})
      setSavedRows({})
      setDirty(new Set())
      setLoadVersion((v) => v + 1)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const data = await run(
        supabase
          .from('attendance_records')
          // Only what the grid shows: no ids, audit stamps or timestamps,
          // which were half of every row sent.
          .select('work_date, attendance_type_id, late_minutes, transport, add_to_leave_balance, clock_in, clock_out, note')
          .eq('employee_id', employeeId)
          .gte('work_date', range.from)
          .lte('work_date', range.to),
      )
      const next = {}
      for (const record of data) {
        next[record.work_date] = {
          attendance_type_id: record.attendance_type_id,
          late_minutes: record.late_minutes ?? 0,
          transport: Number(record.transport) || '',
          add_to_leave_balance: record.add_to_leave_balance ?? false,
          clock_in: trimTime(record.clock_in),
          clock_out: trimTime(record.clock_out),
          note: record.note ?? '',
        }
      }
      // Which days exist in the database, as opposed to being blank rows
      // the grid draws for every date in the period. Clearing a day is a
      // delete, and only these have anything to delete.
      setSavedDays(new Set(Object.keys(next)))
      setSavedRows(next)
      const kept = new Set()
      const merged = { ...next }
      for (const iso of keep ?? []) {
        if (!(iso in rowsRef.current)) continue
        merged[iso] = rowsRef.current[iso]
        kept.add(iso)
      }
      setRows(merged)
      setDirty(kept)
      setLoadVersion((v) => v + 1)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [employeeId, range.from, range.to, days.length])

  useEffect(() => {
    loadRecords()
  }, [loadRecords])

  const getRow = useCallback((iso) => rows[iso] ?? EMPTY_ROW, [rows])

  const columns = useMemo(() => gridColumns(lookups.typeById), [lookups.typeById])
  const activeColumnFilters = useMemo(
    () => columns.filter((c) => columnFilters[c.key]?.size),
    [columns, columnFilters],
  )
  const filtering = dayFilter !== 'all' || activeColumnFilters.length > 0

  /* The days on screen.

     Worked out when a filter, the sort, the range or the loaded records
     change -- not on every keystroke. Read live, a day would vanish from
     under the cursor the moment it stopped matching: filter to "Not
     recorded", give a day a type, and the row is gone before the next
     field can be filled. This keeps the rows put, the way a filtered
     column in Excel does, until the filter is changed again.

     These days are also what every button acts on: the fills, Upload,
     Clear days, Discard and Save. */
  const visibleDays = useMemo(() => {
    const current = rowsRef.current
    const rowFor = (iso) => ({ ...(current[iso] ?? EMPTY_ROW), work_date: iso })
    let list = days
    if (filtering) {
      list = days.filter((iso) => {
        const r = rowFor(iso)
        return (
          matchesDayFilter(r, dayFilter, lookups.typeById) &&
          activeColumnFilters.every((c) => columnFilters[c.key].has(c.value(r)))
        )
      })
    }
    const col = sort.key && columns.find((c) => c.key === sort.key)
    if (col && sort.dir) {
      const sign = sort.dir === 'desc' ? -1 : 1
      list = [...list].sort((a, b) => {
        const ka = col.sortKey(rowFor(a))
        const kb = col.sortKey(rowFor(b))
        if (ka == null || kb == null) {
          if (ka == null && kb == null) return compareKeys(a, b)
          return ka == null ? 1 : -1
        }
        return sign * compareKeys(ka, kb) || compareKeys(a, b)
      })
    }
    return list
    // rowsRef is read on purpose: see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, dayFilter, columnFilters, activeColumnFilters, sort, columns, filtering, loadVersion, lookups.typeById])

  const visibleSet = useMemo(() => new Set(visibleDays), [visibleDays])
  const dirtyShown = useMemo(() => [...dirty].filter((iso) => visibleSet.has(iso)), [dirty, visibleSet])
  const dirtyHidden = dirty.size - dirtyShown.length

  /* Each column's checklist, built from the rows every other filter lets
     through, as on the Employee report, so the counts beside each value
     are what ticking it would show. */
  const columnOptions = useMemo(() => {
    const all = days.map((iso) => ({ ...(rows[iso] ?? EMPTY_ROW), work_date: iso }))
    const base = all.filter((r) => matchesDayFilter(r, dayFilter, lookups.typeById))
    const out = {}
    for (const col of columns) {
      const others = activeColumnFilters.filter((c) => c.key !== col.key)
      const tally = new Map()
      for (const r of base) {
        if (!others.every((c) => columnFilters[c.key].has(c.value(r)))) continue
        const value = col.value(r)
        const entry = tally.get(value)
        if (entry) entry.count += 1
        else tally.set(value, { value, label: value, count: 1, key: col.sortKey(r) })
      }
      for (const value of columnFilters[col.key] ?? []) {
        if (!tally.has(value)) tally.set(value, { value, label: value, count: 0, key: null })
      }
      out[col.key] = [...tally.values()].sort((a, b) => {
        if (a.key == null) return b.key == null ? 0 : 1
        if (b.key == null) return -1
        return compareKeys(a.key, b.key)
      })
    }
    return out
  }, [days, rows, dayFilter, columns, activeColumnFilters, columnFilters, lookups.typeById])

  function cycleSort(key) {
    setSort((s) => {
      if (s.key !== key) return { key, dir: 'asc' }
      if (s.dir === 'asc') return { key, dir: 'desc' }
      return { key: null, dir: null }
    })
  }

  function setColumnFilter(key, values) {
    setColumnFilters((f) => ({ ...f, [key]: values }))
  }

  function resetFilters() {
    setDayFilter('all')
    setColumnFilters({})
    setSort({ key: null, dir: null })
  }

  const dayFilterLabel =
    dayFilter === 'all'
      ? null
      : dayFilter === 'blank'
        ? 'Not recorded'
        : dayFilter === 'attended'
          ? 'Attended'
          : dayFilter === 'not-attended'
            ? 'Not attended'
            : dayFilter === 'leave'
              ? 'Leave'
              : (lookups.allTypes?.find((t) => `type:${t.id}` === dayFilter)?.name_en ?? 'Filtered')
  const filterLabel =
    [
      dayFilterLabel,
      ...activeColumnFilters.map((c) => `${c.label}: ${[...columnFilters[c.key]].join(', ')}`),
    ]
      .filter(Boolean)
      .join(' · ') || null

  // "the 12 shown days" when filtered, "the 31 days" when not -- so every
  // confirmation and message says which days it means.
  const scopeWord = filtering ? 'shown ' : ''

  const update = useCallback(
    (iso, patch) => {
      // Locked days, future days and non-active employees all render
      // disabled, so this is belt and braces -- but it keeps them out of
      // `dirty`, which is what the save sends.
      if (readOnlyEmployee || locks.isLocked(iso) || isFutureDay(iso)) return
      setRows((current) => {
        const next = { ...(current[iso] ?? EMPTY_ROW), ...patch }

        /* Choosing a day nobody worked clears what only a worked day can
           have. Disabling the inputs alone is not enough: a day switched
           from Attended to Absent would keep the clock-in, the transport
           and the rest, greyed out on screen and saved all the same. The
           note is deliberately left -- "called in sick" belongs on an
           absent day more than anywhere else. */
        if ('attendance_type_id' in patch) {
          const type = patch.attendance_type_id
            ? lookups.typeById?.get(patch.attendance_type_id)
            : null
          /* No type at all clears the day as well, and for a stronger
             reason than a non-worked one: there is no day here to be
             late for or travel to. Leaving the figures behind would mean
             a row showing a transport allowance against nothing, and on
             save the day is removed outright -- so they would be numbers
             waiting to be deleted without anybody being told. */
          if (!patch.attendance_type_id || (type && !type.is_working_day)) {
            next.late_minutes = 0
            next.transport = ''
            next.add_to_leave_balance = false
            next.clock_in = ''
            next.clock_out = ''
          }
          // The note goes only when the day itself goes. On a non-worked
          // day "called in sick" belongs more than anywhere else; on no
          // day at all it belongs nowhere.
          if (!patch.attendance_type_id) next.note = ''
        }

        return { ...current, [iso]: next }
      })
      setDirty((current) => new Set(current).add(iso))
      setNotice(null)
    },
    [locks.isLocked, readOnlyEmployee, lookups.typeById],
  )

  /** Apply a type to every day matching `predicate` that has no type yet. */
  function bulkFill(typeCode, predicate) {
    const type = lookups.types?.find((t) => t.code === typeCode)
    if (!type) {
      // Say so rather than appearing to work. These buttons match on the
      // attendance type's code, so without this they would do nothing at
      // all with no clue why. Two things can cause it now -- the type
      // being unticked under Available, or its code having changed -- so
      // the message names both rather than only the second.
      setError(
        `No attendance type with code "${typeCode}" is available, so this bulk fill did nothing. ` +
          'Check Settings: either it has been unticked under Available, or its code has ' +
          'changed — the code is an internal identifier these buttons match on.',
      )
      return
    }
    setRows((current) => {
      const next = { ...current }
      const touched = new Set(dirty)
      // Only the days on screen: with a filter on, the hidden ones are
      // left exactly as they are.
      for (const iso of visibleDays) {
        if (!predicate(iso)) continue
        if (locks.isLocked(iso)) continue
        // Fill Weekends and the like would otherwise march on into days
        // nobody has lived through yet.
        if (isFutureDay(iso)) continue
        if (next[iso]?.attendance_type_id) continue
        next[iso] = { ...EMPTY_ROW, ...next[iso], attendance_type_id: type.id }
        touched.add(iso)
      }
      setDirty(touched)
      return next
    })
    setNotice(null)
  }

  /**
   * Take an attendance machine's export and fill in the days it covers.
   *
   * The file is read in this browser. Nothing is uploaded anywhere and
   * nothing is written to the database: every day it fills becomes an
   * unsaved change like any other, so Save is still what commits them
   * and Discard still throws them away.
   *
   * A day that already carries a type is left alone and counted, never
   * overwritten. The machine knows somebody badged in; it does not know
   * that a day was agreed as annual leave, and overwriting would lose a
   * decision a person made in favour of a turnstile.
   */
  async function handleUpload(file) {
    if (!file || !selectedEmployee || readOnlyEmployee) return
    setError(null)
    setNotice(null)
    setImportReport(null)
    setImporting(true)
    try {
      const acNo = acNumberFor(selectedEmployee.code)
      const result = buildImport(await readSheetRows(file), {
        acNo,
        from: range.from,
        to: range.to,
      })
      if (result.error) {
        setError(result.error)
        return
      }
      if (!result.matched) {
        /* Say what the file does contain. The AC-No. column has to hold
           the whole six-digit employee code now, and the usual reason
           for no match is a machine still exporting its own 1, 2, 3…
           numbering -- which this makes obvious instead of leaving
           somebody to open the spreadsheet and guess. */
        const found = result.acNumbersInFile ?? []
        const sample = found.length
          ? ` The AC-No. column in this file holds: ${found.join(', ')}` +
            `${result.acNumbersTotal > found.length ? ' …' : ''}.` +
            ' It has to hold the whole six-digit employee code.'
          : ''
        setError(
          `No rows in this file are for AC-No. ${acNo} (code ${selectedEmployee.code}) ` +
            `between ${range.from} and ${range.to}.${sample}`,
        )
        return
      }

      const type = lookups.types?.find((t) => t.code === 'paid_day')
      if (!type) {
        setError(
          'No attendance type with code "paid_day" is available, so the upload filled nothing in. ' +
            'Check Settings: it has either been unticked under Available or had its code changed.',
        )
        return
      }

      /* The new grid and the figures describing it come back from one
         pass, and the state is handed over finished rather than
         computed inside a setRows updater. It was computed in one, and
         the counters it incremented were read on the next line to build
         the message -- but React queues an updater rather than running
         it there and then, so the days were filled in correctly while
         the message was written with every counter still at zero. */
      // Days in the file that a filter is hiding are left alone, like
      // every other button on this grid, and counted in the message.
      const hiddenByFilter = Object.keys(result.days).filter(
        (iso) => iso >= range.from && iso <= range.to && !visibleSet.has(iso),
      ).length

      const applied = applyImport({
        rows,
        dirty,
        days: visibleDays,
        imported: result.days,
        typeId: type.id,
        emptyRow: EMPTY_ROW,
        blocked: (iso) => locks.isLocked(iso) || isFutureDay(iso),
      })
      const { next, touched, filled, kept, blocked } = applied

      setRows(next)
      setDirty(touched)
      setImportReport(
        notUploadedRows(
          { ...result, keptDays: applied.keptDays, blockedDays: applied.blockedDays },
          (id) => lookups.typeById?.get(id)?.name_en ?? 'Unknown type',
        ).filter((row) => visibleSet.has(row.date)),
      )

      // A line per thing that happened and nothing for the things that
      // did not: a summary of four zeroes reads as a failure.
      const parts = [`${filled} day${filled === 1 ? '' : 's'} filled in as attended`]
      if (kept) parts.push(`${kept} already recorded`)
      if (blocked) parts.push(`${blocked} locked or in the future`)
      if (hiddenByFilter) parts.push(`${hiddenByFilter} hidden by the filter, left alone`)
      const issueCount = result.issues.filter((i) => visibleSet.has(i.date)).length
      const noPunchCount = result.noPunchDays.filter((iso) => visibleSet.has(iso)).length
      if (issueCount) parts.push(`${issueCount} need a look`)
      if (noPunchCount) parts.push(`${noPunchCount} with no punches`)
      setNotice(`${parts.join('. ')}. Nothing is saved yet — press Save to keep it.`)
    } catch (err) {
      setError(err.message)
    } finally {
      setImporting(false)
    }
  }

  /* Put the shown days back as they are saved. Days a filter hides keep
     their unsaved changes. */
  function discardShown() {
    if (dirtyShown.length === 0) return
    const what = `${dirtyShown.length} ${scopeWord}day${dirtyShown.length === 1 ? '' : 's'}`
    if (!window.confirm(`Discard the unsaved changes on the ${what}? Saved rows stay in the database.`)) {
      return
    }
    setRows((current) => {
      const next = { ...current }
      for (const iso of dirtyShown) {
        if (savedRows[iso]) next[iso] = savedRows[iso]
        else delete next[iso]
      }
      return next
    })
    setDirty((current) => {
      const next = new Set(current)
      dirtyShown.forEach((iso) => next.delete(iso))
      return next
    })
    setImportReport(null)
    setNotice(null)
  }

  /* Clear every shown day: type, times, transport, note, all of it.

     Two steps. The button only works out which days would go and puts
     a red warning above the grid saying how many; nothing changes until
     that warning is confirmed. Confirming deletes the saved days from
     the database there and then -- it does not wait for Save, so it
     cannot be undone with Discard, which is what the warning says.

     Locked and future days are skipped, as they are by every other
     button, and so are days a filter is hiding. */
  const [clearPrompt, setClearPrompt] = useState(null)
  const [clearing, setClearing] = useState(false)

  // A warning about "these 12 days" means nothing once the days on
  // screen are different ones.
  useEffect(() => {
    setClearPrompt(null)
  }, [employeeId, visibleDays])

  function askClearShownDays() {
    if (readOnlyEmployee) return
    const targets = visibleDays.filter(
      (iso) =>
        !locks.isLocked(iso) &&
        !isFutureDay(iso) &&
        (savedDays.has(iso) || !isEmptyRow(rows[iso])),
    )
    setNotice(null)
    if (targets.length === 0) {
      setClearPrompt(null)
      setError(`There is nothing to clear on the ${scopeWord}days.`)
      return
    }
    setError(null)
    const skipped = visibleDays.filter((iso) => locks.isLocked(iso) || isFutureDay(iso)).length
    setClearPrompt({ targets, skipped })
  }

  async function confirmClearShownDays() {
    if (!clearPrompt || readOnlyEmployee) return
    const { targets } = clearPrompt
    const targetSet = new Set(targets)
    const toDelete = targets.filter((iso) => savedDays.has(iso))
    // Unsaved edits on any other day survive the reload below.
    const keep = [...dirty].filter((iso) => !targetSet.has(iso))
    setClearing(true)
    setError(null)
    try {
      if (toDelete.length > 0) {
        await run(
          supabase
            .from('attendance_records')
            .delete()
            .eq('employee_id', employeeId)
            .in('work_date', toDelete),
        )
      }
      setClearPrompt(null)
      setImportReport(null)
      setNotice(
        `${targets.length} ${scopeWord}day${targets.length === 1 ? '' : 's'} cleared.`,
      )
      await loadRecords({ keep })
    } catch (err) {
      setError(err.message)
    } finally {
      setClearing(false)
    }
  }

  async function handleSave() {
    if (dirtyShown.length === 0 || readOnlyEmployee) return
    // Only the shown days are saved. Changes on days a filter hides stay
    // unsaved, and survive the reload below.
    const toSave = dirtyShown
    const hidden = [...dirty].filter((iso) => !visibleSet.has(iso))
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      /* Days set back to no type, which were saved before.

         Without this, choosing "—" looked like clearing the day and did
         nothing at all: the row below drops anything without a type, so
         the record stayed in the database exactly as it was while the
         screen showed it empty. No type has to mean the day is removed,
         or the option is a lie.

         Only days that were actually saved are listed. A blank day
         somebody clicked into and back out of has nothing to delete, and
         asking the database to remove it would be a write for nothing.
         Locked and future days are skipped here for the same reason they
         are skipped below -- the database refuses them, and one refusal
         takes the whole statement down. */
      const toClear = toSave.filter(
        (iso) =>
          !rows[iso]?.attendance_type_id &&
          savedDays.has(iso) &&
          !locks.isLocked(iso) &&
          !isFutureDay(iso),
      )

      const payload = toSave
        .map((iso) => {
          const row = rows[iso]
          if (!row?.attendance_type_id) return null
          // One locked day would abort the whole save in the database, so
          // a day that was locked while this page was open is dropped
          // rather than taking the other days down with it. A day that
          // became future cannot happen, but a day that was future when
          // the page opened can still be sitting in `dirty` from before
          // this rule existed, and the database would refuse the lot.
          if (locks.isLocked(iso) || isFutureDay(iso)) return null
          return {
            employee_id: employeeId,
            work_date: iso,
            attendance_type_id: row.attendance_type_id,
            late_minutes: row.late_minutes || 0,
            // The cell holds whatever was typed, blank included;
            // it becomes a number once, here.
            transport: Number(row.transport) || 0,
            add_to_leave_balance: !!row.add_to_leave_balance,
            clock_in: row.clock_in || null,
            clock_out: row.clock_out || null,
            note: row.note || null,
          }
        })
        .filter(Boolean)

      if (payload.length === 0 && toClear.length === 0) {
        setError('Nothing to save — every changed day still needs an attendance type.')
        setSaving(false)
        return
      }

      // Removals first. If the save that follows fails, the days meant to
      // be cleared are gone and the rest is untouched, which reloads into
      // a screen that matches the database; doing it the other way round
      // leaves saved days and uncleared ones in the same failed attempt.
      if (toClear.length > 0) {
        await run(
          supabase
            .from('attendance_records')
            .delete()
            .eq('employee_id', employeeId)
            .in('work_date', toClear),
        )
      }

      const saved = payload.length
        ? await run(supabase.rpc('save_attendance_rows', { p_rows: payload }))
        : 0

      const parts = []
      if (saved) parts.push(`Saved ${saved} day${saved === 1 ? '' : 's'}`)
      if (toClear.length) {
        parts.push(`cleared ${toClear.length} day${toClear.length === 1 ? '' : 's'}`)
      }
      if (hidden.length) {
        parts.push(
          `${hidden.length} change${hidden.length === 1 ? '' : 's'} on days hidden by the filter ` +
            'not saved yet',
        )
      }
      setNotice(`${parts.join(', ')}.`)
      await loadRecords({ keep: hidden })
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  function shiftPeriod(delta) {
    setRange(shiftPayrollPeriod(range.to, delta))
  }

  const lockedCount = useMemo(() => locks.countLocked(days), [days, locks.countLocked])
  const lockedRanges = useMemo(() => {
    const seen = new Map()
    for (const iso of days) {
      const lock = locks.lockFor(iso)
      if (lock) seen.set(lock.id, lockRangeLabel(lock))
    }
    return [...seen.values()]
  }, [days, locks.lockFor])

  const gridRows = useMemo(
    () => days.map((iso) => ({ ...getRow(iso), work_date: iso })),
    [days, getRow],
  )
  const totals = useMemo(
    () => summarise(gridRows.filter((r) => r.attendance_type_id), lookups.typeById, lookups.requiredHoursPerDay),
    [gridRows, lookups.typeById, lookups.requiredHoursPerDay],
  )

  if (lookups.loading || employeesLoading) return <Spinner label="Loading reference data…" />
  if (lookups.error) return <Alert tone="error">{lookups.error}</Alert>

  return (
    <div className="grid grid-cols-1 gap-5">
      <div>
        <h1 className="text-xl font-semibold text-ink">Attendance</h1>
        <p className="mt-0.5 text-sm text-ink-3">
          One row per calendar day, as in the workbook&rsquo;s employee report sheet.
        </p>
        <PeriodLabel from={range.from} to={range.to} className="mt-2" />
      </div>

      <Card>
        <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
          <EmployeeSearch
            className="sm:col-span-2 lg:col-span-1"
            employees={employees}
            value={employeeId}
            onChange={setEmployeeId}
            // An employee whose status does not allow records still has to
            // be findable -- their past days are still readable -- so the
            // status is shown beside the name rather than hidden.
            suffix={(emp) =>
              recordBlockReason(emp) ? emp.employee_statuses?.name ?? 'no status' : null
            }
          />

          <Field label="From">
            <Input
              type="date"
              value={range.from}
              onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
            />
          </Field>

          <Field label="To">
            <Input
              type="date"
              value={range.to}
              onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
            />
          </Field>

          <div className="flex items-end gap-2">
            <Button variant="secondary" onClick={() => shiftPeriod(-1)}>
              ‹ Prev
            </Button>
            <Button variant="secondary" onClick={() => setRange(payrollPeriod())}>
              This period
            </Button>
            <Button variant="secondary" onClick={() => shiftPeriod(1)}>
              Next ›
            </Button>
          </div>
        </div>
      </Card>

      {error && <Alert tone="error" onDismiss={() => setError(null)}>{error}</Alert>}
      {notice && <Alert tone="success" onDismiss={() => setNotice(null)}>{notice}</Alert>}

      {employeeBlock && (
        <Alert tone="warning" title="This employee cannot be recorded">
          {employeeBlock}
        </Alert>
      )}

      {lockedCount > 0 && !readOnlyEmployee && (
        <Alert
          tone="warning"
          title={
            lockedCount === days.length
              ? 'This period is locked'
              : `${lockedCount} of these ${days.length} days are locked`
          }
        >
          {lockedRanges.join(' · ')}
          {lockedRanges.length === 1 ? ' is closed' : ' are closed'} to edits. Those rows are
          read-only until a super admin unlocks the period under Settings.
        </Alert>
      )}

      {!employeeId ? (
        <Card>
          <div className="px-5 py-14 text-center text-sm text-ink-3">
            Choose an employee to start recording attendance.
          </div>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            <Stat dense label="Days recorded" value={`${totals.recordedDays} / ${days.length}`} />
            <Stat
              dense
              label="Working days"
              value={num(totals.workingDays, 0)}
              sub={`${num(totals.requiredHours)} h required`}
            />
            <Stat dense label="Worked hours" value={num(totals.workedHours)} />
            <Stat
              dense
              label="Variance"
              value={`${totals.hoursVariance >= 0 ? '+' : ''}${num(totals.hoursVariance)} h`}
              tone={totals.hoursVariance >= 0 ? 'good' : 'bad'}
            />
            <Stat
              dense
              label="Overtime"
              value={`${num(totals.overtime)} h`}
              sub={`${num(totals.mealUnits)} meal units`}
            />
            <Stat
              dense
              label="Total late"
              value={minutesToHHMM(totals.lateMinutes)}
              sub={`${num(totals.lateMinutes / 60)} h`}
              tone={totals.lateMinutes > 0 ? 'bad' : 'neutral'}
            />
            <Stat
              dense
              label="Total transport"
              value={num(totals.transport)}
              sub={lookups.currency}
            />
          </div>

          <Card>
            <CardHeader
              title={selectedEmployee ? `#${selectedEmployee.code} — ${selectedEmployee.name}` : ''}
              subtitle={
                (filtering
                  ? `Showing ${visibleDays.length} of ${days.length} days · ${filterLabel}`
                  : `${days.length} days`) +
                ` · ${dirtyShown.length} unsaved change${dirtyShown.length === 1 ? '' : 's'}` +
                (dirtyHidden > 0 ? ` (+${dirtyHidden} on hidden days)` : '')
              }
              actions={
                <>
                  {/* The input is what actually opens the file picker;
                      the button is here so it matches the others. The
                      value is cleared on every pick, or choosing the
                      same file twice in a row fires no change event and
                      the second upload appears to do nothing. */}
                  <input
                    ref={fileInput}
                    type="file"
                    accept=".xls,.xlsx,.xlsm,.csv"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      e.target.value = ''
                      handleUpload(file)
                    }}
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={readOnlyEmployee || importing}
                    onClick={() => fileInput.current?.click()}
                    title="Read clock in and clock out times from an attendance machine export"
                  >
                    {importing ? 'Reading…' : 'Upload'}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={readOnlyEmployee}
                    onClick={() => bulkFill('weekly_rest', restDay)}
                    title={filtering ? 'Applies to the shown days only' : undefined}
                  >
                    {weekend === 'fri' ? 'Fill Friday Rest' : 'Fill Fri/Sat Rest'}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={readOnlyEmployee}
                    onClick={() => bulkFill('paid_day', (iso) => !restDay(iso))}
                    title={filtering ? 'Applies to the shown days only' : undefined}
                  >
                    Fill workdays
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={readOnlyEmployee || visibleDays.length === 0 || clearing}
                    onClick={askClearShownDays}
                    title={
                      filtering
                        ? 'Delete the shown days only — asks first'
                        : 'Delete every day in the range — asks first'
                    }
                  >
                    Clear days
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={discardShown}
                    disabled={dirtyShown.length === 0}
                  >
                    Discard changes
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSave}
                    disabled={saving || dirtyShown.length === 0 || readOnlyEmployee}
                    title={dirtyHidden > 0 ? 'Saves the shown days only' : undefined}
                  >
                    {saving ? 'Saving…' : `Save ${dirtyShown.length || ''}`}
                  </Button>
                </>
              }
            />

            {clearPrompt && (
              <div className="border-b border-line px-5 py-3">
                <Alert tone="error" title="This cannot be undone">
                <p>
                  {clearPrompt.targets.length} {scopeWord}day
                  {clearPrompt.targets.length === 1 ? '' : 's'} will be cleared and deleted from the
                  database. This is not a reversible action.
                  {clearPrompt.skipped > 0 &&
                    ` ${clearPrompt.skipped} locked or future day${
                      clearPrompt.skipped === 1 ? '' : 's'
                    } will be left alone.`}
                </p>
                <div className="mt-3 flex gap-2">
                  <Button variant="danger" size="sm" onClick={confirmClearShownDays} disabled={clearing}>
                    {clearing
                      ? 'Clearing…'
                      : `Clear ${clearPrompt.targets.length} day${clearPrompt.targets.length === 1 ? '' : 's'}`}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setClearPrompt(null)}
                    disabled={clearing}
                  >
                    Cancel
                  </Button>
                </div>
              </Alert>
              </div>
            )}

            {/* The filters, as on the Employee report. Everything the
                buttons above do is limited to the days these leave. */}
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
              {[
                ['all', 'All'],
                ['blank', 'Not recorded'],
                ['attended', 'Attended'],
                ['not-attended', 'Not attended'],
                ['leave', 'Leave'],
              ].map(([value, label]) => (
                <Button
                  key={value}
                  size="sm"
                  variant={dayFilter === value ? 'primary' : 'secondary'}
                  onClick={() => setDayFilter(value)}
                >
                  {label}
                </Button>
              ))}
              <Select
                aria-label="Filter by attendance type"
                className="w-44 text-sm"
                value={dayFilter.startsWith('type:') ? dayFilter : ''}
                onChange={(e) => setDayFilter(e.target.value || 'all')}
              >
                <option value="">Any type…</option>
                {lookups.allTypes?.map((t) => (
                  <option key={t.id} value={`type:${t.id}`}>
                    {t.name_en}
                  </option>
                ))}
              </Select>
              {(filtering || sort.key) && (
                <Button
                  size="sm"
                  variant="ghost"
                  title="Show every day again, in date order"
                  onClick={resetFilters}
                >
                  Reset filters
                </Button>
              )}
            </div>

            {loading ? (
              <Spinner />
            ) : (
              <div className="max-h-[70vh] overflow-auto">
                <table className="sticky-head w-full border-collapse">
                  <thead>
                    <tr>
                      {columns.map((c) => (
                        <ColumnFilterTh
                          key={c.key}
                          label={c.label}
                          className={c.className}
                          sort={sort.key === c.key ? sort.dir : null}
                          onSort={() => cycleSort(c.key)}
                          options={columnOptions[c.key] ?? []}
                          selected={columnFilters[c.key] ?? EMPTY_SET}
                          onChange={(values) => setColumnFilter(c.key, values)}
                        />
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {visibleDays.length === 0 && (
                      <tr>
                        <Td colSpan={columns.length} className="py-6 text-center text-ink-3">
                          No days match the filters.{' '}
                          <button
                            type="button"
                            className="font-medium text-brand-600 hover:underline"
                            onClick={resetFilters}
                          >
                            Show all days
                          </button>
                        </Td>
                      </tr>
                    )}
                    {visibleDays.map((iso) => (
                      <DayRow
                        key={iso}
                        iso={iso}
                        row={getRow(iso)}
                        types={lookups.types ?? []}
                        typeById={lookups.typeById}
                        isDirty={dirty.has(iso)}
                        lock={locks.lockFor(iso)}
                        isRest={restDay(iso)}
                        readOnly={readOnlyEmployee}
                        future={isFutureDay(iso)}
                        onChange={(patch) => update(iso, patch)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Every day the upload did not fill in, in one table.

              Three different things land here -- a day the machine
              recorded nothing on, a day it recorded half of, and a day
              that already had a type -- but to whoever is looking they
              are one question: what did this not do, and why. Three
              tables was three places to look and no way to read down a
              month.

              Below the grid rather than inside it, because these are
              days to decide about, not rows to type into. Each carries
              what the file had, so the day can be settled in the grid
              above without opening the spreadsheet again. */}
          {importReport !== null && (
            <Card>
              <CardHeader
                title="Days not uploaded"
                subtitle={
                  importReport.length
                    ? `${importReport.length} day${importReport.length === 1 ? '' : 's'} the file ` +
                      'covered and the upload did not fill in. Set any of them in the grid above.'
                    : 'Every day the file covered was filled in.'
                }
                actions={
                  <Button variant="ghost" size="sm" onClick={() => setImportReport(null)}>
                    Dismiss
                  </Button>
                }
              />
              {importReport.length > 0 && (
                <div className="max-h-[40vh] overflow-auto">
                  <table className="sticky-head w-full border-collapse">
                    <thead>
                      <tr>
                        <Th className="min-w-[130px]">Date</Th>
                        <Th className="min-w-[150px]">Reason</Th>
                        <Th>File status</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {importReport.map((row) => (
                        <tr key={`${row.date}-${row.reason}`}>
                          <Td className="tabular whitespace-nowrap">{dayLabel(row.date)}</Td>
                          <Td className="whitespace-nowrap">{row.reason}</Td>
                          <Td className="tabular text-ink-3">{row.fileStatus}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}
        </>
      )}
    </div>
  )
}

function DayRow({ iso, row, types, typeById, isDirty, lock, readOnly, isRest, future, onChange }) {
  const type = row.attendance_type_id ? typeById.get(row.attendance_type_id) : null
  // Three reasons a row cannot be edited: the period is locked, the day
  // has not happened yet, or the employee is not one that may be
  // recorded. All three disable the inputs. The first two say why on the
  // row itself; the third is explained once above the grid instead of
  // repeated down every line of it.
  const locked = !!lock || readOnly || future

  /* A day the employee did not work has nothing to say about lateness,
     travel, a balance earned on it, or hours clocked. The type itself
     stays changeable -- that is how you correct the day. is_working_day
     is the same flag the Employee Report's Attended / Not attended
     filter uses, so the two cannot drift apart. */
  const notAttended = !!type && !type.is_working_day
  // No type is no day: nothing to be late for, travel to, or clock. The
  // fields are cleared when it is chosen and stay shut until a type is.
  const noType = !row.attendance_type_id
  const detailsLocked = locked || notAttended || noType
  const detailTitle = locked
    ? undefined
    : noType
      ? 'Choose an attendance type first'
      : notAttended
        ? `${type.name_en} is not a worked day`
        : undefined

  const lockTitle = lock
    ? `${lockRangeLabel(lock)} is locked${lock.note ? ` — ${lock.note}` : ''}`
    : future
      ? 'This day has not happened yet'
      : undefined
  const [lateText, setLateText] = useState(() => minutesToHHMM(row.late_minutes))
  const lastMinutes = useRef(row.late_minutes)

  // Keep the text field in step when the row is reloaded from the server,
  // without clobbering what the user is mid-way through typing.
  useEffect(() => {
    if (row.late_minutes !== lastMinutes.current) {
      lastMinutes.current = row.late_minutes
      setLateText(minutesToHHMM(row.late_minutes))
    }
  }, [row.late_minutes])

  return (
    <tr
      className={cx(
        'transition',
        locked
          ? 'bg-subtle/40 opacity-70'
          : isDirty
            ? 'bg-tint-warning/60'
            : isRest
              ? 'bg-subtle/70'
              : 'hover:bg-hover',
      )}
      title={lockTitle}
    >
      <Td className="font-medium text-ink">
        <div className="flex items-center gap-2">
          {dayLabel(iso)}
          {lock && (
            <span className="text-ink-4" aria-label="Locked" title={lockTitle}>
              &#128274;
            </span>
          )}
          {isDirty && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" title="Unsaved" />}
        </div>
      </Td>

      <Td>
        <Select
          value={row.attendance_type_id ?? ''}
          disabled={locked}
          onChange={(e) =>
            onChange({ attendance_type_id: e.target.value ? Number(e.target.value) : null })
          }
          className="py-1.5 text-sm"
        >
          <option value="">—</option>
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name_en} — {t.name_ar}
            </option>
          ))}
        </Select>
      </Td>

      <Td>
        <Input
          value={lateText}
          disabled={detailsLocked}
          title={detailTitle}
          onChange={(e) => setLateText(e.target.value)}
          onBlur={() => {
            const minutes = hhmmToMinutes(lateText)
            lastMinutes.current = minutes
            setLateText(minutesToHHMM(minutes))
            if (minutes !== row.late_minutes) onChange({ late_minutes: minutes })
          }}
          placeholder="00:00"
          className="w-24 py-1.5 text-sm"
          inputMode="numeric"
        />
      </Td>

      <Td>
        <Input
          type="number"
          min="0"
          step="0.01"
          value={row.transport ?? ''}
          placeholder="0"
          disabled={detailsLocked}
          title={detailTitle}
          onChange={(e) => onChange({ transport: e.target.value })}
          className="w-24 py-1.5 text-sm"
        />
      </Td>

      <Td className="text-center">
        <Checkbox
          checked={!!row.add_to_leave_balance}
          disabled={detailsLocked}
          title={detailTitle}
          onChange={(e) => onChange({ add_to_leave_balance: e.target.checked })}
        />
      </Td>

      <Td>
        <Input
          type="time"
          value={row.clock_in ?? ''}
          disabled={detailsLocked}
          title={detailTitle}
          onChange={(e) => onChange({ clock_in: e.target.value })}
          className="w-28 py-1.5 text-sm"
        />
      </Td>

      <Td>
        <Input
          type="time"
          value={row.clock_out ?? ''}
          disabled={detailsLocked}
          title={detailTitle}
          onChange={(e) => onChange({ clock_out: e.target.value })}
          className="w-28 py-1.5 text-sm"
        />
      </Td>

      <Td className="tabular text-ink-3">
        {type ? hoursToHHMM(Number(type.overtime_hours || 0)) : '—'}
      </Td>

      <Td>
        <Input
          value={row.note ?? ''}
          disabled={locked}
          onChange={(e) => onChange({ note: e.target.value })}
          className="py-1.5 text-sm"
          placeholder="—"
        />
      </Td>
    </tr>
  )
}
