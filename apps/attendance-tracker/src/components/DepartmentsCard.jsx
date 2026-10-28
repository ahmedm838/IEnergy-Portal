import { useState } from 'react'
import { supabase, run } from '../lib/supabase'
import { usePendingEdits } from '../lib/usePendingEdits'
import SaveBar from './SaveBar'
import { Alert, Button, Card, CardHeader, Field, Input, Select, Td, Th } from './ui'

/**
 * Sectors and departments, editable.
 *
 * Both were read-only lists seeded at install, so adding a department
 * meant a migration. They are ordinary reference data and belong next to
 * the sites and statuses that were already editable here.
 *
 * Nothing is deleted out from under a record: the foreign keys are
 * restricting, so a department still holding employees, or a sector still
 * holding departments, refuses to go and says why.
 */
export default function DepartmentsCard({ lookups, readOnly }) {
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [busy, setBusy] = useState(false)
  const [newSector, setNewSector] = useState('')
  const [newDept, setNewDept] = useState({ name: '', sector_id: '' })
  // A buffer each: the two lists have their own ids, and the one button
  // below them saves both together.
  const sectorEdits = usePendingEdits()
  const deptEdits = usePendingEdits()

  const sectors = lookups.sectors ?? []
  const departments = lookups.departments ?? []

  async function act(what, fn) {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await fn()
      setNotice(what)
      lookups.reload()
    } catch (err) {
      setError(explain(err))
    } finally {
      setBusy(false)
    }
  }

  const nextOrder = (rows) => Math.max(0, ...rows.map((r) => r.sort_order ?? 0)) + 1

  function addSector(event) {
    event.preventDefault()
    const name = newSector.trim()
    if (!name) return
    act(`Added the ${name} sector.`, async () => {
      await run(supabase.from('sectors').insert({ name, sort_order: nextOrder(sectors) }))
      setNewSector('')
    })
  }

  function addDepartment(event) {
    event.preventDefault()
    const name = newDept.name.trim()
    if (!name) return
    if (!newDept.sector_id) {
      setError('Choose which sector the department belongs to.')
      return
    }
    act(`Added the ${name} department.`, async () => {
      await run(
        supabase.from('departments').insert({
          name,
          sector_id: Number(newDept.sector_id),
          sort_order: nextOrder(departments),
        }),
      )
      setNewDept({ name: '', sector_id: '' })
    })
  }

  /* Renames and sector moves wait for Save. Adding and deleting do not:
     each is already a press of its own button, and delete asks first. */
  const changeCount = sectorEdits.count + deptEdits.count

  function discardAll() {
    sectorEdits.discard()
    deptEdits.discard()
  }

  async function saveEdits() {
    const sectorChanges = sectorEdits.pending(sectors)
    const deptChanges = deptEdits.pending(departments)

    const blank = [...sectorChanges, ...deptChanges].find(
      ({ patch }) => 'name' in patch && !patch.name.trim(),
    )
    if (blank) {
      setError('A name cannot be left empty. Put it back, or press Discard.')
      return
    }

    const total = sectorChanges.length + deptChanges.length
    await act(`Saved ${total} change${total === 1 ? '' : 's'}.`, async () => {
      for (const { row, patch } of sectorChanges) {
        await run(supabase.from('sectors').update({ name: patch.name.trim() }).eq('id', row.id))
      }
      for (const { row, patch } of deptChanges) {
        const values = {}
        if ('name' in patch) values.name = patch.name.trim()
        if ('sector_id' in patch) values.sector_id = Number(patch.sector_id)
        await run(supabase.from('departments').update(values).eq('id', row.id))
      }
      discardAll()
    })
  }

  function removeSector(sector) {
    if (!window.confirm(`Delete the ${sector.name} sector?`)) return
    act(`Deleted the ${sector.name} sector.`, () =>
      run(supabase.from('sectors').delete().eq('id', sector.id)))
  }

  function removeDepartment(dept) {
    if (!window.confirm(`Delete the ${dept.name} department?`)) return
    act(`Deleted the ${dept.name} department.`, () =>
      run(supabase.from('departments').delete().eq('id', dept.id)))
  }

  return (
    <Card>
      <CardHeader
        title="Departments and sectors"
        subtitle={`${departments.length} departments across ${sectors.length} sectors`}
      />

      <div className="px-5">
        {error && <Alert tone="error" onDismiss={() => setError(null)}>{error}</Alert>}
        {notice && <Alert tone="success" onDismiss={() => setNotice(null)}>{notice}</Alert>}
      </div>

      <div className="grid gap-5 p-5 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Sectors</h3>
          <div className="max-h-80 overflow-auto rounded-lg border border-line">
            <table className="w-full">
              <tbody className="divide-y divide-line">
                {sectors.map((s) => (
                  <tr key={s.id}>
                    <Td>
                      <Input
                        value={sectorEdits.valueOf(s, 'name')}
                        disabled={readOnly || busy}
                        className={`py-1 text-sm ${
                          sectorEdits.isEdited(s, 'name') ? 'border-edge-warning' : ''
                        }`}
                        onChange={(e) => sectorEdits.stage(s, { name: e.target.value })}
                      />
                    </Td>
                    <Td className="w-16 text-right">
                      {!readOnly && (
                        <Button variant="ghost" size="sm" disabled={busy} onClick={() => removeSector(s)}>
                          Delete
                        </Button>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!readOnly && (
            <form className="mt-2 flex gap-2" onSubmit={addSector}>
              <Input
                value={newSector}
                onChange={(e) => setNewSector(e.target.value)}
                placeholder="New sector name"
                className="py-1.5 text-sm"
              />
              <Button type="submit" size="sm" disabled={busy || !newSector.trim()}>
                Add
              </Button>
            </form>
          )}
        </div>

        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">
            Departments
          </h3>
          <div className="max-h-80 overflow-auto rounded-lg border border-line">
            <table className="sticky-head w-full">
              <thead>
                <tr>
                  <Th>Department</Th>
                  <Th>Sector</Th>
                  <Th />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {departments.map((d) => (
                  <tr key={d.id}>
                    <Td>
                      <Input
                        value={deptEdits.valueOf(d, 'name')}
                        disabled={readOnly || busy}
                        className={`py-1 text-sm ${
                          deptEdits.isEdited(d, 'name') ? 'border-edge-warning' : ''
                        }`}
                        onChange={(e) => deptEdits.stage(d, { name: e.target.value })}
                      />
                    </Td>
                    <Td>
                      <Select
                        value={deptEdits.valueOf(d, 'sector_id') ?? ''}
                        disabled={readOnly || busy}
                        className={`py-1 text-sm ${
                          deptEdits.isEdited(d, 'sector_id') ? 'border-edge-warning' : ''
                        }`}
                        onChange={(e) =>
                          deptEdits.stage(d, { sector_id: Number(e.target.value) })
                        }
                      >
                        {sectors.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </Select>
                    </Td>
                    <Td className="w-16 text-right">
                      {!readOnly && (
                        <Button variant="ghost" size="sm" disabled={busy} onClick={() => removeDepartment(d)}>
                          Delete
                        </Button>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!readOnly && (
            <form className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto_auto]" onSubmit={addDepartment}>
              <Input
                value={newDept.name}
                onChange={(e) => setNewDept((d) => ({ ...d, name: e.target.value }))}
                placeholder="New department name"
                className="py-1.5 text-sm"
              />
              <Select
                value={newDept.sector_id}
                onChange={(e) => setNewDept((d) => ({ ...d, sector_id: e.target.value }))}
                className="py-1.5 text-sm"
              >
                <option value="">Sector…</option>
                {sectors.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
              <Button type="submit" size="sm" disabled={busy || !newDept.name.trim()}>
                Add
              </Button>
            </form>
          )}
        </div>
      </div>

      <p className="px-5 pb-5 text-xs text-ink-4">
        A department still holding employees, or a sector still holding departments, cannot be
        deleted — move them first. Renaming is safe at any time: records point at the row, not the
        name.
      </p>

      {!readOnly && (
        <SaveBar
          count={changeCount}
          busy={busy}
          onSave={saveEdits}
          onDiscard={discardAll}
          hint="Renames and sector moves are saved here. Add and Delete happen straight away."
        />
      )}
    </Card>
  )
}

/** Postgres error codes, in words that say what to do about it. */
function explain(err) {
  const message = err?.message ?? String(err)
  if (message.includes('violates foreign key constraint')) {
    if (message.includes('employees_department_id_fkey')) {
      return 'That department still has employees in it. Move them to another department first.'
    }
    if (message.includes('departments_sector_id_fkey')) {
      return 'That sector still has departments in it. Move or delete those first.'
    }
    return 'Something still refers to that row, so it cannot be deleted yet.'
  }
  if (message.includes('duplicate key') || message.includes('already exists')) {
    return 'There is already one with that name.'
  }
  if (message.includes('row-level security')) {
    return 'Only a super admin can change departments and sectors.'
  }
  return message
}
