import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import EmployeeSearch from '../components/EmployeeSearch'
import PeriodLabel from '../components/PeriodLabel'
import { supabase, run } from '../lib/supabase'
import { useLookups, useEmployees } from '../lib/useLookups'
import { useLocks, lockRangeLabel } from '../lib/useLocks'
import { recordBlockReason } from '../lib/recordable'
import { summarise } from '../lib/calc'
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
  transport: '',
  add_to_leave_balance: false,
  clock_in: '',
  clock_out: '',
  note: '',
}

export default function Attendance() {
  const lookups = useLookups()
  const { employees, loading: employeesLoading } = useEmployees()
  const locks = useLocks()

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
          transport: Number(record.transport) || '',
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

  const update = useCallback(
    (iso, patch) => {
      // Locked days and non-active employees render disabled, so this is
      // belt and braces -- but it keeps them out of `dirty`, which is
      // what the save sends.
      if (readOnlyEmployee || locks.isLocked(iso)) return
      setRows((current) => ({
        ...current,
        [iso]: { ...(current[iso] ?? EMPTY_ROW), ...patch },
      }))
      setDirty((current) => new Set(current).add(iso))
      setNotice(null)
    },
    [locks.isLocked, readOnlyEmployee],
  )

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
        if (locks.isLocked(iso)) continue
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
    if (dirty.size === 0 || readOnlyEmployee) return
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const payload = [...dirty]
        .map((iso) => {
          const row = rows[iso]
          if (!row?.attendance_type_id) return null
          // One locked day would abort the whole save in the database, so
          // a day that was locked while this page was open is dropped
          // rather than taking the other days down with it.
          if (locks.isLocked(iso)) return null
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
              subtitle={`${days.length} days · ${dirty.size} unsaved change${
                dirty.size === 1 ? '' : 's'
              }`}
              actions={
                <>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={readOnlyEmployee}
                    onClick={() => bulkFill('weekly_rest', restDay)}
                  >
                    {weekend === 'fri' ? 'Fill Friday Rest' : 'Fill Fri/Sat Rest'}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={readOnlyEmployee}
                    onClick={() => bulkFill('paid_day', (iso) => !restDay(iso))}
                  >
                    Fill workdays
                  </Button>
                  <Button variant="ghost" size="sm" onClick={clearAll} disabled={dirty.size === 0}>
                    Discard changes
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSave}
                    disabled={saving || dirty.size === 0 || readOnlyEmployee}
                  >
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
                        lock={locks.lockFor(iso)}
                        isRest={restDay(iso)}
                        readOnly={readOnlyEmployee}
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

function DayRow({ iso, row, types, typeById, isDirty, lock, readOnly, isRest, onChange }) {
  const type = row.attendance_type_id ? typeById.get(row.attendance_type_id) : null
  // Two different reasons a row cannot be edited: the period is locked,
  // or the employee is not one that may be recorded. Both disable the
  // inputs; only the first earns the padlock, since the second is
  // explained once above the grid rather than on every row.
  const locked = !!lock || readOnly
  const lockTitle = lock
    ? `${lockRangeLabel(lock)} is locked${lock.note ? ` — ${lock.note}` : ''}`
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
          disabled={locked}
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
          disabled={locked}
          onChange={(e) => onChange({ transport: e.target.value })}
          className="w-24 py-1.5 text-sm"
        />
      </Td>

      <Td className="text-center">
        <Checkbox
          checked={!!row.add_to_leave_balance}
          disabled={locked}
          onChange={(e) => onChange({ add_to_leave_balance: e.target.checked })}
        />
      </Td>

      <Td>
        <Input
          type="time"
          value={row.clock_in ?? ''}
          disabled={locked}
          onChange={(e) => onChange({ clock_in: e.target.value })}
          className="w-28 py-1.5 text-sm"
        />
      </Td>

      <Td>
        <Input
          type="time"
          value={row.clock_out ?? ''}
          disabled={locked}
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
