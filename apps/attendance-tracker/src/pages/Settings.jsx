import { useEffect, useState } from 'react'
import { supabase, run } from '../lib/supabase'
import { useLookups } from '../lib/useLookups'
import { useAuth } from '../lib/auth'
import LockedPeriods from '../components/LockedPeriods'
import DepartmentsCard from '../components/DepartmentsCard'
import AccessCard from '../components/AccessCard'
import BusRoutesCard from '../components/BusRoutesCard'
import ChangeLogCard from '../components/ChangeLogCard'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Checkbox,
  Field,
  Input,
  Select,
  Spinner,
  Td,
  Th,
} from '../components/ui'

/* The balance effect a type carries, and the words for it.

   Offered when adding because it is the one thing about a type that
   cannot be changed afterwards anywhere in this app -- the table shows
   it as a badge and the edit row does not touch it. A leave type created
   without its effect would look right and quietly fail to come off
   anybody's balance. */
const EFFECTS = [
  ['none', 'None — does not touch a balance'],
  ['annual', 'Deducts annual leave'],
  ['unplanned', 'Deducts un-planned leave'],
  ['added_days', 'Deducts added days'],
  ['deducted', 'Counted as deducted leave'],
  ['absence', 'Unauthorised absence'],
]

const blankType = () => ({
  name_en: '',
  name_ar: '',
  effect: 'none',
  is_working_day: false,
  is_active: true,
  sort_order: '',
})

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
  const [editingSite, setEditingSite] = useState(null)
  const [newSiteName, setNewSiteName] = useState('')
  const [siteBusy, setSiteBusy] = useState(false)
  const [newType, setNewType] = useState(blankType)
  const [typeBusy, setTypeBusy] = useState(false)

  async function saveSite(event, site = null) {
    event.preventDefault()
    if (readOnly || siteBusy) return
    setError(null)
    setNotice(null)
    const name = (site ? site.name : newSiteName).trim()
    if (!name) {
      setError('Enter a site name.')
      return
    }
    if (lookups.sites?.some((s) => s.id !== site?.id && s.name.toLowerCase() === name.toLowerCase())) {
      setError('A site with that name already exists.')
      return
    }
    setSiteBusy(true)
    try {
      // Change only the label; employee assignments keep the same site ID.
      const query = site
        ? supabase.from('sites').update({ name }).eq('id', site.id)
        : supabase.from('sites').insert({
            name,
            available: true,
            sort_order: Math.max(0, ...(lookups.sites ?? []).map((s) => s.sort_order ?? 0)) + 1,
          })
      await run(query.select('id').single())
      if (site) setEditingSite(null)
      else setNewSiteName('')
      setNotice(site ? `Renamed site to "${name}".` : `Added site "${name}".`)
      await lookups.reload()
    } catch (err) {
      setError(err.message.includes('duplicate key')
        ? 'A site with that name already exists.'
        : err.message)
    } finally {
      setSiteBusy(false)
    }
  }

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

  /* Availability is is_active. A type that is not available is not
     offered when recording a day, and stays everywhere else: on this
     page, and behind every record already saved against it. Retiring a
     type is not deleting it, and the days it was used on still have to
     read back. */
  async function toggleTypeAvailable(type) {
    setError(null)
    setNotice(null)
    try {
      await run(
        supabase
          .from('attendance_types')
          .update({ is_active: !type.is_active })
          .eq('id', type.id),
      )
      setNotice(
        type.is_active
          ? `"${type.name_en}" is no longer offered when recording. Days already recorded with it are unchanged.`
          : `"${type.name_en}" can be used when recording again.`,
      )
      lookups.reload()
    } catch (err) {
      setError(err.message)
    }
  }

  /* The order everybody sees them in, on the Attendance page's dropdown
     and everywhere else that lists types. Saved on leaving the box
     rather than on every keystroke, so typing 12 is not three writes. */
  async function saveTypeOrder(type, value) {
    const order = Number(value)
    if (!Number.isFinite(order) || order === type.sort_order) return
    setError(null)
    setNotice(null)
    try {
      await run(
        supabase
          .from('attendance_types')
          .update({ sort_order: Math.trunc(order) })
          .eq('id', type.id),
      )
      lookups.reload()
    } catch (err) {
      setError(err.message)
    }
  }

  /**
   * A code for a new type, from its English name.
   *
   * code is the stable identifier the app matches on -- the Attendance
   * page's bulk fill looks up 'paid_day', the reports test 'weekly_rest',
   * 'holiday' and 'no_status' -- which is why it cannot be edited
   * afterwards. Deriving it rather than asking for it keeps people out of
   * a field where a typo is permanent, and the suffix makes certain a new
   * type never lands on a code something already depends on.
   */
  function codeFor(nameEn, taken) {
    const base =
      nameEn
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 40) || 'type'
    let code = base
    for (let n = 2; taken.has(code); n++) code = `${base}_${n}`
    return code
  }

  async function addType(event) {
    event.preventDefault()
    if (readOnly || typeBusy) return
    setError(null)
    setNotice(null)
    const nameEn = newType.name_en.trim()
    const nameAr = newType.name_ar.trim()
    if (!nameEn || !nameAr) {
      setError('A new attendance type needs both an English and an Arabic name.')
      return
    }
    const all = lookups.allTypes ?? []
    if (all.some((t) => t.name_en.toLowerCase() === nameEn.toLowerCase())) {
      setError(`There is already an attendance type called "${nameEn}".`)
      return
    }
    setTypeBusy(true)
    try {
      await run(
        supabase.from('attendance_types').insert({
          code: codeFor(nameEn, new Set(all.map((t) => t.code))),
          name_en: nameEn,
          name_ar: nameAr,
          effect: newType.effect,
          is_working_day: newType.is_working_day,
          is_active: newType.is_active,
          // Last in the list unless given a place, which is where a new
          // one belongs until somebody decides otherwise.
          sort_order:
            newType.sort_order === ''
              ? Math.max(0, ...all.map((t) => t.sort_order ?? 0)) + 1
              : Math.trunc(Number(newType.sort_order)),
        }),
      )
      setNewType(blankType())
      setNotice(
        `Added "${nameEn}". Meal, extra and added hours start at zero — use Edit to set them.`,
      )
      lookups.reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setTypeBusy(false)
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
    if (readOnly || siteBusy) return
    setSiteBusy(true)
    setNotice(null)
    setError(null)
    try {
      await run(supabase.from('sites').update({ available: !site.available }).eq('id', site.id).select('id').single())
      await lookups.reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setSiteBusy(false)
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

  // Which statuses an employee may be recorded against. The guard in the
  // database reads this column, so turning one on here is all it takes --
  // there is no list of status names in the code to keep in step.
  // Which statuses mean somebody is still with the company. Drives
  // employees.is_active, which no longer has a switch of its own.
  async function toggleActiveStatus(status) {
    setError(null)
    setNotice(null)
    try {
      await run(
        supabase
          .from('employee_statuses')
          .update({ counts_as_active: !status.counts_as_active })
          .eq('id', status.id),
      )
      setNotice(
        status.counts_as_active
          ? `Employees with the status “${status.name}” no longer count as active.`
          : `Employees with the status “${status.name}” now count as active.`,
      )
      lookups.reload()
    } catch (err) {
      setError(err.message)
    }
  }

  async function toggleRecordable(status) {
    setError(null)
    setNotice(null)
    try {
      await run(
        supabase
          .from('employee_statuses')
          .update({ allows_records: !status.allows_records })
          .eq('id', status.id),
      )
      setNotice(
        status.allows_records
          ? `Attendance and adjustments can no longer be saved for employees with the status "${status.name}".`
          : `Attendance and adjustments can now be saved for employees with the status "${status.name}".`,
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
                <Th className="text-right" title="The order these appear in when recording">
                  Order
                </Th>
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
                <Th
                  className="text-center"
                  title="Offered when recording attendance. Unticking hides it from the list without touching days already recorded."
                >
                  Available
                </Th>
                <Th className="sticky right-0 bg-panel text-right">Edit</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {/* allTypes, not types: this is the page that decides what
                  is available, so it has to show what is not. */}
              {lookups.allTypes?.map((t) =>
                editingType?.id === t.id ? (
                  <TypeEditRow
                    key={t.id}
                    value={editingType}
                    onChange={setEditingType}
                    onCancel={() => setEditingType(null)}
                    onSave={() => saveType(editingType)}
                  />
                ) : (
                <tr key={t.id} className={`hover:bg-hover ${t.is_active ? '' : 'opacity-60'}`}>
                  <Td className="text-right">
                    {/* Uncontrolled, keyed on the value: it is remounted
                        when the saved order changes, so the box never
                        shows a number the database disagrees with. */}
                    <Input
                      key={`${t.id}:${t.sort_order}`}
                      type="number"
                      step="1"
                      defaultValue={t.sort_order}
                      disabled={readOnly}
                      onBlur={(e) => saveTypeOrder(t, e.target.value)}
                      className="w-16 py-1.5 text-right text-sm"
                      aria-label={`Order for ${t.name_en}`}
                    />
                  </Td>
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
                      aria-label={`Counts toward required hours: ${t.name_en}`}
                    />
                  </Td>
                  <Td className="text-center">
                    <Checkbox
                      checked={t.is_active}
                      disabled={readOnly}
                      onChange={() => toggleTypeAvailable(t)}
                      label=""
                      aria-label={`Available when recording: ${t.name_en}`}
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

        {!readOnly && (
          <form className="border-t border-line p-5" onSubmit={addType}>
            <h3 className="mb-3 text-sm font-semibold text-ink">New attendance type</h3>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="English name">
                <Input
                  value={newType.name_en}
                  onChange={(e) => setNewType((t) => ({ ...t, name_en: e.target.value }))}
                  placeholder="e.g. Study leave"
                />
              </Field>
              <Field label="Arabic name">
                <Input
                  className="arabic"
                  dir="rtl"
                  value={newType.name_ar}
                  onChange={(e) => setNewType((t) => ({ ...t, name_ar: e.target.value }))}
                />
              </Field>
              <Field
                label="Balance effect"
                hint="Cannot be changed afterwards."
              >
                <Select
                  value={newType.effect}
                  onChange={(e) => setNewType((t) => ({ ...t, effect: e.target.value }))}
                >
                  {EFFECTS.map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Order" hint="Left blank, it goes last.">
                <Input
                  type="number"
                  step="1"
                  value={newType.sort_order}
                  onChange={(e) => setNewType((t) => ({ ...t, sort_order: e.target.value }))}
                  placeholder="last"
                />
              </Field>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-5">
              <Checkbox
                label="Counts toward required hours"
                checked={newType.is_working_day}
                onChange={() => setNewType((t) => ({ ...t, is_working_day: !t.is_working_day }))}
              />
              <Checkbox
                label="Available when recording"
                checked={newType.is_active}
                onChange={() => setNewType((t) => ({ ...t, is_active: !t.is_active }))}
              />
              <Button type="submit" size="sm" disabled={typeBusy}>
                {typeBusy ? 'Adding…' : 'Add type'}
              </Button>
            </div>
            <p className="mt-3 text-xs text-ink-4">
              Meal ×, Extra and Added start at zero; set them with Edit once the type is in the
              list. The code the app matches on is made from the English name and cannot be
              changed, so a type is renamed freely but never re-coded.
            </p>
          </form>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Sites" subtitle="Unavailable sites cannot be assigned to new employees." />
          <table className="w-full">
            <tbody className="divide-y divide-line">
              {lookups.sites?.map((s) => (
                <tr key={s.id}>
                  <Td className="font-medium text-ink">
                    {editingSite?.id === s.id && !readOnly ? (
                      <form className="flex flex-wrap gap-2" onSubmit={(event) => saveSite(event, editingSite)}>
                        <Input
                          aria-label="Site name"
                          value={editingSite.name}
                          disabled={siteBusy}
                          autoFocus
                          onChange={(event) => setEditingSite({ ...editingSite, name: event.target.value })}
                        />
                        <Button type="submit" size="sm" disabled={siteBusy || !editingSite.name.trim()}>Save</Button>
                        <Button type="button" variant="ghost" size="sm" disabled={siteBusy} onClick={() => setEditingSite(null)}>Cancel</Button>
                      </form>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <span>{s.name}</span>
                        {!readOnly && (
                          <Button variant="ghost" size="sm" disabled={siteBusy} onClick={() => setEditingSite({ id: s.id, name: s.name })}>
                            Rename
                          </Button>
                        )}
                      </div>
                    )}
                  </Td>
                  <Td className="text-right">
                    <Checkbox
                      label={s.available ? 'Available' : 'Unavailable'}
                      checked={s.available}
                      disabled={readOnly || siteBusy}
                      onChange={() => toggleSiteAvailable(s)}
                    />
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
          {!readOnly && (
            <form className="flex flex-wrap items-end gap-2 p-5" onSubmit={saveSite}>
              <Field label="New site name" className="min-w-0 flex-1">
                <Input value={newSiteName} disabled={siteBusy} onChange={(event) => setNewSiteName(event.target.value)} />
              </Field>
              <Button type="submit" size="sm" disabled={siteBusy || !newSiteName.trim()}>Add site</Button>
            </form>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Employee statuses"
            subtitle="Payable statuses appear in the monthly report, recordable ones can have attendance saved, and active ones mean the employee is still with the company."
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
                  <Td className="text-right">
                    <Checkbox
                      label="Can be recorded"
                      checked={s.allows_records}
                      disabled={readOnly}
                      onChange={() => toggleRecordable(s)}
                    />
                  </Td>
                  <Td className="text-right">
                    <Checkbox
                      label="Counts as active"
                      checked={s.counts_as_active}
                      disabled={readOnly}
                      onChange={() => toggleActiveStatus(s)}
                    />
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-5 pb-5 pt-1 text-xs text-ink-4">
            An employee can only have attendance or adjustments saved when they are active
            <em> and</em> hold a status ticked here. Note that leave days are themselves attendance
            records, so if you move people to a status such as “On Leave” while they are away, that
            status needs ticking or their leave cannot be entered.
          </p>
        </Card>
      </div>

      <DepartmentsCard lookups={lookups} readOnly={readOnly} />

      <BusRoutesCard lookups={lookups} readOnly={readOnly} />

      <AccessCard readOnly={readOnly} />

      {/* Last, and not gated on readOnly: reading the log is exactly what
          an admin who is not a super admin should be able to do, and the
          policy on audit_log says so too. Nothing on this card writes. */}
      <ChangeLogCard />
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
      {/* Order and Available are changed in the row itself, not in here:
          one tick, no Save. The cell is held so the columns line up. */}
      <Td className="tabular text-right text-ink-4">{value.sort_order}</Td>
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
