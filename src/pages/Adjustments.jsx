import { useCallback, useEffect, useState } from 'react'
import { supabase, run } from '../lib/supabase'
import { useLookups, useEmployees } from '../lib/useLookups'
import { hhmmToMinutes, minutesToHHMM, payrollPeriod, num, toISODate } from '../lib/format'
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

  const [range, setRange] = useState(() => payrollPeriod())
  const [employeeFilter, setEmployeeFilter] = useState('')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [draft, setDraft] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      let query = supabase
        .from('adjustments')
        .select('*, employees ( id, code, name )')
        .gte('adj_date', range.from)
        .lte('adj_date', range.to)
        .order('adj_date', { ascending: false })
      if (employeeFilter) query = query.eq('employee_id', employeeFilter)
      setRows(await run(query))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [range.from, range.to, employeeFilter])

  useEffect(() => {
    load()
  }, [load])

  function newDraft() {
    setDraft({
      employee_id: employeeFilter || '',
      adj_date: toISODate(new Date()),
      incentive: 0,
      bonus: 0,
      penalties: 0,
      adjusted_days: 0,
      adjusted_hhmm: '00:00',
      salary_adjust: 0,
      salary_advance: 0,
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

  if (lookups.loading) return <Spinner />

  return (
    <div className="grid grid-cols-1 gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Adjustments</h1>
          <p className="mt-0.5 text-sm text-ink-3">
            Incentives, bonuses, penalties and salary advances that feed the monthly report.
          </p>
        </div>
        <Button onClick={newDraft}>Add adjustment</Button>
      </div>

      {error && <Alert tone="error" onDismiss={() => setError(null)}>{error}</Alert>}
      {notice && <Alert tone="success" onDismiss={() => setNotice(null)}>{notice}</Alert>}

      {draft && (
        <AdjustmentForm
          value={draft}
          employees={employees}
          currency={currency}
          onCancel={() => setDraft(null)}
          onSave={save}
        />
      )}

      <Card>
        <CardHeader
          title="Recorded adjustments"
          actions={
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Employee">
                <Select
                  value={employeeFilter}
                  onChange={(e) => setEmployeeFilter(e.target.value)}
                  className="w-56"
                >
                  <option value="">All employees</option>
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
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-hover">
                    <Td className="font-medium text-ink">{r.adj_date}</Td>
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
                          onClick={() =>
                            setDraft({
                              ...r,
                              adjusted_hhmm: minutesToHHMM(r.adjusted_minutes),
                            })
                          }
                        >
                          Edit
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => remove(r)}>
                          Delete
                        </Button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

function AdjustmentForm({ value, employees, currency, onCancel, onSave }) {
  const [form, setForm] = useState(value)
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))

  return (
    <Card>
      <CardHeader title={form.id ? 'Edit adjustment' : 'New adjustment'} />
      <form
        className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4"
        onSubmit={(e) => {
          e.preventDefault()
          onSave(form)
        }}
      >
        <Field label="Employee" className="sm:col-span-2">
          <Select
            required
            value={form.employee_id}
            onChange={(e) => set({ employee_id: e.target.value })}
          >
            <option value="">Select…</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                #{emp.code} — {emp.name}
              </option>
            ))}
          </Select>
        </Field>
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
            value={form.incentive}
            onChange={(e) => set({ incentive: e.target.value })}
          />
        </Field>
        <Field label={`Bonus (${currency})`}>
          <Input
            type="number"
            step="0.01"
            value={form.bonus}
            onChange={(e) => set({ bonus: e.target.value })}
          />
        </Field>
        <Field label="Penalties (days)" hint="Counts toward Deducted Hours.">
          <Input
            type="number"
            step="0.25"
            value={form.penalties}
            onChange={(e) => set({ penalties: e.target.value })}
          />
        </Field>
        <Field label="Adjusted days">
          <Input
            type="number"
            step="0.25"
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
            value={form.salary_adjust}
            onChange={(e) => set({ salary_adjust: e.target.value })}
          />
        </Field>
        <Field label={`Salary advance (${currency})`}>
          <Input
            type="number"
            step="0.01"
            value={form.salary_advance}
            onChange={(e) => set({ salary_advance: e.target.value })}
          />
        </Field>
        <Field label="Note" className="sm:col-span-2">
          <Input value={form.note ?? ''} onChange={(e) => set({ note: e.target.value })} />
        </Field>

        <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
          <Button type="submit">{form.id ? 'Save changes' : 'Add adjustment'}</Button>
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  )
}
