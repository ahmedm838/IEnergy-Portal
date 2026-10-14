import { useEffect, useState } from 'react'
import { supabase, run } from '../lib/supabase'
import { useLookups } from '../lib/useLookups'
import { absenceDeduction } from '../lib/calc'
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
  const [mealRate, setMealRate] = useState('')
  const [hoursPerDay, setHoursPerDay] = useState('')
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)

  useEffect(() => {
    if (lookups.loading) return
    setMealRate(String(lookups.mealRate ?? 0))
    setHoursPerDay(String(lookups.requiredHoursPerDay ?? 8))
  }, [lookups.loading, lookups.mealRate, lookups.requiredHoursPerDay])

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
    <div className="grid gap-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Settings</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          Reference data from the workbook. Changes take effect on the next report run.
        </p>
      </div>

      {error && <Alert tone="error" onDismiss={() => setError(null)}>{error}</Alert>}
      {notice && <Alert tone="success" onDismiss={() => setNotice(null)}>{notice}</Alert>}

      <Card>
        <CardHeader title="Payroll constants" />
        <form className="grid gap-4 p-5 sm:grid-cols-3" onSubmit={saveSettings}>
          <Field
            label={`Meal allowance (${lookups.currency} per meal unit)`}
            hint="Default for the monthly report; can be overridden per run."
          >
            <Input
              type="number"
              step="0.01"
              min="0"
              value={mealRate}
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
              onChange={(e) => setHoursPerDay(e.target.value)}
            />
          </Field>
          <div className="flex items-end">
            <Button type="submit">Save</Button>
          </div>
        </form>
      </Card>

      <Card>
        <CardHeader
          title="Attendance types"
          subtitle="Overtime is calculated as Extra × 1.5 + Added, exactly as in the workbook."
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
                <Th className="text-center">Counts toward required hours</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lookups.types?.map((t) => (
                <tr key={t.id} className="hover:bg-slate-50">
                  <Td className="font-medium text-slate-900">{t.name_en}</Td>
                  <Td className="arabic">{t.name_ar}</Td>
                  <Td className="tabular text-right">{t.meal_multiplier}</Td>
                  <Td className="tabular text-right">{t.extra_hours}</Td>
                  <Td className="tabular text-right">{t.added_hours}</Td>
                  <Td className="tabular text-right font-semibold">{t.overtime_hours}</Td>
                  <Td>
                    {t.effect === 'none' ? (
                      <span className="text-slate-400">—</span>
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
                      onChange={() => toggleWorkingDay(t)}
                      label=""
                    />
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Sites" subtitle="Unavailable sites cannot be assigned to new employees." />
          <table className="w-full">
            <tbody className="divide-y divide-slate-100">
              {lookups.sites?.map((s) => (
                <tr key={s.id}>
                  <Td className="font-medium text-slate-900">{s.name}</Td>
                  <Td className="text-right">
                    <Checkbox
                      label={s.available ? 'Available' : 'Unavailable'}
                      checked={s.available}
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
            <tbody className="divide-y divide-slate-100">
              {lookups.statuses?.map((s) => (
                <tr key={s.id}>
                  <Td className="font-medium text-slate-900">{s.name}</Td>
                  <Td className="text-right">
                    <Checkbox
                      label={s.in_payroll ? 'In payroll' : 'Excluded'}
                      checked={s.in_payroll}
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
              <tr className="border-b border-slate-200">
                <Th>Absences in the year</Th>
                <Th className="text-right">Total deduction</Th>
                <Th className="text-right">This absence costs</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <tr key={n}>
                  <Td>{n}</Td>
                  <Td className="tabular text-right font-semibold">
                    {absenceDeduction(n).toFixed(2)} days
                  </Td>
                  <Td className="tabular text-right text-slate-500">
                    +{(absenceDeduction(n) - absenceDeduction(n - 1)).toFixed(2)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="text-sm text-slate-600">
            <p className="font-medium text-slate-900">How it is applied</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-600">
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
            <tbody className="divide-y divide-slate-100">
              {lookups.departments?.map((d) => (
                <tr key={d.id}>
                  <Td className="font-medium text-slate-900">{d.name}</Td>
                  <Td className="text-slate-500">{d.sectors?.name}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
