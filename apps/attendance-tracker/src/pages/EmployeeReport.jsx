import { useCallback, useEffect, useMemo, useState } from 'react'
import EmployeeSearch from '../components/EmployeeSearch'
import PeriodLabel from '../components/PeriodLabel'
import ColumnFilterTh from '../components/ColumnFilterTh'
import { supabase, run } from '../lib/supabase'
import { useLookups, useEmployees } from '../lib/useLookups'
import { exportEmployeeReport, prefetchExcel } from '../lib/exportXlsx'
import {
  dateLabel,
  longDateLabel,
  dayLabel,
  minutesToHHMM,
  payrollPeriod,
  shiftPayrollPeriod,
  num,
  trimTime,
  hoursToHHMM,
} from '../lib/format'
import { workedHours } from '../lib/calc'
import {
  Alert,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Select,
  Spinner,
  Stat,
  Td,
  Th,
} from '../components/ui'

/**
 * Rows of the printed daily table that fit on the first page.
 *
 * Measured against the built stylesheet, not guessed. A4 at the
 * browser's default margins is a 717 x 1046px box; the name section,
 * the leave balances card and the Daily Records heading take the first
 * 457px of it, and a printed row is 22.2px, so 26 rows reach the foot
 * of the page. A calendar month is 30 or 31, which is where the five
 * stranded rows on a second sheet come from.
 *
 * Set one below the 26 that fit. Paper size, margins and whether the
 * browser prints its own header and footer all move the real figure a
 * little, and being wrong is lopsided: splitting a page early costs
 * nothing anyone would notice, while splitting one row late puts a
 * single stranded row on a second sheet -- the thing this exists to
 * prevent.
 *
 * Past about 52 days the two columns fill the page as well and a second
 * sheet is unavoidable. Nothing here tries to stop that.
 */
const PRINT_ROWS_PER_PAGE = 25

const BLANK = '(blank)'
const EMPTY_SET = new Set()

/**
 * The Daily Records columns, for sorting and filtering by value.
 *
 * `value` is what the filter checklist lists and matches on -- the text
 * shown in the cell, so what is ticked is what is seen. `sortKey` is what
 * the column orders by: the date, minutes and hours as numbers rather
 * than as the text they print as. A null sortKey is an empty cell, and
 * empty cells go to the bottom whichever way the column is sorted.
 */
const RECORD_COLUMNS = [
  { key: 'date', label: 'Date', value: (r) => dayLabel(r.work_date), sortKey: (r) => r.work_date },
  {
    key: 'attendance',
    label: 'Attendance',
    value: (r) => r.attendance_types?.name_en || BLANK,
    sortKey: (r) => r.attendance_types?.name_en?.toLowerCase() || null,
  },
  {
    key: 'late',
    label: 'Late',
    value: (r) => minutesToHHMM(r.late_minutes),
    sortKey: (r) => Number(r.late_minutes) || 0,
  },
  {
    key: 'transport',
    label: 'Transport',
    className: 'text-right',
    value: (r) => num(r.transport),
    sortKey: (r) => Number(r.transport) || 0,
  },
  {
    key: 'added',
    label: 'Added',
    className: 'text-center',
    value: (r) => (r.add_to_leave_balance ? 'Yes' : 'No'),
    sortKey: (r) => (r.add_to_leave_balance ? 1 : 0),
  },
  {
    key: 'clock_in',
    label: 'Clock in',
    value: (r) => trimTime(r.clock_in) || BLANK,
    sortKey: (r) => trimTime(r.clock_in) || null,
  },
  {
    key: 'clock_out',
    label: 'Clock out',
    value: (r) => trimTime(r.clock_out) || BLANK,
    sortKey: (r) => trimTime(r.clock_out) || null,
  },
  {
    key: 'worked',
    label: 'Worked',
    className: 'text-right',
    value: (r) => hoursToHHMM(workedHours(trimTime(r.clock_in), trimTime(r.clock_out))),
    sortKey: (r) => workedHours(trimTime(r.clock_in), trimTime(r.clock_out)),
  },
  {
    key: 'note',
    label: 'Note',
    value: (r) => r.note?.trim() || BLANK,
    sortKey: (r) => r.note?.trim().toLowerCase() || null,
  },
]

function compareKeys(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b))
}

