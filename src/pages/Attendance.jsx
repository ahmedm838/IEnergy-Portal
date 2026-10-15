import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import PeriodLabel from '../components/PeriodLabel'
import { supabase, run } from '../lib/supabase'
import { useLookups, useEmployees } from '../lib/useLookups'
import { summarise } from '../lib/calc'
import {
  dateRange,
  dayLabel,
  hhmmToMinutes,
  hoursToHHMM,
  isWeekend,
  minutesToHHMM,
  payrollPeriod,
  payrollPeriodLabel,
  shiftPayrollPeriod,
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

const EMPTY_ROW = {
  attendance_type_id: null,
  late_minutes: 0,
  transport: 0,
  add_to_leave_balance: false,
  clock_in: '',
  clock_out: '',
  note: '',
}

export default function Attendance() {
  const lookups = useLookups()
  const { employees, loading: employeesLoading } = useEmployees()

  const [employeeId, setEmployeeId] = useState('')
  const [range, setRange] = useState(() => payrollPeriod())
  const [rows, setRows] = useState({})
  const [dirty, setDirty] = useState(() => new Set())
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)

  const days = useMemo(
    () => (range.from && range.to && range.from <= range.to ? dateRange(range.from, range.to) : []),
    [range],
  )

  const selectedEmployee = employees.find((e) => e.id === employeeId) || null

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

  const loadRecords = useCallback(async () => {
    if (!employeeId || days.length === 0) {
      setRows({})
      setDirty(new Set())
      return
    }
    setLoading(true)
    setError(null)
    try {
      const data = await run(
        supabase
          .from('attendance_records')
          .select('*')
          .eq('employee_id', employeeId)
          .gte('work_date', range.from)
          .lte('work_date', range.to),
      )
      const next = {}
      for (const record of data) {
        next[record.work_date] = {
          attendance_type_id: record.attendance_type_id,
          late_minutes: record.late_minutes ?? 0,
          transport: record.transport ?? 0,
          add_to_leave_balance: record.add_to_leave_balance ?? false,
          clock_in: trimTime(record.clock_in),
          clock_out: trimTime(record.clock_out),
          note: record.note ?? '',
        }
      }
      setRows(next)
      setDirty(new Set())
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

  const update = useCallback((iso, patch) => {
    setRows((current) => ({
      ...current,
      [iso]: { ...(current[iso] ?? EMPTY_ROW), ...patch },
    }))
    setDirty((current) => new Set(current).add(iso))
    setNotice(null)
  }, [])

  /** Apply a type to every day matching `predicate` that has no type yet. */
  function bulkFill(typeCode, predicate) {
    const type = lookups.types?.find((t) => t.code === typeCode)
    if (!type) {
      // Say so rather than appearing to work. These buttons match on the
      // attendance type's code, so if one is renamed in the database the
      // button would otherwise do nothing at all, with no clue why.
      setError(
        `No attendance type with code "${typeCode}" exists, so this bulk fill did nothing. ` +
          'Check Settings — the code is an internal identifier and must not be renamed.',
      )
      return
    }
    setRows((current) => {
      const next = { ...current }
      const touched = new Set(dirty)
      for (const iso of days) {
        if (!predicate(iso)) continue
        if (next[iso]?.attendance_type_id) continue
        next[iso] = { ...EMPTY_ROW, ...next[iso], attendance_type_id: type.id }
        touched.add(iso)
      }
      setDirty(touched)
      return next
    })
    setNotice(null)
  }

  function clearAll() {
    if (!window.confirm('Clear every unsaved entry in this view? Saved rows stay in the database.')) {
      return
    }
    loadRecords()
  }

  async function handleSave() {
    if (dirty.size === 0) return
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const payload = [...dirty]
        .map((iso) => {
          const row = rows[iso]
          if (!row?.attendance_type_id) return null
          return {
            employee_id: employeeId,
            work_date: iso,
            attendance_type_id: row.attendance_type_id,
            late_minutes: row.late_minutes || 0,
            transport: row.transport || 0,
            add_to_leave_balance: !!row.add_to_leave_balance,
            clock_in: row.clock_in || null,
            clock_out: row.clock_out || null,
            note: row.note || null,
          }
        })
        .filter(Boolean)

      if (payload.length === 0) {
        setError('Nothing to save — every changed day still needs an attendance type.')
        setSaving(false)
        return
      }

      const saved = await run(supabase.rpc('save_attendance_rows', { p_rows: payload }))
      setNotice(`Saved ${saved} day${saved === 1 ? '' : 's'}.`)
      await loadRecords()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  function shiftPeriod(delta) {
    setRange(shiftPayrollPeriod(range.to, delta))
  }

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
              subtitle={`${days.length} days · ${dirty.size} unsaved change${
                dirty.size === 1 ? '' : 's'
              }`}
              actions={
                <>
                  <Button variant="secondary" size="sm" onClick={() => bulkFill('weekly_rest', isWeekend)}>
                    Fill Fri/Sat rest
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => bulkFill('paid_day', (iso) => !isWeekend(iso))}
                  >
                    Fill workdays
                  </Button>
                  <Button variant="ghost" size="sm" onClick={clearAll} disabled={dirty.size === 0}>
                    Discard changes
                  </Button>
                  <Button size="sm" onClick={handleSave} disabled={saving || dirty.size === 0}>
                    {saving ? 'Saving…' : `Save ${dirty.size || ''}`}
                  </Button>
                </>
              }
            />

            {loading ? (
              <Spinner />
            ) : (
              <div className="max-h-[70vh] overflow-auto">
                <table className="sticky-head w-full border-collapse">
                  <thead>
                    <tr>
                      <Th className="min-w-[140px]">Date</Th>
                      <Th className="min-w-[220px]">Attendance</Th>
                      <Th>Late (hh:mm)</Th>
                      <Th>Transport</Th>
                      <Th className="text-center">Add to balance</Th>
                      <Th>Clock in</Th>
                      <Th>Clock out</Th>
                      <Th>Overtime</Th>
                      <Th className="min-w-[160px]">Note</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {days.map((iso) => (
                      <DayRow
                        key={iso}
                        iso={iso}
                        row={getRow(iso)}
                        types={lookups.types ?? []}
                        typeById={lookups.typeById}
                        isDirty={dirty.has(iso)}
                        onChange={(patch) => update(iso, patch)}
                      />
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

function DayRow({ iso, row, types, typeById, isDirty, onChange }) {
  const type = row.attendance_type_id ? typeById.get(row.attendance_type_id) : null
  const weekend = isWeekend(iso)
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
        isDirty ? 'bg-tint-warning/60' : weekend ? 'bg-subtle/70' : 'hover:bg-hover',
      )}
    >
      <Td className="font-medium text-ink">
        <div className="flex items-center gap-2">
          {dayLabel(iso)}
          {isDirty && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" title="Unsaved" />}
        </div>
      </Td>

      <Td>
        <Select
          value={row.attendance_type_id ?? ''}
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
          value={row.transport ?? 0}
          onChange={(e) => onChange({ transport: Number(e.target.value) || 0 })}
          className="w-24 py-1.5 text-sm"
        />
      </Td>

      <Td className="text-center">
        <Checkbox
          checked={!!row.add_to_leave_balance}
          onChange={(e) => onChange({ add_to_leave_balance: e.target.checked })}
        />
      </Td>

      <Td>
        <Input
          type="time"
          value={row.clock_in ?? ''}
          onChange={(e) => onChange({ clock_in: e.target.value })}
          className="w-28 py-1.5 text-sm"
        />
      </Td>

      <Td>
        <Input
          type="time"
          value={row.clock_out ?? ''}
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
          onChange={(e) => onChange({ note: e.target.value })}
          className="py-1.5 text-sm"
          placeholder="—"
        />
      </Td>
    </tr>
  )
}
