import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, run } from '../lib/supabase'
import { useLookups } from '../lib/useLookups'
import { exportSheet, prefetchExcel } from '../lib/exportXlsx'
import { monthBounds, num } from '../lib/format'
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

/** Report 2 — the "monthly report" sheet (payroll input). */
export default function MonthlyReport() {
  const lookups = useLookups()

  const [range, setRange] = useState(() => monthBounds())
  const [mealRate, setMealRate] = useState('')
  const [siteId, setSiteId] = useState('')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [exporting, setExporting] = useState(false)

  // Warm the Excel library so the click-to-download gap stays inside the
  // browser's user-activation window.
  useEffect(() => {
    prefetchExcel()
  }, [])

  // Seed the meal rate from settings once lookups arrive, but let the user
  // override it per run — the workbook treats it as a cell on the report.
  useEffect(() => {
    if (mealRate === '' && !lookups.loading) setMealRate(String(lookups.mealRate ?? 0))
  }, [lookups.loading, lookups.mealRate, mealRate])

  const load = useCallback(async () => {
    if (lookups.loading || range.from > range.to) return
    setLoading(true)
    setError(null)
    try {
      const data = await run(
        supabase.rpc('report_monthly', {
          p_from: range.from,
          p_to: range.to,
          p_meal_rate: mealRate === '' ? null : Number(mealRate),
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
      overtime: sum('overtime'),
      total_deductions: sum('total_deductions'),
      salary_advance: sum('salary_advance'),
      absence_penalties: sum('absence_penalties'),
    }
  }, [rows])

  const columns = useMemo(
    () => [
      { header: 'Name', key: 'name' },
      { header: 'Code', key: 'code', numFmt: '0' },
      { header: 'S.I. No.', key: 'si_no' },
      { header: 'Title', key: 'title' },
      { header: 'Site', key: 'site' },
      { header: 'Department', key: 'department' },
      { header: 'Meals', key: 'meals', numFmt: '#,##0.00' },
      { header: `Transport (${currency})`, key: 'transport', numFmt: '#,##0.00' },
      { header: `Total Allowances (${currency})`, key: 'total_allowances', numFmt: '#,##0.00' },
      { header: `Incentive (${currency})`, key: 'incentive', numFmt: '#,##0.00' },
      { header: `Bonus (${currency})`, key: 'bonus', numFmt: '#,##0.00' },
      { header: `Adjustments (${currency})`, key: 'adjustments', numFmt: '#,##0.00' },
      { header: 'Overtime (hrs)', key: 'overtime', numFmt: '#,##0.00' },
      { header: 'Late (hrs)', key: 'late_hours', numFmt: '#,##0.00' },
      { header: 'Deducted Hours', key: 'deducted_hours', numFmt: '#,##0.00' },
      { header: 'Deducted Leaves', key: 'deducted_leaves', numFmt: '#,##0.00' },
      { header: 'Absence Penalties (days)', key: 'absence_penalties', numFmt: '#,##0.00' },
      { header: 'Total Deductions (hrs)', key: 'total_deductions', numFmt: '#,##0.00' },
      { header: `Salary Advance (${currency})`, key: 'salary_advance', numFmt: '#,##0.00' },
    ],
    [currency],
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
          ['Employees', rows.length],
          ['Generated', new Date().toLocaleString()],
        ],
        columns,
        rows: rows.map((r) => ({
          ...r,
          code: Number(r.code),
          meals: Number(r.meals),
          transport: Number(r.transport),
          total_allowances: Number(r.total_allowances),
          incentive: Number(r.incentive),
          bonus: Number(r.bonus),
          adjustments: Number(r.adjustments),
          overtime: Number(r.overtime),
          late_hours: Number(r.late_hours),
          deducted_hours: Number(r.deducted_hours),
          deducted_leaves: Number(r.deducted_leaves),
          absence_penalties: Number(r.absence_penalties),
          total_deductions: Number(r.total_deductions),
          salary_advance: Number(r.salary_advance),
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

  function shiftMonth(delta) {
    const [y, m] = range.from.split('-').map(Number)
    setRange(monthBounds(new Date(y, m - 1 + delta, 1)))
  }

  if (lookups.loading) return <Spinner />

  return (
    <div className="grid grid-cols-1 gap-5">
      <div className="no-print">
        <h1 className="text-xl font-semibold text-ink">Monthly report</h1>
        <p className="mt-0.5 text-sm text-ink-3">
          Payroll input for every employee whose status is marked payable.
        </p>
      </div>

      <Card className="no-print">
        <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-5">
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
          <Field label={`Meal allowance (${currency} per meal)`}>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={mealRate}
              onChange={(e) => setMealRate(e.target.value)}
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
            <Button variant="secondary" onClick={() => shiftMonth(-1)}>
              ‹
            </Button>
            <Button variant="secondary" onClick={() => setRange(monthBounds())}>
              This month
            </Button>
            <Button variant="secondary" onClick={() => shiftMonth(1)}>
              ›
            </Button>
          </div>
        </div>
      </Card>

      {error && <Alert tone="error">{error}</Alert>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Employees" value={num(totals.employees, 0)} />
        <Stat label="Total allowances" value={`${num(totals.total_allowances)} ${currency}`} />
        <Stat label="Total overtime" value={`${num(totals.overtime)} h`} />
        <Stat
          label="Total deductions"
          value={`${num(totals.total_deductions)} h`}
          tone={totals.total_deductions > 0 ? 'bad' : 'neutral'}
        />
        <Stat label="Salary advances" value={`${num(totals.salary_advance)} ${currency}`} />
      </div>

      <Card>
        <CardHeader
          title="Payroll input"
          subtitle={`${range.from} to ${range.to}`}
          actions={
            <>
              <Button variant="secondary" size="sm" onClick={() => window.print()}>
                Print
              </Button>
              <Button size="sm" onClick={handleExport} disabled={rows.length === 0 || exporting}>
                {exporting ? 'Preparing…' : 'Export Excel'}
              </Button>
            </>
          }
        />
        {loading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <EmptyState title="No payable employees in this period">
            Check that employees have a status marked as payable under Settings, and that they are
            marked active.
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
                {rows.map((r) => (
                  <tr key={r.employee_id} className="hover:bg-hover">
                    <Td className="font-medium text-ink">{r.name}</Td>
                    <Td className="tabular text-right">{r.code}</Td>
                    <Td>{r.si_no}</Td>
                    <Td>{r.title}</Td>
                    <Td>{r.site}</Td>
                    <Td>{r.department}</Td>
                    <Td className="tabular text-right">{num(r.meals)}</Td>
                    <Td className="tabular text-right">{num(r.transport)}</Td>
                    <Td className="tabular text-right font-semibold">{num(r.total_allowances)}</Td>
                    <Td className="tabular text-right">{num(r.incentive)}</Td>
                    <Td className="tabular text-right">{num(r.bonus)}</Td>
                    <Td className="tabular text-right">{num(r.adjustments)}</Td>
                    <Td className="tabular text-right">{num(r.overtime)}</Td>
                    <Td
                      className="tabular text-right"
                      title={`${num(r.late_hours)} h late; the first ${lookups.lateGraceHours} h are not deducted`}
                    >
                      {num(r.late_hours)}
                    </Td>
                    <Td
                      className={`tabular text-right ${
                        Number(r.deducted_hours) < 0 ? 'text-on-success' : ''
                      }`}
                    >
                      {num(r.deducted_hours)}
                    </Td>
                    <Td className="tabular text-right">{num(r.deducted_leaves, 0)}</Td>
                    <Td
                      className={`tabular text-right ${
                        Number(r.absence_penalties) > 0 ? 'text-on-danger' : ''
                      }`}
                    >
                      {num(r.absence_penalties)}
                    </Td>
                    <Td className="tabular text-right font-semibold">{num(r.total_deductions)}</Td>
                    <Td className="tabular text-right">{num(r.salary_advance)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="no-print text-xs text-ink-4">
        Deducted Hours = (Penalties × {lookups.requiredHoursPerDay}) − (Adjusted Days ×{' '}
        {lookups.requiredHoursPerDay}) − Adjusted Hours + any late hours beyond{' '}
        {lookups.lateGraceHours} h for the period. Adjusted days and hours reduce the deduction, so
        this can be negative. Total Deductions = (Deducted Leaves + Absence Penalties) ×{' '}
        {lookups.requiredHoursPerDay} + Deducted Hours.
      </p>
    </div>
  )
}
