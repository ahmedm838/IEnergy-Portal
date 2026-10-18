import { useEffect, useState } from 'react'
import { supabase, run } from '../lib/supabase'
import { useLookups } from '../lib/useLookups'
import { useAuth } from '../lib/auth'
import { absenceDeduction } from '../lib/calc'
import LockedPeriods from '../components/LockedPeriods'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Checkbox,
  Field,
  Input,
  Spinner,
  Td,
  Th,
} from '../components/ui'

export default function Settings() {
  const lookups = useLookups()
  // Admins may read this page; only a super admin may change it. The RLS
  // policies enforce that regardless, so this is about showing people a
  // disabled control rather than a confusing failure after they click.
  const { isSuperAdmin } = useAuth()
  const readOnly = !isSuperAdmin
  const [mealRate, setMealRate] = useState('')
  const [hoursPerDay, setHoursPerDay] = useState('')
  const [lateGrace, setLateGrace] = useState('')
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [editingType, setEditingType] = useState(null)

  async function saveType(form) {
    setError(null)
    setNotice(null)
    try {
      // code is deliberately not updatable here: it is the identifier the
      // app matches on (the Attendance page's bulk fills look it up), and
      // renaming it silently breaks those buttons. Labels are what people
      // actually want to change.
      await run(
        supabase
          .from('attendance_types')
          .update({
            name_en: form.name_en.trim(),
            name_ar: form.name_ar.trim(),
            meal_multiplier: Number(form.meal_multiplier) || 0,
            extra_hours: Number(form.extra_hours) || 0,
            added_hours: Number(form.added_hours) || 0,
          })
          .eq('id', form.id),
      )
      setEditingType(null)
      setNotice(`Saved "${form.name_en.trim()}". Reports use the new values immediately.`)
      lookups.reload()
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => {
    if (lookups.loading) return
    setMealRate(String(lookups.mealRate ?? 0))
    setHoursPerDay(String(lookups.requiredHoursPerDay ?? 8))
    setLateGrace(String(lookups.lateGraceHours ?? 2))
  }, [lookups.loading, lookups.mealRate, lookups.requiredHoursPerDay, lookups.lateGraceHours])

  async function saveSettings(event) {
    event.preventDefault()
    setError(null)
    setNotice(null)
    try {
      await run(
        supabase.from('app_settings').upsert(
          [
            { key: 'meal_allowance_rate', value: Number(mealRate) || 0 },
            { key: 'required_hours_per_day', value: Number(hoursPerDay) || 8 },
            { key: 'late_grace_hours', value: Number(lateGrace) || 0 },
          ],
          { onConflict: 'key' },
        ),
      )
      setNotice('Settings saved. Reports use the new values immediately.')
      lookups.reload()
    } catch (err) {
      setError(err.message)
    }
  }

  async function toggleWorkingDay(type) {
    setError(null)
    try {
      await run(
        supabase
          .from('attendance_types')
          .update({ is_working_day: !type.is_working_day })
          .eq('id', type.id),
      )
      lookups.reload()
    } catch (err) {
      setError(err.message)
    }
  }

  async function toggleSiteAvailable(site) {
    setError(null)
    try {
      await run(supabase.from('sites').update({ available: !site.available }).eq('id', site.id))
      lookups.reload()
    } catch (err) {
      setError(err.message)
    }
  }

  async function togglePayroll(status) {
    setError(null)
    try {
      await run(
        supabase
          .from('employee_statuses')
          .update({ in_payroll: !status.in_payroll })
          .eq('id', status.id),
      )
      lookups.reload()
    } catch (err) {
      setError(err.message)
    }
  }

  if (lookups.loading) return <Spinner />

  return (
    <div className="grid grid-cols-1 gap-5">
      <div>
        <h1 className="text-xl font-semibold text-ink">Settings</h1>
        <p className="mt-0.5 text-sm text-ink-3">
          Reference data from the workbook. Changes take effect on the next report run.
        </p>
      </div>

      {readOnly && (
        <Alert tone="info" title="Read-only">
          These values drive every report, so only a super admin can change them. Ask one to make
          an edit on your behalf.
        </Alert>
      )}

      {error && <Alert tone="error" onDismiss={() => setError(null)}>{error}</Alert>}
      {notice && <Alert tone="success" onDismiss={() => setNotice(null)}>{notice}</Alert>}

      <Card>
        <CardHeader title="Payroll constants" />
        <form className="grid gap-4 p-5 sm:grid-cols-4" onSubmit={saveSettings}>
          <Field
            label={`Meal allowance (${lookups.currency} per meal unit)`}
            hint="Default for the monthly report; can be overridden per run."
          >
            <Input
              type="number"
              step="0.01"
              min="0"
              value={mealRate}
              disabled={readOnly}
              onChange={(e) => setMealRate(e.target.value)}
            />
          </Field>
          <Field
            label="Required hours per working day"
            hint="The workbook's literal 8. Drives required hours and every deduction formula."
          >
            <Input
              type="number"
              step="0.5"
              min="1"
              value={hoursPerDay}
              disabled={readOnly}
              onChange={(e) => setHoursPerDay(e.target.value)}
            />
          </Field>
          <Field
            label="Late hours forgiven per period"
            hint="Lateness beyond this is added to Deducted Hours on the monthly report."
          >
            <Input
              type="number"
              step="0.25"
              min="0"
              value={lateGrace}
              disabled={readOnly}
              onChange={(e) => setLateGrace(e.target.value)}
            />
          </Field>
          <div className="flex items-end">
            <Button type="submit" disabled={readOnly}>Save</Button>
          </div>
        </form>
      </Card>

      <LockedPeriods readOnly={readOnly} />

      <Card>
        <CardHeader
          title="Attendance types"
          subtitle="Edit labels and values here rather than in the database. Overtime is calculated as Extra × 1.5 + Added, exactly as in the workbook, so it cannot be set directly."
        />
        <div className="max-h-[60vh] overflow-auto">
          <table className="sticky-head w-full border-collapse">
            <thead>
              <tr>
                <Th>Status</Th>
                <Th>الحالة</Th>
                <Th className="text-right">Meal ×</Th>
                <Th className="text-right">Extra</Th>
                <Th className="text-right">Added</Th>
                <Th className="text-right">Overtime</Th>
                <Th>Balance effect</Th>
                <Th className="text-center" title="Counts toward required hours">
                  Required hrs
                </Th>
                <Th className="sticky right-0 bg-panel text-right">Edit</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {lookups.types?.map((t) =>
                editingType?.id === t.id ? (
                  <TypeEditRow
                    key={t.id}
                    value={editingType}
                    onChange={setEditingType}
                    onCancel={() => setEditingType(null)}
                    onSave={() => saveType(editingType)}
                  />
                ) : (
                <tr key={t.id} className="hover:bg-hover">
                  <Td className="font-medium text-ink" title={`code: ${t.code}`}>{t.name_en}</Td>
                  <Td className="arabic">{t.name_ar}</Td>
                  <Td className="tabular text-right">{t.meal_multiplier}</Td>
                  <Td className="tabular text-right">{t.extra_hours}</Td>
                  <Td className="tabular text-right">{t.added_hours}</Td>
                  <Td className="tabular text-right font-semibold">{t.overtime_hours}</Td>
                  <Td>
                    {t.effect === 'none' ? (
                      <span className="text-ink-4">—</span>
                    ) : (
                      <Badge tone={t.effect === 'absence' ? 'red' : 'amber'}>
                        {
                          {
                            annual: 'Deducts annual leave',
                            unplanned: 'Deducts un-planned leave',
                            added_days: 'Deducts added days',
                            deducted: 'Counted as deducted leave',
                            absence: 'Unauthorised absence',
                          }[t.effect]
                        }
                      </Badge>
                    )}
                  </Td>
                  <Td className="text-center">
                    <Checkbox
                      checked={t.is_working_day}
                      disabled={readOnly}
                      onChange={() => toggleWorkingDay(t)}
                      label=""
                    />
                  </Td>
                  <Td className="sticky right-0 z-[1] bg-panel text-right shadow-[-8px_0_8px_-8px_rgba(0,0,0,0.25)]">
                    {readOnly ? (
                      <span className="text-xs text-ink-4">—</span>
                    ) : (
                      <Button variant="ghost" size="sm" onClick={() => setEditingType({ ...t })}>
                        Edit
                      </Button>
                    )}
                  </Td>
                </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Sites" subtitle="Unavailable sites cannot be assigned to new employees." />
          <table className="w-full">
            <tbody className="divide-y divide-line">
              {lookups.sites?.map((s) => (
                <tr key={s.id}>
                  <Td className="font-medium text-ink">{s.name}</Td>
                  <Td className="text-right">
                    <Checkbox
                      label={s.available ? 'Available' : 'Unavailable'}
                      checked={s.available}
                      disabled={readOnly}
                      onChange={() => toggleSiteAvailable(s)}
                    />
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card>
          <CardHeader
            title="Employee statuses"
            subtitle="Only payable statuses appear in the monthly report."
          />
          <table className="w-full">
            <tbody className="divide-y divide-line">
              {lookups.statuses?.map((s) => (
                <tr key={s.id}>
                  <Td className="font-medium text-ink">{s.name}</Td>
                  <Td className="text-right">
                    <Checkbox
                      label={s.in_payroll ? 'In payroll' : 'Excluded'}
                      checked={s.in_payroll}
                      disabled={readOnly}
                      onChange={() => togglePayroll(s)}
                    />
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Absence penalty scale"
          subtitle="Cumulative per employee per calendar year, reset every 1 January."
        />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line">
                <Th>Absences in the year</Th>
                <Th className="text-right">Total deduction</Th>
                <Th className="text-right">This absence costs</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <tr key={n}>
                  <Td>{n}</Td>
                  <Td className="tabular text-right font-semibold">
                    {absenceDeduction(n).toFixed(2)} days
                  </Td>
                  <Td className="tabular text-right text-ink-3">
                    +{(absenceDeduction(n) - absenceDeduction(n - 1)).toFixed(2)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="text-sm text-ink-2">
            <p className="font-medium text-ink">How it is applied</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-2">
              <li>Only the Absent Day (غياب) type counts.</li>
              <li>
                Approved leave, holidays and weekly rest are excluded, because they carry a
                different balance effect.
              </li>
              <li>
                A payroll period is charged the <em>increment</em> on the scale, so an employee&rsquo;s
                fourth absence of the year costs 3.00 days even if it is their first that month.
              </li>
              <li>Deleting or changing an absence recalculates the penalty automatically.</li>
            </ul>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Departments" subtitle={`${lookups.departments?.length ?? 0} across ${lookups.sectors?.length ?? 0} sectors`} />
        <div className="max-h-96 overflow-auto">
          <table className="sticky-head w-full">
            <thead>
              <tr>
                <Th>Department</Th>
                <Th>Sector</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {lookups.departments?.map((d) => (
                <tr key={d.id}>
                  <Td className="font-medium text-ink">{d.name}</Td>
                  <Td className="text-ink-3">{d.sectors?.name}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

/**
 * Inline editor for one attendance type.
 *
 * Overtime is shown but never editable: it is a generated column
 * (extra * 1.5 + added), so the database would reject a write to it. The
 * live preview makes the relationship obvious while you type.
 *
 * `code` is not editable either. It is the stable identifier the app
 * matches on -- the Attendance page's "Fill workdays" button looks up
 * code = 'paid_day' -- so renaming it breaks features silently while the
 * screen still looks correct.
 */
function TypeEditRow({ value, onChange, onCancel, onSave }) {
  const set = (patch) => onChange({ ...value, ...patch })
  const previewOvertime =
    (Number(value.extra_hours) || 0) * 1.5 + (Number(value.added_hours) || 0)

  return (
    <tr className="bg-tint-warning/60">
      <Td>
        <Input
          value={value.name_en}
          onChange={(e) => set({ name_en: e.target.value })}
          className="min-w-40 py-1.5 text-sm"
          aria-label="English name"
        />
      </Td>
      <Td>
        <Input
          value={value.name_ar}
          onChange={(e) => set({ name_ar: e.target.value })}
          className="arabic min-w-32 py-1.5 text-sm"
          aria-label="Arabic name"
        />
      </Td>
      {['meal_multiplier', 'extra_hours', 'added_hours'].map((field) => (
        <Td key={field} className="text-right">
          <Input
            type="number"
            step="0.25"
            min="0"
            value={value[field]}
            onChange={(e) => set({ [field]: e.target.value })}
            className="w-20 py-1.5 text-right text-sm"
            aria-label={field}
          />
        </Td>
      ))}
      <Td className="tabular text-right font-semibold" title="Calculated: Extra × 1.5 + Added">
        {previewOvertime.toFixed(2)}
      </Td>
      <Td className="text-xs text-ink-4">code: {value.code}</Td>
      <Td />
      <Td className="sticky right-0 z-[1] bg-tint-warning text-right shadow-[-8px_0_8px_-8px_rgba(0,0,0,0.25)]">
        <div className="flex justify-end gap-1">
          <Button size="sm" onClick={onSave}>
            Save
          </Button>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </Td>
    </tr>
  )
}
