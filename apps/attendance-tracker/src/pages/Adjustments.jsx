import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import PeriodLabel from '../components/PeriodLabel'
import EmployeeSearch from '../components/EmployeeSearch'
import { supabase, run } from '../lib/supabase'
import { useLookups, useEmployees } from '../lib/useLookups'
import { useLocks, lockRangeLabel } from '../lib/useLocks'
import { recordBlockReason } from '../lib/recordable'
import { hhmmToMinutes, minutesToHHMM, payrollPeriod, shiftPayrollPeriod, num, toISODate } from '../lib/format'
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

/** The workbook's "Others" sheet: per-employee, per-date money and day adjustments. */
export default function Adjustments() {
  const lookups = useLookups()
  const { employees } = useEmployees()
  const locks = useLocks()

  const [range, setRange] = useState(() => payrollPeriod())
  const [employeeFilter, setEmployeeFilter] = useState('')
  const [siteId, setSiteId] = useState('')
  const loadVersion = useRef(0)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [draft, setDraft] = useState(null)

  const load = useCallback(async () => {
    const version = ++loadVersion.current
    setRows([])
    if (!range.from || !range.to || range.from > range.to) {
      setError('Choose a valid date range with From date on or before To date.')
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      let query = supabase
        .from('adjustments')
        .select('*, employees!inner ( id, code, name, site_id, is_active, employee_statuses ( name, allows_records ) )')
        .gte('adj_date', range.from)
        .lte('adj_date', range.to)
        .order('adj_date', { ascending: false })
      if (employeeFilter) query = query.eq('employee_id', employeeFilter)
      if (siteId) query = query.eq('employees.site_id', Number(siteId))
      const data = await run(query)
      if (version === loadVersion.current) setRows(data ?? [])
    } catch (err) {
      if (version === loadVersion.current) setError(err.message)
    } finally {
      if (version === loadVersion.current) setLoading(false)
    }
  }, [range.from, range.to, employeeFilter, siteId])

  useEffect(() => {
    load()
  }, [load])

  function newDraft() {
    setDraft({
      employee_id: employeeFilter || '',
      adj_date: toISODate(new Date()),
      incentive: '',
      bonus: '',
      penalties: '',
      adjusted_days: '',
      adjusted_hhmm: '',
      salary_adjust: '',
      salary_advance: '',
      note: '',
    })
  }

  async function save(form) {
    setError(null)
    try {
      const payload = {
        employee_id: form.employee_id,
        adj_date: form.adj_date,
        incentive: Number(form.incentive) || 0,
        bonus: Number(form.bonus) || 0,
        penalties: Number(form.penalties) || 0,
        adjusted_days: Number(form.adjusted_days) || 0,
        adjusted_minutes: hhmmToMinutes(form.adjusted_hhmm),
        salary_adjust: Number(form.salary_adjust) || 0,
        salary_advance: Number(form.salary_advance) || 0,
        note: form.note?.trim() || null,
      }
      if (!payload.employee_id) {
        setError('Choose an employee.')
        return
      }
      if (form.id) {
        await run(supabase.from('adjustments').update(payload).eq('id', form.id))
        setNotice('Adjustment updated.')
      } else {
        await run(supabase.from('adjustments').insert(payload))
        setNotice('Adjustment added.')
      }
      setDraft(null)
      load()
    } catch (err) {
      setError(err.message)
    }
  }

  async function remove(row) {
    if (!window.confirm(`Delete the ${row.adj_date} adjustment for ${row.employees?.name}?`)) return
    try {
      await run(supabase.from('adjustments').delete().eq('id', row.id))
      setNotice('Adjustment deleted.')
      load()
    } catch (err) {
      setError(err.message)
    }
  }

  const currency = lookups.currency
  const totals = useMemo(() => {
    const sum = (key) => rows.reduce((total, row) => total + Number(row[key] || 0), 0)
    return [
      ['No. of employees', num(new Set(rows.map((row) => row.employee_id)).size, 0)],
      ['Incentive', num(sum('incentive'))],
      ['Bonus', num(sum('bonus'))],
      ['Penalties (d)', num(sum('penalties'), 2)],
      ['Adj. days', num(sum('adjusted_days'), 2)],
      ['Adj. hours', minutesToHHMM(sum('adjusted_minutes'))],
      ['Salary adjust', num(sum('salary_adjust'))],
      ['Advance', num(sum('salary_advance'))],
    ]
  }, [rows])

  if (lookups.loading) return <Spinner />

  return (
    <div className="grid grid-cols-1 gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Adjustments</h1>
          <p className="mt-0.5 text-sm text-ink-3">
            Incentives, bonuses, penalties and salary advances that feed the monthly report.
          </p>
          <PeriodLabel from={range.from} to={range.to} className="mt-2" />
        </div>
        <Button onClick={newDraft}>Add adjustment</Button>
      </div>

      <Card>
        <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="From date">
            <Input type="date" value={range.from}
              onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
          </Field>
          <Field label="To date">
            <Input type="date" value={range.to}
              onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
          </Field>
          <Field label="Site">
            <Select value={siteId} onChange={(e) => setSiteId(e.target.value)}>
              <option value="">All sites</option>
              {lookups.sites?.map((site) => (
                <option key={site.id} value={site.id}>{site.name}</option>
              ))}
            </Select>
          </Field>
          <div className="flex items-end gap-2">
            <Button variant="secondary" aria-label="Previous period"
              onClick={() => setRange(shiftPayrollPeriod(range.to || toISODate(new Date()), -1))}>
              &lsaquo;
            </Button>
            <Button variant="secondary" onClick={() => setRange(payrollPeriod())}>This period</Button>
            <Button variant="secondary" aria-label="Next period"
              onClick={() => setRange(shiftPayrollPeriod(range.to || toISODate(new Date()), 1))}>
              &rsaquo;
            </Button>
          </div>
        </div>
      </Card>

      {error && <Alert tone="error" onDismiss={() => setError(null)}>{error}</Alert>}
      {notice && <Alert tone="success" onDismiss={() => setNotice(null)}>{notice}</Alert>}

      {draft && (
        <AdjustmentForm
          value={draft}
          employees={employees}
          currency={currency}
          lockFor={locks.lockFor}
          onCancel={() => setDraft(null)}
          onSave={save}
        />
      )}

      <section aria-label="Adjustment totals" aria-busy={loading}
        className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        {totals.map(([label, value]) => (
          <div key={label} className="min-w-0 rounded-lg border border-line bg-panel px-2 py-2 shadow-sm">
            <p className="text-[10px] font-medium leading-tight text-ink-3">{label}</p>
            <p className="tabular mt-1 break-words text-sm font-semibold leading-snug text-ink">
              {loading || error ? '—' : value}
            </p>
          </div>
        ))}
      </section>

      <Card>
        <CardHeader
          title="Recorded adjustments"
          actions={
            <div className="flex flex-wrap items-end gap-2">
              <EmployeeSearch
                className="w-56"
                employees={employees}
                value={employeeFilter}
                onChange={setEmployeeFilter}
                emptyLabel="All employees"
              />
            </div>
          }
        />

        {loading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <EmptyState title="No adjustments in this period">
            Anything added here shows up in the monthly report for the same date range.
          </EmptyState>
        ) : (
          <div className="max-h-[70vh] overflow-auto">
            <table className="sticky-head w-full border-collapse">
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Employee</Th>
                  <Th className="text-right">Incentive</Th>
                  <Th className="text-right">Bonus</Th>
                  <Th className="text-right">Penalties (d)</Th>
                  <Th className="text-right">Adj. days</Th>
                  <Th className="text-right">Adj. hours</Th>
                  <Th className="text-right">Salary adjust</Th>
                  <Th className="text-right">Advance</Th>
                  <Th>Note</Th>
                  <Th />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => {
                  const lock = locks.lockFor(r.adj_date)
                  // The row's employee is read back with the adjustment, so
                  // a resigned colleague's rows are shown but not touchable.
                  const employeeBlock = recordBlockReason(r.employees)
                  const frozen = !!lock || !!employeeBlock
                  const lockTitle = lock
                    ? `${lockRangeLabel(lock)} is locked`
                    : employeeBlock || undefined
                  return (
                  <tr key={r.id} className={frozen ? 'bg-subtle/40 opacity-70' : 'hover:bg-hover'}>
                    <Td className="font-medium text-ink">
                      <div className="flex items-center gap-2">
                        {r.adj_date}
                        {lock && (
                          <span className="text-ink-4" aria-label="Locked" title={lockTitle}>
                            &#128274;
                          </span>
                        )}
                      </div>
                    </Td>
                    <Td>
                      #{r.employees?.code} — {r.employees?.name}
                    </Td>
                    <Td className="tabular text-right">{num(r.incentive)}</Td>
                    <Td className="tabular text-right">{num(r.bonus)}</Td>
                    <Td className="tabular text-right">{num(r.penalties, 2)}</Td>
                    <Td className="tabular text-right">{num(r.adjusted_days, 2)}</Td>
                    <Td className="tabular text-right">{minutesToHHMM(r.adjusted_minutes)}</Td>
                    <Td className="tabular text-right">{num(r.salary_adjust)}</Td>
                    <Td className="tabular text-right">{num(r.salary_advance)}</Td>
                    <Td className="text-ink-3">{r.note}</Td>
                    <Td className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={frozen}
                          title={lockTitle}
                          onClick={() =>
                            setDraft({
                              ...r,
                              incentive: Number(r.incentive) || '',
                              bonus: Number(r.bonus) || '',
                              penalties: Number(r.penalties) || '',
                              adjusted_days: Number(r.adjusted_days) || '',
                              adjusted_hhmm: r.adjusted_minutes
                                ? minutesToHHMM(r.adjusted_minutes)
                                : '',
                              salary_adjust: Number(r.salary_adjust) || '',
                              salary_advance: Number(r.salary_advance) || '',
                            })
                          }
                        >
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={frozen}
                          title={lockTitle}
                          onClick={() => remove(r)}
                        >
                          Delete
                        </Button>
                      </div>
                    </Td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

function AdjustmentForm({ value, employees, currency, lockFor, onCancel, onSave }) {
  const [form, setForm] = useState(value)
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))
  const lock = lockFor(form.adj_date)
  const employeeBlock = recordBlockReason(employees.find((e) => e.id === form.employee_id))
  const blocked = !!lock || !!employeeBlock

  return (
    <Card>
      <CardHeader title={form.id ? 'Edit adjustment' : 'New adjustment'} />
      <form
        className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (blocked) return
          onSave(form)
        }}
      >
        {lock && (
          <div className="sm:col-span-2 lg:col-span-4">
            <Alert tone="warning" title="That date is in a locked period">
              {lockRangeLabel(lock)} is closed to edits. Choose a date outside it, or ask a super
              admin to unlock the period under Settings.
            </Alert>
          </div>
        )}
        {employeeBlock && (
          <div className="sm:col-span-2 lg:col-span-4">
            <Alert tone="warning" title="This employee cannot be recorded">
              {employeeBlock}
            </Alert>
          </div>
        )}
        <EmployeeSearch
          className="sm:col-span-2"
          employees={employees}
          value={form.employee_id}
          onChange={(id) => set({ employee_id: id })}
          required
        />
        <Field label="Date">
          <Input
            type="date"
            required
            value={form.adj_date}
            onChange={(e) => set({ adj_date: e.target.value })}
          />
        </Field>
        <Field label={`Incentive (${currency})`}>
          <Input
            type="number"
            step="0.01"
            placeholder="0"
            value={form.incentive}
            onChange={(e) => set({ incentive: e.target.value })}
          />
        </Field>
        <Field label={`Bonus (${currency})`}>
          <Input
            type="number"
            step="0.01"
            placeholder="0"
            value={form.bonus}
            onChange={(e) => set({ bonus: e.target.value })}
          />
        </Field>
        <Field label="Penalties (days)" hint="Counts toward Deducted Hours.">
          <Input
            type="number"
            step="0.25"
            placeholder="0"
            value={form.penalties}
            onChange={(e) => set({ penalties: e.target.value })}
          />
        </Field>
        <Field label="Adjusted days">
          <Input
            type="number"
            step="0.25"
            placeholder="0"
            value={form.adjusted_days}
            onChange={(e) => set({ adjusted_days: e.target.value })}
          />
        </Field>
        <Field label="Adjusted hours (hh:mm)">
          <Input
            value={form.adjusted_hhmm}
            onChange={(e) => set({ adjusted_hhmm: e.target.value })}
            placeholder="00:00"
          />
        </Field>
        <Field label={`Salary adjust (${currency})`}>
          <Input
            type="number"
            step="0.01"
            placeholder="0"
            value={form.salary_adjust}
            onChange={(e) => set({ salary_adjust: e.target.value })}
          />
        </Field>
        <Field label={`Salary advance (${currency})`}>
          <Input
            type="number"
            step="0.01"
            placeholder="0"
            value={form.salary_advance}
            onChange={(e) => set({ salary_advance: e.target.value })}
          />
        </Field>
        <Field label="Note" className="sm:col-span-2">
          <Input value={form.note ?? ''} onChange={(e) => set({ note: e.target.value })} />
        </Field>

        <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
          <Button type="submit" disabled={blocked}>
            {form.id ? 'Save changes' : 'Add adjustment'}
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  )
}
