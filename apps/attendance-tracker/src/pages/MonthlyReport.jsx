import { useCallback, useEffect, useMemo, useState } from 'react'
import PeriodLabel from '../components/PeriodLabel'
import MultiSelectFilter from '../components/MultiSelectFilter'
import { supabase, run } from '../lib/supabase'
import { useLookups } from '../lib/useLookups'
import { exportSheet, prefetchExcel } from '../lib/exportXlsx'
import { payrollPeriod, payrollPeriodLabel, shiftPayrollPeriod, num } from '../lib/format'
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
  Td,
  Th,
} from '../components/ui'

/** Report 2 — the "monthly report" sheet (payroll input). */
export default function MonthlyReport() {
  const lookups = useLookups()

  const [range, setRange] = useState(() => payrollPeriod())
  const mealRate = Number(lookups.mealRate ?? 0)
  const [siteId, setSiteId] = useState('')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [exporting, setExporting] = useState(false)
  /* The detailed view is off by default. These nine are the workings
     behind Total Allowances and Total Deductions -- useful when a
     figure is being queried, noise when it is not. */
  const [detailed, setDetailed] = useState(false)
  /* Which departments to show. Empty means all of them, which is what
     an untouched filter should do -- the alternative, an empty table
     until you tick something, makes the button compulsory. */
  const [departments, setDepartments] = useState(() => new Set())

  // Warm the Excel library so the click-to-download gap stays inside the
  // browser's user-activation window.
  useEffect(() => {
    prefetchExcel()
  }, [])

  const load = useCallback(async () => {
    if (lookups.loading || range.from > range.to) return
    setLoading(true)
    setError(null)
    try {
      const data = await run(
        supabase.rpc('report_monthly', {
          p_from: range.from,
          p_to: range.to,
          p_meal_rate: mealRate,
          p_site_id: siteId === '' ? null : Number(siteId),
        }),
      )
      setRows(data ?? [])
    } catch (err) {
      setError(err.message)
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [range.from, range.to, mealRate, siteId, lookups.loading])

  useEffect(() => {
    load()
  }, [load])

  const currency = lookups.currency

  const totals = useMemo(() => {
    const sum = (key) => rows.reduce((acc, r) => acc + Number(r[key] || 0), 0)
    return {
      employees: rows.length,
      total_allowances: sum('total_allowances'),
      incentive: sum('incentive'),
      bonus: sum('bonus'),
      adjustments: sum('adjustments'),
      overtime: sum('overtime'),
      total_deductions: sum('total_deductions'),
      salary_advance: sum('salary_advance'),
      records: sum('records'),
    }
  }, [rows])

  /* Defined once and used twice: the header reads from here, and so
     does the body. The base columns are written out as a header list
     and a separate hand-written row of cells, which only stay in step
     because somebody counts them. Nine more pairs kept that way would
     drift the first time one was added in one place and not the other,
     and a shifted column on a payroll report is a wrong number rather
     than an untidy one.

     digits is for the screen: a count of days is a whole number, hours
     and money are not. */
  const detailColumns = useMemo(
    () => [
      { header: 'Late hours', key: 'late_hours', numFmt: '#,##0.00', digits: 2 },
      // Days actually worked, which is not the Records column beside it:
      // that counts every row saved, weekends and leave included, to show
      // recording gaps. is_working_day, the same flag the Employee Report
      // filters on.
      { header: 'Attended days', key: 'attended_days', numFmt: '0', digits: 0 },
      { header: 'Meals', key: 'meals', numFmt: '#,##0.00', digits: 2 },
      { header: `Transport (${currency})`, key: 'transport', numFmt: '#,##0.00', digits: 2 },
      { header: 'Adj. days', key: 'adjusted_days', numFmt: '#,##0.00', digits: 2 },
      { header: 'Adj. hours', key: 'adjusted_hours', numFmt: '#,##0.00', digits: 2 },
      { header: 'Deducted leaves', key: 'deducted_leaves', numFmt: '#,##0.00', digits: 2 },
      { header: 'Sick leaves', key: 'sick_leaves', numFmt: '0', digits: 0 },
      { header: 'Absence days', key: 'absence_days', numFmt: '0', digits: 0 },
      { header: 'Absence penalty', key: 'absence_penalties', numFmt: '#,##0.00', digits: 2 },
    ],
    [currency],
  )

  const columns = useMemo(
    () => [
      { header: 'Name', key: 'name' },
      { header: 'Code', key: 'code', numFmt: '0' },
      { header: 'S.I. No.', key: 'si_no' },
      { header: 'Title', key: 'title' },
      { header: 'Site', key: 'site' },
      { header: 'Department', key: 'department' },
      // How many days this row was built from. A low count beside full
      // allowances is a recording gap, not a payroll figure.
      { header: 'Records', key: 'records', numFmt: '0' },
      // Meals and transport are not listed on their own. They are money,
      // and the money they make up is the next column; the per-day
      // figures are on the employee report, beside the days that earned
      // them. The meal rate from Settings still feeds that calculation.
      { header: `Total Allowances (${currency})`, key: 'total_allowances', numFmt: '#,##0.00' },
      { header: `Incentive (${currency})`, key: 'incentive', numFmt: '#,##0.00' },
      { header: `Bonus (${currency})`, key: 'bonus', numFmt: '#,##0.00' },
      { header: `Adjustments (${currency})`, key: 'adjustments', numFmt: '#,##0.00' },
      { header: 'Overtime (hrs)', key: 'overtime', numFmt: '#,##0.00' },
      // Late hours, deducted hours, deducted leaves and absence penalties
      // are no longer listed separately. They still make up Total
      // Deductions, which is the figure payroll acts on; the breakdown
      // belongs to the employee report, where the days that produced it
      // are on screen beside it.
      { header: 'Total Deductions (hrs)', key: 'total_deductions', numFmt: '#,##0.00' },
      { header: `Salary Advance (${currency})`, key: 'salary_advance', numFmt: '#,##0.00' },
      ...(detailed ? detailColumns : []),
    ],
    [currency, detailed, detailColumns],
  )

  async function handleExport() {
    const site = lookups.sites?.find((s) => String(s.id) === siteId)
    setExporting(true)
    setError(null)
    try {
    await exportSheet(
      {
        title: 'Monthly report',
        subtitle: `${range.from} to ${range.to}`,
        sheetName: 'Monthly report',
        meta: [
          ['Meal allowance rate', Number(mealRate || 0)],
          ['Site', site ? site.name : 'All sites'],
          // Say which departments the sheet covers, so a filtered export
          // cannot be mistaken for the whole payroll run.
          ['Departments', departments.size ? [...departments].map((d) => d || 'none').join(', ') : 'All'],
          ['Employees', visibleRows.length],
          ['Generated', new Date().toLocaleString()],
        ],
        columns,
        rows: visibleRows.map((r) => ({
          ...r,
          code: Number(r.code),
          records: Number(r.records),
          total_allowances: Number(r.total_allowances),
          incentive: Number(r.incentive),
          bonus: Number(r.bonus),
          adjustments: Number(r.adjustments),
          overtime: Number(r.overtime),
          total_deductions: Number(r.total_deductions),
          salary_advance: Number(r.salary_advance),
          // PostgREST hands numeric back as a string. The sheet needs
          // numbers or every one of these lands as text Excel will not
          // add up.
          ...Object.fromEntries(detailColumns.map((c) => [c.key, Number(r[c.key] ?? 0)])),
        })),
      },
      `monthly-report-${range.from}_${range.to}.xlsx`,
    )
    } catch (err) {
      setError(`Could not build the Excel file: ${err.message}`)
    } finally {
      setExporting(false)
    }
  }

  /* Built from the rows on screen rather than the departments table: a
     department with nobody in it this period is not worth offering, and
     the count beside each name says how many rows it would leave. */
  const departmentOptions = useMemo(() => {
    const counts = new Map()
    for (const r of rows) {
      const name = r.department ?? ''
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
    return [...counts.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, count]) => ({
        value: name,
        // Somebody with no department still has to be selectable, or
        // they could never be filtered to.
        label: name || '— no department —',
        count,
      }))
  }, [rows])

  /* One list, used by the table, the Excel export and the empty state.
     If the export read `rows` instead, the sheet would quietly hold
     people the screen was filtering out -- and a payroll sheet that
     does not match what was checked is worse than no filter at all. */
  const visibleRows = useMemo(() => {
    if (departments.size === 0) return rows
    return rows.filter((r) => departments.has(r.department ?? ''))
  }, [rows, departments])

  /* A department can vanish between periods. Ticked names that are no
     longer on offer would filter everything away with nothing on screen
     to explain it, so they are dropped when the rows change. */
  useEffect(() => {
    if (departments.size === 0) return
    const available = new Set(departmentOptions.map((o) => o.value))
    const kept = [...departments].filter((d) => available.has(d))
    if (kept.length !== departments.size) setDepartments(new Set(kept))
  }, [departmentOptions, departments])

  function shiftPeriod(delta) {
    setRange(shiftPayrollPeriod(range.to, delta))
  }

  if (lookups.loading) return <Spinner />

  return (
    <div className="grid grid-cols-1 gap-5">
      <div className="no-print">
        <h1 className="text-xl font-semibold text-ink">Monthly report</h1>
        <p className="mt-0.5 text-sm text-ink-3">
          Payroll input for every employee whose status is marked payable.
        </p>
        <PeriodLabel from={range.from} to={range.to} className="mt-2" />
      </div>

      <Card className="no-print">
        <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
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
          <Field label="Site">
            <Select value={siteId} onChange={(e) => setSiteId(e.target.value)}>
              <option value="">All sites</option>
              {lookups.sites?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex items-end gap-2">
            <Button variant="secondary" onClick={() => shiftPeriod(-1)}>
              ‹
            </Button>
            <Button variant="secondary" onClick={() => setRange(payrollPeriod())}>
              This period
            </Button>
            <Button variant="secondary" onClick={() => shiftPeriod(1)}>
              ›
            </Button>
          </div>
        </div>
      </Card>

      {error && <Alert tone="error">{error}</Alert>}

      <section aria-label="Monthly report totals" aria-busy={loading}
        className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        {[
          ['employees', 'Employees', `${num(totals.records, 0)} records in range`],
          ['total_allowances', 'Total allowances', currency],
          ['incentive', 'Total incentive', currency],
          ['bonus', 'Total bonus', currency],
          ['adjustments', 'Total adjustments', currency],
          ['overtime', 'Total overtime', 'hours'],
          ['total_deductions', 'Total deductions', 'hours'],
          ['salary_advance', 'Salary advances', currency],
        ].map(([key, label, unit]) => (
          <div key={key} className="min-w-0 rounded-lg border border-line bg-panel px-2 py-2 shadow-sm">
            <p className="text-[10px] font-medium leading-tight text-ink-3">{label}</p>
            <p className={`tabular mt-1 break-words text-sm font-semibold leading-snug ${
              key === 'total_deductions' && totals[key] > 0 ? 'text-on-danger' : 'text-ink'
            }`}>
              {loading || error ? '—' : num(totals[key], key === 'employees' ? 0 : 2)}
            </p>
            <p className="mt-0.5 text-[10px] leading-tight text-ink-4">
              {key === 'employees' && (loading || error) ? 'records in range' : unit}
            </p>
          </div>
        ))}
      </section>

      <Card>
        <CardHeader
          title="Payroll input"
          subtitle={`${range.from} to ${range.to}`}
          actions={
            <>
              <MultiSelectFilter
                label="Department"
                options={departmentOptions}
                selected={departments}
                onChange={setDepartments}
              />
              <Button
                variant={detailed ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => setDetailed((on) => !on)}
                title="Late hours, meals, transport, adjustments, leaves and absences"
              >
                {detailed ? 'Hide detail' : 'Detailed view'}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => window.print()}>
                Print
              </Button>
              <Button size="sm" onClick={handleExport} disabled={visibleRows.length === 0 || exporting}>
                {exporting ? 'Preparing…' : 'Export Excel'}
              </Button>
            </>
          }
        />
        {loading ? (
          <Spinner />
        ) : visibleRows.length === 0 ? (
          <EmptyState title="Nobody has activity in this period">
            Only employees with attendance or adjustments in the selected dates appear here. Check
            the date range, and that attendance has been recorded on the Attendance page.
          </EmptyState>
        ) : (
          <div className="max-h-[70vh] overflow-auto">
            <table className="sticky-head w-full border-collapse">
              <thead>
                <tr>
                  {columns.map((c) => (
                    <Th
                      key={c.key}
                      className={c.numFmt || c.key === 'code' ? 'text-right' : undefined}
                    >
                      {c.header}
                    </Th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {visibleRows.map((r) => (
                  <tr key={r.employee_id} className="hover:bg-hover">
                    <Td className="font-medium text-ink">{r.name}</Td>
                    <Td className="tabular text-right">{r.code}</Td>
                    <Td>{r.si_no}</Td>
                    <Td>{r.title}</Td>
                    <Td>{r.site}</Td>
                    <Td>{r.department}</Td>
                    <Td className="tabular text-right">{num(r.records, 0)}</Td>
                    <Td className="tabular text-right font-semibold">{num(r.total_allowances)}</Td>
                    <Td className="tabular text-right">{num(r.incentive)}</Td>
                    <Td className="tabular text-right">{num(r.bonus)}</Td>
                    <Td className="tabular text-right">{num(r.adjustments)}</Td>
                    <Td className="tabular text-right">{num(r.overtime)}</Td>
                    <Td
                      className={`tabular text-right font-semibold ${
                        Number(r.total_deductions) > 0 ? 'text-on-danger' : ''
                      }`}
                      title={`${num(r.deducted_leaves, 0)} deducted leave(s) + ${num(
                        r.absence_penalties,
                      )} absence penalty day(s), at ${lookups.requiredHoursPerDay} h, plus ${num(
                        r.deducted_hours,
                      )} h deducted — including late beyond ${lookups.lateGraceHours} h (${num(
                        r.late_hours,
                      )} h late in total)`}
                    >
                      {num(r.total_deductions)}
                    </Td>
                    <Td className="tabular text-right">{num(r.salary_advance)}</Td>
                    {detailed &&
                      detailColumns.map((c) => (
                        <Td key={c.key} className="tabular text-right">
                          {num(r[c.key], c.digits)}
                        </Td>
                      ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="no-print text-xs text-ink-4">
        Records is the number of attendance days recorded for that employee in the period; every
        other figure on the row is built from them, so a low count beside full allowances means
        days are missing rather than money is owed. Total Deductions = (Deducted Leaves + Absence
        Penalties) × {lookups.requiredHoursPerDay} + Deducted Hours, where Deducted Hours =
        (Penalties × {lookups.requiredHoursPerDay}) − (Adjusted Days ×{' '}
        {lookups.requiredHoursPerDay}) − Adjusted Hours − any late beyond {lookups.lateGraceHours} h
        for the period; hover the figure for that breakdown, or open the employee report for the
        days behind it.
      </p>
    </div>
  )
}
