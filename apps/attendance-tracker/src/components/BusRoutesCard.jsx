import { useState } from 'react'
import { supabase, run } from '../lib/supabase'
import { usePendingEdits } from '../lib/usePendingEdits'
import SaveBar from './SaveBar'
import { Alert, Button, Card, CardHeader, Input, Td } from './ui'

/**
 * Company bus routes, editable.
 *
 * They were seeded at install, so adding a route meant a migration. The
 * database already restricted changes to a super admin, which is why
 * this needs no new rule -- only a place to use the one that was there.
 *
 * None is a route like any other. The Database page requires a bus route
 * on a new employee, and most people do not take the bus, so "None" has
 * to be something somebody can pick. It is protected from deletion here
 * for that reason, and renaming it would strand the employees who chose
 * it, so the name is left alone too.
 *
 * Nothing is deleted out from under a record: the foreign key restricts,
 * so a route still carrying employees refuses to go and says why.
 */
export default function BusRoutesCard({ lookups, readOnly }) {
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [busy, setBusy] = useState(false)
  const [newRoute, setNewRoute] = useState('')
  const edits = usePendingEdits()

  const routes = lookups.busRoutes ?? []
  const isNone = (route) => route.name.trim().toLowerCase() === 'none'

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

  function addRoute(event) {
    event.preventDefault()
    const name = newRoute.trim()
    if (!name) return
    const sortOrder = Math.max(0, ...routes.map((r) => r.sort_order ?? 0)) + 1
    act(`Added the ${name} route.`, async () => {
      await run(supabase.from('bus_routes').insert({ name, sort_order: sortOrder }))
      setNewRoute('')
    })
  }

  /* Renames wait for Save. Adding and deleting do not: both are already
     a press of their own button, and delete asks first. */
  async function saveEdits() {
    const changes = edits.pending(routes)
    const blank = changes.find(({ patch }) => !String(patch.name ?? '').trim())
    if (blank) {
      setError('A route cannot be left without a name. Put the name back, or press Discard.')
      return
    }
    const clash = changes.find(({ row, patch }) =>
      routes.some(
        (other) =>
          other.id !== row.id &&
          (edits.valueOf(other, 'name') ?? '').trim().toLowerCase() ===
            patch.name.trim().toLowerCase(),
      ),
    )
    if (clash) {
      setError(`Two routes would both be called "${clash.patch.name.trim()}".`)
      return
    }
    await act(`Saved ${changes.length} route${changes.length === 1 ? '' : 's'}.`, async () => {
      for (const { row, patch } of changes) {
        await run(
          supabase.from('bus_routes').update({ name: patch.name.trim() }).eq('id', row.id),
        )
      }
      edits.discard()
    })
  }

  function remove(route) {
    if (!window.confirm(`Delete the ${route.name} route?`)) return
    act(`Deleted the ${route.name} route.`, () =>
      run(supabase.from('bus_routes').delete().eq('id', route.id)))
  }

  return (
    <Card>
      <CardHeader
        title="Bus routes"
        subtitle={`${routes.length} routes. Employees pick one on the Database page.`}
      />

      <div className="px-5">
        {readOnly && (
          <Alert tone="info" title="Read-only">
            Only a super admin can change the bus routes. The database refuses it from anyone
            else, so this is showing you the list rather than hiding it.
          </Alert>
        )}
        {error && <Alert tone="error" onDismiss={() => setError(null)}>{error}</Alert>}
        {notice && <Alert tone="success" onDismiss={() => setNotice(null)}>{notice}</Alert>}
      </div>

      <div className="p-5">
        <div className="max-h-80 overflow-auto rounded-lg border border-line">
          <table className="w-full">
            <tbody className="divide-y divide-line">
              {routes.map((route) => (
                <tr key={route.id}>
                  <Td>
                    {isNone(route) ? (
                      <span className="text-sm text-ink-3">
                        {route.name}
                        <span className="ml-2 text-xs text-ink-4">
                          for employees who do not take the bus
                        </span>
                      </span>
                    ) : (
                      <Input
                        value={edits.valueOf(route, 'name')}
                        disabled={readOnly || busy}
                        className={`py-1 text-sm ${
                          edits.isEdited(route, 'name') ? 'border-edge-warning' : ''
                        }`}
                        onChange={(e) => edits.stage(route, { name: e.target.value })}
                      />
                    )}
                  </Td>
                  <Td className="w-16 text-right">
                    {!isNone(route) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={readOnly || busy}
                        onClick={() => remove(route)}
                      >
                        Delete
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
              {routes.length === 0 && (
                <tr>
                  <Td className="text-sm text-ink-4">No routes yet.</Td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <form className="mt-3 flex gap-2" onSubmit={addRoute}>
          <Input
            placeholder="New route name"
            value={newRoute}
            disabled={readOnly || busy}
            onChange={(e) => setNewRoute(e.target.value)}
            className="py-1.5 text-sm"
          />
          <Button type="submit" size="sm" disabled={readOnly || busy || !newRoute.trim()}>
            Add
          </Button>
        </form>
      </div>

      {!readOnly && (
        <SaveBar
          count={edits.count}
          busy={busy}
          onSave={saveEdits}
          onDiscard={edits.discard}
          hint="Renames are saved here. Add and Delete happen straight away."
        />
      )}
    </Card>
  )
}

/** Postgres error codes, in words that say what to do about it. */
function explain(err) {
  const message = err?.message ?? String(err)
  if (message.includes('violates foreign key constraint')) {
    return 'That route still has employees on it. Move them to another route first.'
  }
  if (message.includes('duplicate key') || message.includes('already exists')) {
    return 'There is already a route with that name.'
  }
  if (message.includes('row-level security')) {
    return 'Only a super admin can change the bus routes.'
  }
  return message
}
