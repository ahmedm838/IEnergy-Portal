import { useState } from 'react'
import { supabase, run } from '../lib/supabase'
import { usePendingEdits } from '../lib/usePendingEdits'
import SaveBar from './SaveBar'
import { Alert, Button, Card, CardHeader, Input, Td } from './ui'

/**
 * Job levels (employee_levels), editable, listed highest rank first.
 *
 * Rank is what the visibility rule compares -- a user sees people of a
 * lower rank in their scope -- so changing a rank changes who sees whom.
 * Ranks are unique in the database. A save that swaps two ranks would
 * trip that constraint half way through, so changed rows are first moved
 * to temporary negative ranks and then given their new ones.
 *
 * sort_order follows rank (highest first) after every save or add, so
 * the pickers and reports keep the same top-down order as this list.
 *
 * Nothing is deleted out from under a record: the foreign key restricts,
 * so a level still held by employees refuses to go and says why.
 */
export default function LevelsCard({ lookups, readOnly }) {
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState({ code: '', name: '', rank: '' })
  const edits = usePendingEdits()

  const levels = [...(lookups.levels ?? [])].sort((a, b) => b.rank - a.rank)

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

  /** Re-number sort_order from rank, highest first. */
  async function resequence(rows) {
    const ordered = [...rows].sort((a, b) => b.rank - a.rank)
    for (const [i, row] of ordered.entries()) {
      if (row.sort_order !== i + 1) {
        await run(supabase.from('employee_levels').update({ sort_order: i + 1 }).eq('id', row.id))
      }
    }
  }

  function addLevel(event) {
    event.preventDefault()
    const code = draft.code.trim()
    const name = draft.name.trim()
    const rank = Number(draft.rank)
    if (!code || !name || !Number.isInteger(rank) || rank < 1) {
      setError('A new level needs a code, a name and a whole-number rank of 1 or more.')
      return
    }
    if (levels.some((l) => l.rank === rank)) {
      setError(`Rank ${rank} is already ${levels.find((l) => l.rank === rank).code}. Pick a free rank, or change that level's rank first.`)
      return
    }
    act(`Added level ${code}.`, async () => {
      const inserted = await run(
        supabase.from('employee_levels').insert({ code, name, rank, sort_order: 0 }).select('id, rank, sort_order').single(),
      )
      await resequence([...levels, inserted])
      setDraft({ code: '', name: '', rank: '' })
    })
  }

  async function saveEdits() {
    const changes = edits.pending(levels)
    const after = levels.map((l) => ({
      ...l,
      code: String(edits.valueOf(l, 'code') ?? '').trim(),
      name: String(edits.valueOf(l, 'name') ?? '').trim(),
      rank: Number(edits.valueOf(l, 'rank')),
    }))
    if (after.some((l) => !l.code || !l.name)) {
      setError('A level cannot be left without a code or a name. Put it back, or press Discard.')
      return
    }
    if (after.some((l) => !Number.isInteger(l.rank) || l.rank < 1)) {
      setError('Every rank must be a whole number of 1 or more.')
      return
    }
    const dup = (key) => after.find((l, i) =>
      after.some((o, j) => j !== i && String(o[key]).toLowerCase() === String(l[key]).toLowerCase()))
    if (dup('code')) {
      setError(`Two levels would both have the code "${dup('code').code}".`)
      return
    }
    if (dup('rank')) {
      setError(`Two levels would both have rank ${dup('rank').rank}.`)
      return
    }
    await act(`Saved ${changes.length} level${changes.length === 1 ? '' : 's'}.`, async () => {
      const rankMoves = changes.filter(({ patch }) => 'rank' in patch)
      // Step aside first, so a swap never collides with the unique rank.
      for (const { row } of rankMoves) {
        await run(supabase.from('employee_levels').update({ rank: -row.id }).eq('id', row.id))
      }
      for (const { row } of changes) {
        const next = after.find((l) => l.id === row.id)
        await run(
          supabase
            .from('employee_levels')
            .update({ code: next.code, name: next.name, rank: next.rank })
            .eq('id', row.id),
        )
      }
      if (rankMoves.length) await resequence(after)
      edits.discard()
    })
  }

  function remove(level) {
    if (!window.confirm(`Delete level ${level.code} (${level.name})?`)) return
    act(`Deleted level ${level.code}.`, () =>
      run(supabase.from('employee_levels').delete().eq('id', level.id)))
  }

  const cell = (level, field, extra = '') =>
    `py-1 text-sm ${extra} ${edits.isEdited(level, field) ? 'border-edge-warning' : ''}`

  return (
    <Card>
      <CardHeader
        title="Levels"
        subtitle={`${levels.length} levels, highest first. A higher rank is more senior; users see people ranked below them.`}
      />

      <div className="px-5">
        {readOnly && (
          <Alert tone="info" title="Read-only">
            Only a super admin can change the levels here.
          </Alert>
        )}
        {error && <Alert tone="error" onDismiss={() => setError(null)}>{error}</Alert>}
        {notice && <Alert tone="success" onDismiss={() => setNotice(null)}>{notice}</Alert>}
      </div>

      <div className="p-5">
        <div className="max-h-80 overflow-auto rounded-lg border border-line">
          <table className="w-full">
            <thead>
              <tr className="text-left text-xs text-ink-4">
                <th className="px-3 py-2 font-medium">Code</th>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Rank</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {levels.map((level) => (
                <tr key={level.id}>
                  <Td className="w-20">
                    <Input
                      aria-label="Level code"
                      value={edits.valueOf(level, 'code')}
                      disabled={readOnly || busy}
                      className={cell(level, 'code')}
                      onChange={(e) => edits.stage(level, { code: e.target.value })}
                    />
                  </Td>
                  <Td>
                    <Input
                      aria-label="Level name"
                      value={edits.valueOf(level, 'name')}
                      disabled={readOnly || busy}
                      className={cell(level, 'name')}
                      onChange={(e) => edits.stage(level, { name: e.target.value })}
                    />
                  </Td>
                  <Td className="w-20">
                    <Input
                      aria-label="Level rank"
                      type="number"
                      min="1"
                      step="1"
                      value={edits.valueOf(level, 'rank')}
                      disabled={readOnly || busy}
                      className={cell(level, 'rank', 'tabular')}
                      onChange={(e) =>
                        edits.stage(level, {
                          rank: e.target.value === '' ? '' : Number(e.target.value),
                        })
                      }
                    />
                  </Td>
                  <Td className="w-16 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={readOnly || busy}
                      onClick={() => remove(level)}
                    >
                      Delete
                    </Button>
                  </Td>
                </tr>
              ))}
              {levels.length === 0 && (
                <tr>
                  <Td className="text-sm text-ink-4">No levels yet.</Td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <form className="mt-3 flex flex-wrap gap-2" onSubmit={addLevel}>
          <Input
            placeholder="Code"
            aria-label="New level code"
            value={draft.code}
            disabled={readOnly || busy}
            onChange={(e) => setDraft({ ...draft, code: e.target.value })}
            className="w-20 py-1.5 text-sm"
          />
          <Input
            placeholder="Level name"
            aria-label="New level name"
            value={draft.name}
            disabled={readOnly || busy}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            className="min-w-0 flex-1 py-1.5 text-sm"
          />
          <Input
            placeholder="Rank"
            aria-label="New level rank"
            type="number"
            min="1"
            step="1"
            value={draft.rank}
            disabled={readOnly || busy}
            onChange={(e) => setDraft({ ...draft, rank: e.target.value })}
            className="w-20 py-1.5 text-sm"
          />
          <Button
            type="submit"
            size="sm"
            disabled={readOnly || busy || !draft.code.trim() || !draft.name.trim() || !draft.rank}
          >
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
          hint="Code, name and rank changes are saved here. Add and Delete happen straight away."
        />
      )}
    </Card>
  )
}

/** Postgres error codes, in words that say what to do about it. */
function explain(err) {
  const message = err?.message ?? String(err)
  if (message.includes('violates foreign key constraint')) {
    return 'Employees still hold that level. Move them to another level first.'
  }
  if (message.includes('duplicate key') || message.includes('already exists')) {
    return 'Another level already has that code or rank.'
  }
  if (message.includes('row-level security')) {
    return 'You are not allowed to change the levels.'
  }
  return message
}
