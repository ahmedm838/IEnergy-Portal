import { useCallback, useEffect, useMemo, useState } from 'react'
import PeriodLabel from '../components/PeriodLabel'
import { supabase, run } from '../lib/supabase'
import { useLookups, useEmployees } from '../lib/useLookups'
import { exportEmployeeReport, prefetchExcel } from '../lib/exportXlsx'
import {
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
            .select('*, attendance_types ( id, code, name_en, name_ar, overtime_hours )')
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

  const employee = employees.find((e) => e.id === employeeId) || null
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
    await exportEmployeeReport({
      employee,
      from: range.from,
      to: range.to,
      summary: [
        ['Title', employee.title ?? ''],
        ['Site', employee.sites?.name ?? ''],
        ['Department', employee.departments?.name ?? ''],
        ['Working days', summary.working_days],
        ['Required hours', Number(summary.required_hours)],
        ['Worked hours', Number(summary.worked_hours)],
        ['Excess / shortage (hours)', Number(summary.hours_variance)],
        ['Total late', minutesToHHMM(summary.late_minutes)],
        [`Total transport (${currency})`, Number(summary.transport_total)],
        ['Overtime hours', Number(summary.overtime_hours)],
        ['Meal units', Number(summary.meal_units)],
        ['Average clock in', summary.avg_clock_in ?? '—'],
        ['Average clock out', summary.avg_clock_out ?? '—'],
        ['Absence days', summary.absence_days],
        ['Absence penalty (days)', Number(summary.absence_penalty)],
        ...summary.balances.map((b) => [
          `${b.label} — balance / consumed / remaining`,
          `${num(b.balance)} / ${num(b.consumed)} / ${num(b.remaining)}`,
        ]),
      ],
      columns: exportColumns,
      rows: records.map((r) => ({
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
    })
    } catch (err) {
      setError(`Could not build the Excel file: ${err.message}`)
    } finally {
      setExporting(false)
    }
  }

  if (lookups.loading || employeesLoading) return <Spinner />

  return (
    <div className="grid grid-cols-1 gap-5">
      <div className="no-print">
        <h1 className="text-xl font-semibold text-ink">Employee report</h1>
        <p className="mt-0.5 text-sm text-ink-3">
          Day-by-day attendance with leave balances for a chosen period.
        </p>
        <PeriodLabel from={range.from} to={range.to} className="mt-2" />
      </div>

      <Card className="no-print">
        <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Employee" className="sm:col-span-2 lg:col-span-1">
            <Select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">Select an employee…</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  #{emp.code} — {emp.name}
                </option>
              ))}
            </Select>
          </Field>
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

          <div className="flex items-end gap-2">
            <Button variant="secondary" onClick={() => window.print()} disabled={!summary}>
              Print
            </Button>
            <Button onClick={handleExport} disabled={!summary || exporting}>
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
            <p className="text-sm text-ink-3">
              {employee?.title} · {employee?.sites?.name ?? '—'} ·{' '}
              {employee?.departments?.name ?? '—'}
            </p>
            <p className="mt-1 text-sm text-ink-3">
              {range.from} to {range.to}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Required hours"
              value={num(summary.required_hours)}
              sub={`${summary.working_days} working days × ${lookups.requiredHoursPerDay} h`}
            />
            <Stat label="Total working hours" value={num(summary.worked_hours)} />
            <Stat
              label="Excess / shortage"
              value={`${Number(summary.hours_variance) >= 0 ? '+' : ''}${num(
                summary.hours_variance,
              )} h`}
              tone={Number(summary.hours_variance) >= 0 ? 'good' : 'bad'}
            />
            <Stat label="Total late hours" value={minutesToHHMM(summary.late_minutes)} />
            <Stat
              label="Total transport"
              value={`${num(summary.transport_total)} ${currency}`}
            />
            <Stat label="Overtime hours" value={num(summary.overtime_hours)} />
            <Stat
              label="Average clock in"
              value={summary.avg_clock_in ?? '—'}
              sub={`Average clock out ${summary.avg_clock_out ?? '—'}`}
            />
            <Stat
              label="Absence penalty"
              value={`${num(summary.absence_penalty)} days`}
              sub={`${summary.absence_days} unauthorised absence${
                summary.absence_days === 1 ? '' : 's'
              } in range`}
              tone={Number(summary.absence_penalty) > 0 ? 'bad' : 'neutral'}
            />
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
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
                </table>
              )}
            </Card>

            <Card>
              <CardHeader
                title="Leave balances"
                subtitle={`Calendar year ${summary.leave_year.from} to ${summary.leave_year.to}`}
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
                      <Td className="tabular text-right">{num(b.balance, 1)}</Td>
                      <Td className="tabular text-right">{num(b.consumed, 1)}</Td>
                      <Td
                        className={`tabular text-right font-semibold ${
                          Number(b.remaining) < 0 ? 'text-on-danger' : 'text-on-success'
                        }`}
                      >
                        {num(b.remaining, 1)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>

          <Card>
            <CardHeader title="Daily records" subtitle={`${records.length} days recorded`} />
            {records.length === 0 ? (
              <EmptyState title="Nothing recorded for this period" />
            ) : (
              <div className="max-h-[70vh] overflow-auto">
                <table className="sticky-head w-full border-collapse">
                  <thead>
                    <tr>
                      <Th>Date</Th>
                      <Th>Attendance</Th>
                      <Th>Late</Th>
                      <Th className="text-right">Transport</Th>
                      <Th className="text-center">Added</Th>
                      <Th>Clock in</Th>
                      <Th>Clock out</Th>
                      <Th className="text-right">Worked</Th>
                      <Th>Note</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {records.map((r) => (
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
            )}
          </Card>
        </>
      )}
    </div>
  )
}