/** Report 1 — the "employee report" sheet. */
export default function EmployeeReport() {
  const lookups = useLookups()
  const { employees, loading: employeesLoading } = useEmployees()

  const [employeeId, setEmployeeId] = useState('')
  const [range, setRange] = useState(() => payrollPeriod())
  const [summary, setSummary] = useState(null)
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [exporting, setExporting] = useState(false)
  // 'all' | 'attended' | 'not-attended' | 'leave' | 'type:<id>'
  const [dayFilter, setDayFilter] = useState('all')
  // Per-column value filters ({ [columnKey]: Set }) and the column sort.
  const [columnFilters, setColumnFilters] = useState({})
  const [sort, setSort] = useState({ key: null, dir: null })

  // Ticked values belong to the days that were on screen. A different
  // employee or range has different values, so they start clear; the
  // sort carries over, since "latest first" still means the same thing.
  useEffect(() => {
    setColumnFilters({})
  }, [employeeId, range.from, range.to])

  useEffect(() => {
    prefetchExcel()
  }, [])

  // Default to the signed-in user's own record so a read-only user lands
  // on something useful instead of an empty picker.
  useEffect(() => {
    if (!employeeId && employees.length === 1) setEmployeeId(employees[0].id)
  }, [employees, employeeId])

  const load = useCallback(async () => {
    if (!employeeId || range.from > range.to) return
    setLoading(true)
    setError(null)
    try {
      const [summaryData, recordData] = await Promise.all([
        run(
          supabase.rpc('report_employee_summary', {
            p_employee_id: employeeId,
            p_from: range.from,
            p_to: range.to,
          }),
        ),
        run(
          supabase
            .from('attendance_records')
            .select('id, work_date, attendance_type_id, late_minutes, transport, add_to_leave_balance, clock_in, clock_out, note, attendance_types ( id, code, name_en, name_ar, overtime_hours, is_working_day, effect )')
            .eq('employee_id', employeeId)
            .gte('work_date', range.from)
            .lte('work_date', range.to)
            .order('work_date'),
        ),
      ])
      setSummary(summaryData)
      setRecords(recordData)
    } catch (err) {
      setError(err.message)
      setSummary(null)
      setRecords([])
    } finally {
      setLoading(false)
    }
  }, [employeeId, range.from, range.to])

  useEffect(() => {
    load()
  }, [load])

  function shiftPeriod(delta) {
    setRange(shiftPayrollPeriod(range.to, delta))
  }

  /**
   * Attended means the employee was on shift that day, which is exactly what
   * is_working_day marks — the same flag that drives required hours. Reusing
   * it keeps the filter and the hours figures telling the same story, and it
   * stays correct if the flag is changed in Settings.
   */
  /* The leave balances table, added up.

     Guarded on summary being there: this runs on every render, including
     the ones before a report has been asked for. */
  const sumBalances = useMemo(() => {
    const rows = summary?.balances ?? []
    const add = (key) => rows.reduce((total, b) => total + Number(b[key] || 0), 0)
    return { balance: add("balance"), consumed: add("consumed"), remaining: add("remaining") }
  }, [summary])

  const dayFilteredRecords = useMemo(() => {
    if (dayFilter === 'all') return records
    if (dayFilter.startsWith('type:')) {
      const id = Number(dayFilter.slice(5))
      return records.filter((r) => r.attendance_type_id === id)
    }
    if (dayFilter === 'leave') {
      // Match the leave balances and Other leaves classification, including
      // replacement rest days and granted days, but not absence or No Status.
      return records.filter((r) => {
        const type = lookups.typeById?.get(r.attendance_type_id) ?? r.attendance_types
        return type && !type.is_working_day && type.effect !== 'absence'
          && !['weekly_rest', 'holiday', 'no_status'].includes(type.code)
      })
    }
    const wantAttended = dayFilter === 'attended'
    return records.filter((r) => {
      const type = lookups.typeById?.get(r.attendance_type_id)
      return Boolean(type?.is_working_day) === wantAttended
    })
  }, [records, dayFilter, lookups.typeById])

  const activeColumnFilters = useMemo(
    () => RECORD_COLUMNS.filter((c) => columnFilters[c.key]?.size),
    [columnFilters],
  )

  /* Each column's checklist is built from the rows every other filter
     lets through -- its own excluded -- the way Excel does it, so the
     counts beside each value are what ticking it would actually show. */
  const columnOptions = useMemo(() => {
    const out = {}
    for (const col of RECORD_COLUMNS) {
      const others = activeColumnFilters.filter((c) => c.key !== col.key)
      const tally = new Map()
      for (const r of dayFilteredRecords) {
        if (!others.every((c) => columnFilters[c.key].has(c.value(r)))) continue
        const value = col.value(r)
        const entry = tally.get(value)
        if (entry) entry.count += 1
        else tally.set(value, { value, label: value, count: 1, key: col.sortKey(r) })
      }
      // A value the user ticked that no longer appears stays listed (at
      // zero) so it can still be unticked.
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
  }, [dayFilteredRecords, activeColumnFilters, columnFilters])

  const visibleRecords = useMemo(() => {
    let rows = dayFilteredRecords
    if (activeColumnFilters.length) {
      rows = rows.filter((r) => activeColumnFilters.every((c) => columnFilters[c.key].has(c.value(r))))
    }
    const col = sort.key && RECORD_COLUMNS.find((c) => c.key === sort.key)
    if (col && sort.dir) {
      const sign = sort.dir === 'desc' ? -1 : 1
      rows = [...rows].sort((a, b) => {
        const ka = col.sortKey(a)
        const kb = col.sortKey(b)
        // Empty cells last either way; ties keep date order.
        if (ka == null || kb == null) {
          if (ka == null && kb == null) return compareKeys(a.work_date, b.work_date)
          return ka == null ? 1 : -1
        }
        return sign * compareKeys(ka, kb) || compareKeys(a.work_date, b.work_date)
      })
    }
    return rows
  }, [dayFilteredRecords, activeColumnFilters, columnFilters, sort])

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

  /* Two columns on paper once one column would not fit the page.

     Below the threshold the printed table is the one on screen with
     seven columns hidden; above it, that table is replaced by two
     narrow ones side by side. See PRINT_ROWS_PER_PAGE for where the
     number comes from. */
  const splitForPrint = visibleRecords.length > PRINT_ROWS_PER_PAGE
  const printHalves = useMemo(() => {
    // The taller half goes on the left, so a column that is one row
    // longer is the one the eye starts on.
    const half = Math.ceil(visibleRecords.length / 2)
    return { left: visibleRecords.slice(0, half), right: visibleRecords.slice(half) }
  }, [visibleRecords])

  const dayFilterLabel =
    dayFilter === 'all'
      ? null
      : dayFilter === 'attended'
        ? 'Attended days'
        : dayFilter === 'not-attended'
          ? 'Not attended'
          : dayFilter === 'leave'
            ? 'Leave'
            : (lookups.allTypes?.find((t) => `type:${t.id}` === dayFilter)?.name_en ?? 'Filtered')

  // The day filter and any column filters, in one line, for the subtitle
  // and the Excel file -- so a filtered export says what it was cut to.
  const filterLabel =
    [
      dayFilterLabel,
      ...activeColumnFilters.map((c) => `${c.label}: ${[...columnFilters[c.key]].join(', ')}`),
    ]
      .filter(Boolean)
      .join(' · ') || null
  const sortColumn = sort.key && RECORD_COLUMNS.find((c) => c.key === sort.key)
  const sortLabel = sortColumn
    ? `${sortColumn.label} ${sort.dir === 'desc' ? 'descending' : 'ascending'}`
    : null

  const employee = employees.find((e) => e.id === employeeId) || null

  /**
   * Hours owed mean nothing for someone paid overtime.
   *
   * With the Overtime switch on, extra hours are paid rather than measured
   * against a quota, so "required hours", what they worked against it, the
   * resulting excess or shortage, and the average clock times are not a
   * standard this employee is held to. Showing numbers there invites
   * somebody to read a shortage into a month that was never short. The
   * Hours report covers the opposite case -- the employees whose switch is
   * off, where the comparison is the whole point.
   */
  const hoursNotRequired = !!employee?.has_overtime
  const currency = lookups.currency

  const exportColumns = useMemo(
    () => [
      { header: 'Date', key: 'date' },
      { header: 'Attendance', key: 'attendance' },
      { header: 'الحالة', key: 'attendance_ar' },
      { header: 'Late (hh:mm)', key: 'late' },
      { header: `Transport (${currency})`, key: 'transport', numFmt: '#,##0.00' },
      { header: 'Add to balance', key: 'added' },
      { header: 'Clock in', key: 'clock_in' },
      { header: 'Clock out', key: 'clock_out' },
      { header: 'Worked hours', key: 'worked', numFmt: '0.00' },
      { header: 'Note', key: 'note' },
    ],
    [currency],
  )

  async function handleExport() {
    if (!summary || !employee) return
    setExporting(true)
    setError(null)
    try {
    const spec = {
      employee,
      from: range.from,
      to: range.to,
      summary: [
        // Same order as the heading on screen.
        ['Title', employee.title ?? ''],
        ['Level', employee.employee_levels
          ? `${employee.employee_levels.code} — ${employee.employee_levels.name}`
          : ''],
        ['Department', employee.departments?.name ?? ''],
        ['Sector', employee.departments?.sectors?.name ?? ''],
        ['Site', employee.sites?.name ?? ''],
        ['Working days', summary.working_days],
        // The same rule as on screen: a file that still carried the
        // numbers would be read as the real answer the moment it left
        // this page.
        ['Required hours', hoursNotRequired ? 'Not required' : Number(summary.required_hours)],
        ['Worked hours', hoursNotRequired ? 'Not required' : Number(summary.worked_hours)],
        [
          'Excess / shortage (hours)',
          hoursNotRequired ? 'Not required' : Number(summary.hours_variance),
        ],
        ['Average clock in', hoursNotRequired ? 'Not required' : summary.avg_clock_in ?? '—'],
        ['Average clock out', hoursNotRequired ? 'Not required' : summary.avg_clock_out ?? '—'],
        ['Total late', minutesToHHMM(summary.late_minutes)],
        ['Overtime hours', Number(summary.overtime_hours)],
        [`Total transport (${currency})`, Number(summary.transport_total)],
        ['Meal units', Number(summary.meal_units)],
        ['Absence days', summary.absence_days],
        ['Absence penalty (days)', Number(summary.absence_penalty)],
        ...(filterLabel ? [['Rows below filtered to', filterLabel]] : []),
        ...(sortLabel ? [['Rows below sorted by', sortLabel]] : []),
        ...summary.balances.map((b) => [
          `${b.label} — balance / consumed / remaining`,
          `${num(b.balance, 0)} / ${num(b.consumed, 0)} / ${num(b.remaining, 0)}`,
        ]),
        /* The same three totals the screen now shows, so a file read
           away from this page says what the page said. The export had
           the three balances and no sum at all, and never mentioned the
           other leaves -- which are days the employee took. */
        [
          'Total — balance / consumed / remaining',
          `${num(sumBalances.balance, 0)} / ${num(sumBalances.consumed, 0)} / ${num(
            sumBalances.remaining,
            0,
          )}`,
        ],
        ['Other leaves (days)', Number(summary.other_leaves || 0)],
        ...(summary.other_leave_types ?? []).map((t) => [
          `    ${t.name_en} (days)`,
          Number(t.days),
        ]),
        [
          'Grand Total — balance / consumed / remaining',
          `${num(sumBalances.balance, 0)} / ${num(
            sumBalances.consumed + Number(summary.other_leaves || 0),
            0,
          )} / ${num(sumBalances.remaining, 0)}`,
        ],
      ],
      columns: exportColumns,
      rows: visibleRecords.map((r) => ({
        date: dayLabel(r.work_date),
        attendance: r.attendance_types?.name_en ?? '',
        attendance_ar: r.attendance_types?.name_ar ?? '',
        late: minutesToHHMM(r.late_minutes),
        transport: Number(r.transport) || 0,
        added: r.add_to_leave_balance ? 'Yes' : '',
        clock_in: trimTime(r.clock_in),
        clock_out: trimTime(r.clock_out),
        worked: workedHours(trimTime(r.clock_in), trimTime(r.clock_out)),
        note: r.note ?? '',
      })),
    }
    await exportEmployeeReport(spec)
    } catch (err) {
      setError(`Could not build the Excel file: ${err.message}`)
    } finally {
      setExporting(false)
    }
  }

  if (lookups.loading || employeesLoading) return <Spinner />

  return (
    <div className="employee-report grid grid-cols-1 gap-5">
      <div className="no-print flex flex-wrap items-center gap-x-4 gap-y-1">
        <h1 className="text-xl font-semibold text-ink">Employee report</h1>
        <p className="text-sm text-ink-3">
          Day-by-day attendance with leave balances for a chosen period.
        </p>
        <PeriodLabel from={range.from} to={range.to} />
      </div>

      <Card className="no-print">
        <div className="employee-report-controls grid gap-4 p-5 sm:grid-cols-2">
          <EmployeeSearch
            className="employee-report-name sm:col-span-2"
            employees={employees}
            value={employeeId}
            onChange={setEmployeeId}
          />
          <Field label="From date">
            <Input
              type="date"
              value={range.from}
              onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
            />
          </Field>
          <Field label="To date">
            <Input
              type="date"
              value={range.to}
              onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
            />
          </Field>
          <div className="employee-report-actions flex flex-wrap items-end gap-2 sm:col-span-2">
            <Button variant="secondary" onClick={() => shiftPeriod(-1)}>
              ‹ Prev
            </Button>
            <Button variant="secondary" onClick={() => setRange(payrollPeriod())}>
              This period
            </Button>
            <Button variant="secondary" onClick={() => shiftPeriod(1)}>
              Next ›
            </Button>
            <Button variant="secondary" onClick={() => window.print()} disabled={!summary}>
              Print
            </Button>
            <Button onClick={() => handleExport()} disabled={!summary || loading || exporting}>
              {exporting ? 'Preparing…' : 'Export Excel'}
            </Button>
          </div>
        </div>
      </Card>

      {error && <Alert tone="error">{error}</Alert>}
      {loading && <Spinner />}

      {!employeeId && !loading && (
        <Card>
          <EmptyState title="No employee selected">
            Pick an employee above to see their attendance for the chosen period.
          </EmptyState>
        </Card>
      )}

      {summary && !loading && (
        <>
          <div className="rounded-xl border border-line bg-panel px-5 py-4">
            <h2 className="text-lg font-semibold text-ink">
              {summary.employee.name}{' '}
              <span className="font-normal text-ink-3">#{summary.employee.code}</span>
            </h2>
            {/* Title, level, department, sector, site -- widest thing
                first, then outwards: the job, the grade it sits at, the
                department, the sector that holds it, and where they
                work. A missing one shows a dash rather than collapsing
                the line, so the order stays readable across records. */}
            <p className="text-sm text-ink-3">
              {[
                employee?.title,
                employee?.employee_levels?.code,
                employee?.departments?.name,
                employee?.departments?.sectors?.name,
                employee?.sites?.name,
              ]
                .map((part) => part || '—')
                .join(' · ')}
            </p>
            <p className="mt-1 text-sm text-ink-3">
              {longDateLabel(range.from)} to {longDateLabel(range.to)}
            </p>
          </div>

          {/* Two to a row on a phone, so every figure is on screen; one
              scrolling strip from sm up, as before. */}
          <div className="employee-report-totals grid grid-cols-2 gap-1.5 pb-1 sm:grid-flow-col sm:grid-cols-none sm:auto-cols-[minmax(124px,1fr)] sm:overflow-x-auto">
            <Stat
              dense
              label="Required hours"
              value={hoursNotRequired ? 'Not required' : num(summary.required_hours)}
              sub={
                hoursNotRequired
                  ? 'Overtime is paid'
                  : `${summary.working_days} days × ${lookups.requiredHoursPerDay} h`
              }
            />
            <Stat
              dense
              label="Worked hours"
              value={hoursNotRequired ? 'Not required' : num(summary.worked_hours)}
              sub={hoursNotRequired ? 'Overtime is paid' : undefined}
            />
            <Stat
              dense
              label="Excess / shortage"
              value={
                hoursNotRequired
                  ? 'Not required'
                  : `${Number(summary.hours_variance) >= 0 ? '+' : ''}${num(summary.hours_variance)} h`
              }
              sub={hoursNotRequired ? 'Overtime is paid' : undefined}
              tone={
                hoursNotRequired ? undefined : Number(summary.hours_variance) >= 0 ? 'good' : 'bad'
              }
            />
            {/* Beside the excess or shortage it explains: a shortage next
                to a late average is a different conversation from a
                shortage next to an on-time one. */}
            <Stat
              dense
              label="Average clock in"
              value={hoursNotRequired ? 'Not required' : summary.avg_clock_in ?? '—'}
              sub={
                hoursNotRequired
                  ? 'Overtime is paid'
                  : `Clock out ${summary.avg_clock_out ?? '—'}`
              }
            />
            <Stat dense label="Late hours" value={minutesToHHMM(summary.late_minutes)} />
            <Stat dense label="Overtime hours" value={num(summary.overtime_hours)} />
            <Stat
              dense
              label="Transport"
              value={`${num(summary.transport_total)} ${currency}`}
            />
            {/* Meal units, not money: a day can earn more than one, and the
                rate is set on the monthly report, where it is applied. */}
            <Stat
              dense
              label="Meals"
              value={num(summary.meal_units)}
              sub={`at ${num(lookups.mealRate)} ${currency}`}
            />
            <Stat
              dense
              label="Absence penalty"
              value={`${num(summary.absence_penalty)} days`}
              sub={`${summary.absence_days} unauthorised absence${
                summary.absence_days === 1 ? '' : 's'
              }`}
              tone={Number(summary.absence_penalty) > 0 ? 'bad' : 'neutral'}
            />
          </div>

          <div className="employee-report-cards grid gap-5 lg:grid-cols-2">
            <Card className="employee-report-day-counts">
              <CardHeader title="Days by type" subtitle="Most frequent first" />
              {summary.day_counts.length === 0 ? (
                <EmptyState title="No attendance recorded in this period" />
              ) : (
                <table className="w-full">
                  <tbody className="divide-y divide-line">
                    {summary.day_counts.map((entry) => (
                      <tr key={entry.type_code}>
                        <Td className="font-medium text-ink">{entry.name_en}</Td>
                        <Td className="arabic text-ink-3">{entry.name_ar}</Td>
                        <Td className="tabular w-20 text-right font-semibold">{entry.days}</Td>
                      </tr>
                    ))}
                  </tbody>
                  {/* Every recorded day in the period, which is the
                      figure to check the list against: short of the
                      days in the range means days nobody recorded, and
                      that is the gap worth seeing from here. */}
                  <tfoot>
                    <tr className="border-t-2 border-line-strong">
                      <Td className="font-semibold text-ink">Total</Td>
                      <Td className="arabic text-ink-3">الإجمالي</Td>
                      <Td className="tabular w-20 text-right font-semibold text-ink">
                        {summary.day_counts.reduce((sum, entry) => sum + Number(entry.days || 0), 0)}
                      </Td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </Card>

            <Card>
              <CardHeader
                title="Leave balances"
                subtitle={`Calendar year ${dateLabel(summary.leave_year.from)} to ${dateLabel(summary.leave_year.to)}`}
              />
              <table className="w-full">
                <thead>
                  <tr className="border-b border-line">
                    <Th />
                    <Th className="text-right">Balance</Th>
                    <Th className="text-right">Consumed</Th>
                    <Th className="text-right">Remaining</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {summary.balances.map((b) => (
                    <tr key={b.label}>
                      <Td className="font-medium text-ink">{b.label}</Td>
                      <Td className="tabular text-right">{num(b.balance, 0)}</Td>
                      <Td className="tabular text-right">{num(b.consumed, 0)}</Td>
                      <Td
                        className={`tabular text-right font-semibold ${
                          Number(b.remaining) < 0 ? 'text-on-danger' : 'text-on-success'
                        }`}
                      >
                        {num(b.remaining, 0)}
                      </Td>
                    </tr>
                  ))}

                  {/* Total, under the three rows it adds up and nothing
                      else. Each figure is the column above it added
                      together, so it can be checked by eye. */}
                  <tr className="border-t-2 border-line-strong">
                    <Td className="font-semibold text-ink">Total</Td>
                    <Td className="tabular text-right font-semibold">
                      {num(sumBalances.balance, 0)}
                    </Td>
                    <Td className="tabular text-right font-semibold">
                      {num(sumBalances.consumed, 0)}
                    </Td>
                    <Td
                      className={`tabular text-right font-semibold ${
                        sumBalances.remaining < 0 ? 'text-on-danger' : 'text-on-success'
                      }`}
                    >
                      {num(sumBalances.remaining, 0)}
                    </Td>
                  </tr>

                  {/* The leave days none of the three account for. They
                      sit below the Total rather than above it because
                      they have no entitlement behind them -- which is
                      why Balance and Remaining are dashes here, and why
                      folding them into that Total would leave it not
                      matching the rows it claims to add up.

                      The report used to leave them out altogether for
                      that reason. Showing them under their own heading,
                      with a Grand Total beneath, says the same thing
                      without hiding days the employee actually took. */}
                  <tr>
                    <Td className="font-medium text-ink">Other leaves</Td>
                    <Td className="text-right text-ink-4">—</Td>
                    <Td className="tabular text-right">{num(summary.other_leaves, 0)}</Td>
                    <Td className="text-right text-ink-4">—</Td>
                  </tr>

                  {/* What those days were, each count in the Consumed
                      column rather than written into its label, lined up
                      under the figure it makes up. */}
                  {(summary.other_leave_types ?? []).map((t) => (
                    <tr key={t.name_en}>
                      <Td className="pl-6 text-sm text-ink-3">{t.name_en}</Td>
                      <Td className="text-right text-ink-4">—</Td>
                      <Td className="tabular text-right text-ink-3">{num(t.days, 0)}</Td>
                      <Td className="text-right text-ink-4">—</Td>
                    </tr>
                  ))}
                </tbody>

                {/* Everything above. Only Consumed gains -- those days
                    were taken -- and Balance and Remaining repeat the
                    Total rather than showing a dash, so the row reads as
                    a total of the table rather than of one column. */}
                <tfoot>
                  <tr className="border-t-2 border-line-strong">
                    <Td className="font-semibold text-ink">Grand Total</Td>
                    <Td className="tabular text-right font-semibold">
                      {num(sumBalances.balance, 0)}
                    </Td>
                    <Td className="tabular text-right font-semibold">
                      {num(sumBalances.consumed + Number(summary.other_leaves || 0), 0)}
                    </Td>
                    <Td
                      className={`tabular text-right font-semibold ${
                        sumBalances.remaining < 0 ? 'text-on-danger' : 'text-on-success'
                      }`}
                    >
                      {num(sumBalances.remaining, 0)}
                    </Td>
                  </tr>
                </tfoot>
              </table>
            </Card>
          </div>

          <Card>
            <CardHeader
              title="Daily Records"
              subtitle={
                filterLabel
                  ? `Showing ${visibleRecords.length} of ${records.length} days · ${filterLabel}`
                  : `${records.length} days recorded`
              }
              actions={
                /* One row, always. With flex-wrap the type filter dropped
                   onto a line of its own as soon as the subtitle grew --
                   and the subtitle grows exactly when a filter is on, so
                   the section got taller the moment it was used. */
                <div className="no-print flex flex-wrap items-center gap-2 sm:shrink-0 sm:flex-nowrap">
                  {(activeColumnFilters.length > 0 || sort.key) && (
                    <Button
                      size="sm"
                      variant="secondary"
                      title="Clear the column filters and sort"
                      onClick={() => {
                        setColumnFilters({})
                        setSort({ key: null, dir: null })
                      }}
                    >
                      Reset columns
                    </Button>
                  )}
                  {[
                    ['all', 'All'],
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
                    // Narrower than it was, so the whole row clears the
                    // subtitle. Left at the standard control height every
                    // other dropdown in the app uses -- shrinking it saves
                    // nothing, because the card's own padding sets the
                    // height of this row.
                    className="w-44 text-sm"
                    value={dayFilter.startsWith('type:') ? dayFilter : ''}
                    onChange={(e) => setDayFilter(e.target.value || 'all')}
                  >
                    <option value="">Any type…</option>
                    {/* allTypes: this filters days already recorded, and
                        a type retired since is exactly the one somebody
                        wants to look back for. */}
                    {lookups.allTypes?.map((t) => (
                      <option key={t.id} value={`type:${t.id}`}>
                        {t.name_en}
                      </option>
                    ))}
                  </Select>
                </div>
              }
            />
            {records.length === 0 ? (
              <EmptyState title="Nothing recorded for this period" />
            ) : dayFilteredRecords.length === 0 ? (
              <EmptyState title={`No ${dayFilterLabel?.toLowerCase()} days in this period`}>
                The range holds {records.length} other recorded days.
              </EmptyState>
            ) : (
              <>
              <div
                className={`employee-report-records employee-report-records-screen max-h-[70vh] overflow-auto${
                  splitForPrint ? ' employee-report-records-single' : ''
                }`}
              >
                <table className="sticky-head w-full border-collapse">
                  <thead>
                    <tr>
                      {RECORD_COLUMNS.map((c) => (
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
                    {/* Column filters can leave nothing. The headers stay
                        so the filter that did it can be undone where it
                        was set. */}
                    {visibleRecords.length === 0 && (
                      <tr>
                        <Td colSpan={RECORD_COLUMNS.length} className="py-6 text-center text-ink-3">
                          No days match the column filters.{' '}
                          <button
                            type="button"
                            className="font-medium text-brand-600 hover:underline"
                            onClick={() => setColumnFilters({})}
                          >
                            Clear them
                          </button>
                        </Td>
                      </tr>
                    )}
                    {visibleRecords.map((r) => (
                      <tr key={r.id} className="hover:bg-hover">
                        <Td className="font-medium text-ink">{dayLabel(r.work_date)}</Td>
                        <Td>
                          {r.attendance_types?.name_en}{' '}
                          <span className="arabic text-ink-4">{r.attendance_types?.name_ar}</span>
                        </Td>
                        <Td className="tabular">{minutesToHHMM(r.late_minutes)}</Td>
                        <Td className="tabular text-right">{num(r.transport)}</Td>
                        <Td className="text-center">{r.add_to_leave_balance ? '✓' : ''}</Td>
                        <Td className="tabular">{trimTime(r.clock_in) || '—'}</Td>
                        <Td className="tabular">{trimTime(r.clock_out) || '—'}</Td>
                        <Td className="tabular text-right">
                          {hoursToHHMM(workedHours(trimTime(r.clock_in), trimTime(r.clock_out)))}
                        </Td>
                        <Td className="text-ink-3">{r.note}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* The same days as a list, for phones only (index.css shows it
                  below 640px on screen and hides the nine-column table,
                  which would otherwise need scrolling sideways). One card
                  per day, everything the table row carries; the day
                  filters above still apply. Never printed. */}
              <ul className="employee-report-mobile-list no-print divide-y divide-line">
                {visibleRecords.length === 0 && (
                  <li className="px-4 py-6 text-center text-sm text-ink-3">
                    No days match the column filters.{' '}
                    <button
                      type="button"
                      className="font-medium text-brand-600 hover:underline"
                      onClick={() => setColumnFilters({})}
                    >
                      Clear them
                    </button>
                  </li>
                )}
                {visibleRecords.map((r) => {
                  const inT = trimTime(r.clock_in)
                  const outT = trimTime(r.clock_out)
                  return (
                    <li key={r.id} className="px-4 py-3 text-sm">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-medium text-ink">{dayLabel(r.work_date)}</span>
                        <span className="min-w-0 text-right text-ink-2">
                          {r.attendance_types?.name_en}{' '}
                          <span className="arabic text-ink-4">{r.attendance_types?.name_ar}</span>
                        </span>
                      </div>
                      <dl className="mt-1.5 grid grid-cols-3 gap-x-3 gap-y-1 text-xs">
                        <MobileFigure label="In" value={inT || '—'} />
                        <MobileFigure label="Out" value={outT || '—'} />
                        <MobileFigure label="Worked" value={hoursToHHMM(workedHours(inT, outT))} />
                        <MobileFigure label="Late" value={minutesToHHMM(r.late_minutes)} />
                        <MobileFigure label="Transport" value={num(r.transport)} />
                        <MobileFigure label="Added" value={r.add_to_leave_balance ? '✓' : '—'} />
                      </dl>
                      {r.note?.trim() && <p className="mt-1.5 text-xs text-ink-3">{r.note}</p>}
                    </li>
                  )
                })}
              </ul>

              {/* The same days again, in two columns, for paper only.

                  A month of records in one column runs past the foot of
                  the first page and leaves a handful of rows stranded on
                  a second. Printing only the date and what was recorded
                  leaves most of the width unused, so the overflow goes
                  beside the first column rather than onto another sheet.

                  A second table rather than CSS columns: a table split
                  across multi-column boxes is not something browsers
                  lay out reliably, and a second thead means the right
                  column is labelled too.

                  Hidden from screen readers -- it is the same days the
                  table above already carries, and nobody should hear
                  them twice. */}
              {splitForPrint && (
                <div
                  className="employee-report-records employee-report-records-split hidden"
                  aria-hidden="true"
                >
                  {[printHalves.left, printHalves.right].map((chunk, i) => (
                    <table key={i} className="w-full border-collapse">
                      <thead>
                        <tr>
                          <Th>Date</Th>
                          <Th>Attendance</Th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {chunk.map((r) => (
                          <tr key={r.id}>
                            <Td className="font-medium text-ink">{dayLabel(r.work_date)}</Td>
                            <Td>
                              {r.attendance_types?.name_en}{' '}
                              <span className="arabic text-ink-4">
                                {r.attendance_types?.name_ar}
                              </span>
                            </Td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ))}
                </div>
              )}
              </>
            )}
          </Card>
        </>
      )}
    </div>
  )
}

/* One figure in a day's card on the phone list: small label, value under. */
function MobileFigure({ label, value }) {
  return (
    <div className="min-w-0">
      <dt className="text-ink-4">{label}</dt>
      <dd className="tabular font-medium text-ink-2">{value || '—'}</dd>
    </div>
  )
}
