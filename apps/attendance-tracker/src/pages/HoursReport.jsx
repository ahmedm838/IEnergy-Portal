import { useCallback, useEffect, useMemo, useState } from 'react'
import PeriodLabel from '../components/PeriodLabel'
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
  Stat,
  Td,
  Th,
} from '../components/ui'

/**
 * Hours owed against hours worked, for employees who are not paid overtime.
 *
 * With the Overtime switch off an employee earns nothing extra for the hours
 * on an overtime attendance type, so the only question that matters is
 * whether they worked the hours they owe. The monthly report answers a
 * different question -- what to pay -- and buries this one.
 */
export default function HoursReport() {
  const lookups = useLookups()

  const [range, setRange] = useState(() => payrollPeriod())
  const [siteId, setSiteId] = useState('')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    prefetchExcel()
  }, [])

  const load = useCallback(async () => {
    if (range.from > range.to) return
    setLoading(true)
    setError(null)
    try {
      const data = await run(
        supabase.rpc('report_hours', {
          p_from: range.from,
          p_to: range.to,
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
  }, [range.from, range.to, siteId])

  useEffect(() => {
    load()
  }, [load])

  function shiftPeriod(delta) {
    setRange(shiftPayrollPeriod(range.to, delta))
  }

  const totals = useMemo(() => {
    const sum = (k) => rows.reduce((a, r) => a + Number(r[k] || 0), 0)
    return {
      employees: rows.length,
      required: sum('required_hours'),
      worked: sum('worked_hours'),
      variance: sum('hours_variance'),
      missingTimes: rows.reduce(
        (a, r) => a + (Number(r.working_days || 0) - Number(r.days_with_times || 0)),
        0,
      ),
    }
  }, [rows])

  const columns = useMemo(
    () => [
      { header: 'Code', key: 'code', numFmt: '0' },
      { header: 'Name', key: 'name' },
      { header: 'S.I. No.', key: 'si_no' },
      { header: 'Title', key: 'title' },
      { header: 'Site', key: 'site' },
      { header: 'Department', key: 'department' },
      { header: 'Days recorded', key: 'days_recorded', numFmt: '0' },
      { header: 'Working days', key: 'working_days', numFmt: '0' },
      { header: 'Days with clock times', key: 'days_with_times', numFmt: '0' },
      { header: 'Required hours', key: 'required_hours', numFmt: '#,##0.00' },
      { header: 'Worked hours', key: 'worked_hours', numFmt: '#,##0.00' },
      { header: 'Excess / shortage', key: 'hours_variance', numFmt: '#,##0.00' },
      { header: 'Late hours', key: 'late_hours', numFmt: '#,##0.00' },
      { header: 'Absence days', key: 'absence_days', numFmt: '0' },
    ],
    [],
  )

  async function handleExport() {
    const site = lookups.sites?.find((s) => String(s.id) === siteId)
    setExporting(true)
    setError(null)
    try {
      await exportSheet(
        {
          title: 'Hours report - employees without overtime',
          subtitle: `${range.from} to ${range.to}`,
          sheetName: 'Hours',
          meta: [
            ['Period', payrollPeriodLabel(range.to)],
            ['Site', site ? site.name : 'All sites'],
            ['Hours per working day', lookups.requiredHoursPerDay],
            ['Employees', rows.length],
            ['Generated', new Date().toLocaleString()],
          ],
          columns,
          rows: rows.map((r) => ({
            ...r,
            code: Number(r.code),
            days_recorded: Number(r.days_recorded),
            working_days: Number(r.working_days),
            days_with_times: Number(r.days_with_times),
            required_hours: Number(r.required_hours),
            worked_hours: Number(r.worked_hours),
            hours_variance: Number(r.hours_variance),
            late_hours: Number(r.late_hours),
            absence_days: Number(r.absence_days),
          })),
        },
        `hours-report-${range.from}_${range.to}.xlsx`,
      )
    } catch (err) {
      setError(`Could not build the Excel file: ${err.message}`)
    } finally {
      setExporting(false)
    }
  }

  if (lookups.loading) return <Spinner />

  return (
    <div className="grid grid-cols-1 gap-5">
      <div className="no-print">
        <h1 className="text-xl font-semibold text-ink">Hours report</h1>
        <p className="mt-0.5 text-sm text-ink-3">
          Hours owed against hours worked, for employees whose Overtime switch is off.
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
              &lsaquo;
            </Button>
            <Button variant="secondary" onClick={() => setRange(payrollPeriod())}>
              This period
            </Button>
            <Button variant="secondary" onClick={() => shiftPeriod(1)}>
              &rsaquo;
            </Button>
          </div>
        </div>
      </Card>

      {error && <Alert tone="error">{error}</Alert>}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <Stat dense label="Employees" value={num(totals.employees, 0)} sub="overtime switch off" />
        <Stat dense label="Required hours" value={num(totals.required)} />
        <Stat dense label="Worked hours" value={num(totals.worked)} />
        <Stat
          dense
          label="Excess / shortage"
          value={`${totals.variance >= 0 ? '+' : ''}${num(totals.variance)} h`}
          tone={totals.variance >= 0 ? 'good' : 'bad'}
        />
        <Stat
          dense
          label="Days missing times"
          value={num(totals.missingTimes, 0)}
          sub="counted as 0 worked"
          tone={totals.missingTimes > 0 ? 'bad' : 'neutral'}
        />
      </div>

      <Card>
        <CardHeader
          title="Hours by employee"
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
          <EmptyState title="Nobody to report on in this period">
            This lists only employees whose Overtime switch is off and who have attendance recorded
            in the selected dates. Check the switch under Employees.
          </EmptyState>
        ) : (
          <div className="max-h-[70vh] overflow-auto">
            <table className="sticky-head frozen-id-cols w-full border-collapse">
              <thead>
                <tr>
                  {columns.map((c) => (
                    <Th key={c.key} className={c.numFmt ? 'text-right' : undefined}>
                      {c.header}
                    </Th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => {
                  const missing = Number(r.working_days) - Number(r.days_with_times)
                  return (
                    <tr key={r.employee_id} className="hover:bg-hover">
                      <Td className="tabular text-right">{r.code}</Td>
                      <Td className="font-medium text-ink">{r.name}</Td>
                      <Td>{r.si_no}</Td>
                      <Td>{r.title}</Td>
                      <Td>{r.site}</Td>
                      <Td>{r.department}</Td>
                      <Td className="tabular text-right">{r.days_recorded}</Td>
                      <Td className="tabular text-right">{r.working_days}</Td>
                      <Td
                        className={`tabular text-right ${missing > 0 ? 'text-on-warning' : ''}`}
                        title={
                          missing > 0
                            ? `${missing} working day(s) have no clock times, so those hours count as zero`
                            : undefined
                        }
                      >
                        {r.days_with_times}
                      </Td>
                      <Td className="tabular text-right">{num(r.required_hours)}</Td>
                      <Td className="tabular text-right">{num(r.worked_hours)}</Td>
                      <Td
                        className={`tabular text-right font-semibold ${
                          Number(r.hours_variance) < 0 ? 'text-on-danger' : 'text-on-success'
                        }`}
                      >
                        {num(r.hours_variance)}
                      </Td>
                      <Td className="tabular text-right">{num(r.late_hours)}</Td>
                      <Td
                        className={`tabular text-right ${
                          Number(r.absence_days) > 0 ? 'text-on-danger' : ''
                        }`}
                      >
                        {r.absence_days}
                      </Td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="no-print text-xs text-ink-4">
        Required hours = working days &times; {lookups.requiredHoursPerDay}. Worked hours come from
        clock in and clock out, so a working day with no times entered counts as zero worked. The
        &ldquo;days with clock times&rdquo; column is there to tell a genuine shortage from a
        missing entry.
      </p>
    </div>
  )
}
