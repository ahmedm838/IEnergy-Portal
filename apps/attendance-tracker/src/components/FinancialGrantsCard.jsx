import { useState } from 'react'
import { supabase, run } from '../lib/supabase'
import { usePendingEdits } from '../lib/usePendingEdits'
import SaveBar from './SaveBar'
import { Alert, Button, Card, CardHeader, Input, Td, Th } from './ui'

/**
 * Financial grants, editable by a super admin.
 *
 * The grants an employee can ask for on the financial grant request
 * (طلب صرف منحة مالية) in the portal's Employee Documents. Picking one
 * there fills in its amount and its attachments, so what is written here
 * is what the form prints: the name and attachments in Arabic, the amount
 * in Egyptian pounds.
 *
 * Every signed-in user reads the table (the form needs it); only a super
 * admin can change it, which the database enforces as well.
 */
export default function FinancialGrantsCard({ lookups, readOnly }) {
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [busy, setBusy] = useState(false)
  const blank = { name: '', amount: '', attachments: '' }
  const [draft, setDraft] = useState(blank)
  const edits = usePendingEdits()

  const grants = lookups.financialGrants ?? []

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

  /* An amount as typed: digits, an optional point and up to two decimals,
     thousands commas allowed. Null when it is not one. */
  const toAmount = (text) => {
    const v = String(text ?? '').replace(/,/g, '').trim()
    return /^\d{1,10}(\.\d{1,2})?$/.test(v) && Number(v) > 0 ? Number(v) : null
  }

  /* What is wrong with a grant as it stands, or null. */
  function problem({ name, amount, attachments }) {
    if (!String(name ?? '').trim()) return 'A grant needs a name.'
    if (toAmount(amount) === null) return 'The amount must be a number above zero, e.g. 5000 or 5000.50.'
    if (!String(attachments ?? '').trim()) return 'Say which attachments the grant needs.'
    return null
  }

  function addGrant(event) {
    event.preventDefault()
    const wrong = problem(draft)
    if (wrong) {
      setError(wrong)
      return
    }
    const sortOrder = Math.max(0, ...grants.map((g) => g.sort_order ?? 0)) + 1
    act(`Added the grant "${draft.name.trim()}".`, async () => {
      await run(
        supabase.from('financial_grants').insert({
          name: draft.name.trim(),
          amount: toAmount(draft.amount),
          attachments: draft.attachments.trim(),
          sort_order: sortOrder,
        }),
      )
      setDraft(blank)
    })
  }

  /* Edits wait for Save. Adding and removing do not: both are already a
     press of their own button, and remove asks first. */
  async function saveEdits() {
    const changes = edits.pending(grants)
    for (const { row } of changes) {
      const now = {
        name: edits.valueOf(row, 'name'),
        amount: edits.valueOf(row, 'amount'),
        attachments: edits.valueOf(row, 'attachments'),
      }
      const wrong = problem(now)
      if (wrong) {
        setError(`${row.name}: ${wrong}`)
        return
      }
    }
    await act(`Saved ${changes.length} grant${changes.length === 1 ? '' : 's'}.`, async () => {
      for (const { row, patch } of changes) {
        const values = {}
        if ('name' in patch) values.name = patch.name.trim()
        if ('amount' in patch) values.amount = toAmount(patch.amount)
        if ('attachments' in patch) values.attachments = patch.attachments.trim()
        await run(supabase.from('financial_grants').update(values).eq('id', row.id))
      }
      edits.discard()
    })
  }

  function remove(grant) {
    if (!window.confirm(`Remove the grant "${grant.name}"?`)) return
    act(`Removed the grant "${grant.name}".`, () =>
      run(supabase.from('financial_grants').delete().eq('id', grant.id)))
  }

  const edited = (row, field) => (edits.isEdited(row, field) ? 'border-edge-warning' : '')

  return (
    <Card>
      <CardHeader
        title="Financial grants"
        subtitle={`${grants.length} grant${grants.length === 1 ? '' : 's'}. Employees pick one on the financial grant request in Employee Documents, which fills in its amount and attachments.`}
      />

      <div className="px-5">
        {readOnly && (
          <Alert tone="info" title="Read-only">
            Only a super admin can add, edit or remove financial grants.
          </Alert>
        )}
        {error && <Alert tone="error" onDismiss={() => setError(null)}>{error}</Alert>}
        {notice && <Alert tone="success" onDismiss={() => setNotice(null)}>{notice}</Alert>}
      </div>

      <div className="p-5">
        <div className="max-h-96 overflow-auto rounded-lg border border-line">
          <table className="sticky-head w-full">
            <thead>
              <tr>
                <Th>Name</Th>
                <Th className="w-40">Amount (EGP)</Th>
                <Th>Attachments</Th>
                <Th />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {grants.map((g) => (
                <tr key={g.id}>
                  <Td>
                    <Input
                      dir="rtl"
                      lang="ar"
                      value={edits.valueOf(g, 'name')}
                      disabled={readOnly || busy}
                      className={`py-1 text-sm ${edited(g, 'name')}`}
                      onChange={(e) => edits.stage(g, { name: e.target.value })}
                    />
                  </Td>
                  <Td>
                    <Input
                      inputMode="decimal"
                      value={String(edits.valueOf(g, 'amount') ?? '')}
                      disabled={readOnly || busy}
                      className={`py-1 text-right text-sm tabular ${edited(g, 'amount')}`}
                      onChange={(e) => edits.stage(g, { amount: e.target.value })}
                    />
                  </Td>
                  <Td>
                    <Input
                      dir="rtl"
                      lang="ar"
                      value={edits.valueOf(g, 'attachments')}
                      disabled={readOnly || busy}
                      className={`py-1 text-sm ${edited(g, 'attachments')}`}
                      onChange={(e) => edits.stage(g, { attachments: e.target.value })}
                    />
                  </Td>
                  <Td className="w-20 text-right">
                    {!readOnly && (
                      <Button variant="ghost" size="sm" disabled={busy} onClick={() => remove(g)}>
                        Remove
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
              {grants.length === 0 && (
                <tr>
                  <Td className="text-sm text-ink-4" colSpan={4}>
                    No grants yet. Until one is added, the financial grant request has nothing to
                    pick.
                  </Td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {!readOnly && (
          <form className="mt-3 grid gap-2 lg:grid-cols-[1fr_10rem_1.5fr_auto]" onSubmit={addGrant}>
            <Input
              dir="rtl"
              lang="ar"
              placeholder="اسم المنحة"
              value={draft.name}
              disabled={busy}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              className="py-1.5 text-sm"
            />
            <Input
              inputMode="decimal"
              placeholder="Amount"
              value={draft.amount}
              disabled={busy}
              onChange={(e) => setDraft((d) => ({ ...d, amount: e.target.value }))}
              className="py-1.5 text-right text-sm tabular"
            />
            <Input
              dir="rtl"
              lang="ar"
              placeholder="المرفقات المطلوبة"
              value={draft.attachments}
              disabled={busy}
              onChange={(e) => setDraft((d) => ({ ...d, attachments: e.target.value }))}
              className="py-1.5 text-sm"
            />
            <Button
              type="submit"
              size="sm"
              disabled={busy || !draft.name.trim() || !draft.amount.trim() || !draft.attachments.trim()}
            >
              Add
            </Button>
          </form>
        )}
      </div>

      {!readOnly && (
        <SaveBar
          count={edits.count}
          busy={busy}
          onSave={saveEdits}
          onDiscard={edits.discard}
          hint="Edits are saved here. Add and Remove happen straight away."
        />
      )}
    </Card>
  )
}

/** Postgres error codes, in words that say what to do about it. */
function explain(err) {
  const message = err?.message ?? String(err)
  if (message.includes('duplicate key') || message.includes('already exists')) {
    return 'There is already a grant with that name.'
  }
  if (message.includes('row-level security')) {
    return 'Only a super admin can change financial grants.'
  }
  if (message.includes('check constraint')) {
    return 'Every grant needs a name, an amount above zero and its attachments.'
  }
  return message
}
