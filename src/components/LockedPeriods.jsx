import { useState } from 'react'
import { supabase, run } from '../lib/supabase'
import { useLocks, lockRangeLabel } from '../lib/useLocks'
import { payrollPeriod, payrollPeriodLabel, shiftPayrollPeriod } from '../lib/format'
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Field, Input, Spinner, Td, Th } from './ui'

/**
 * Closing a payroll period.
 *
 * Locking applies to everyone, the super admin who set it included: to
 * change a closed month you unlock it, edit, and lock it again. That is
 * the point -- a lock a privileged account can quietly write through is
 * not a control, and the reopening is worth having on the record.
 */
export default function LockedPeriods({ readOnly }) {
  const locks = useLocks()
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)

  // The period just gone is the one people close, not the one they are
  // still entering, so the form opens on last month.
  function startDraft() {
    const previous = shiftPayrollPeriod(payrollPeriod().to, -1)
    setDraft({
      from_date: previous.from,
      to_date: previous.to,
      note: `${payrollPeriodLabel(previous.to)} payroll closed`,
    })
    setError(null)
    setNotice(null)
  }

  async function lockPeriod(event) {
    event.preventDefault()
    if (draft.to_date < draft.from_date) {
      setError('The end date comes before the start date.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await run(
        supabase.from('locked_periods').insert({
          from_date: draft.from_date,
          to_date: draft.to_date,
          note: draft.note?.trim() || null,
        }),
      )
      setNotice(`Locked ${lockRangeLabel(draft)}.`)
      setDraft(null)
      locks.reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function unlock(lock) {
    const ok = window.confirm(
      `Unlock ${lockRangeLabel(lock)}?\n\n` +
        'Attendance and adjustments in these dates become editable again, and the monthly ' +
        'report for the period can change. Who reopened it is recorded.',
    )
    if (!ok) return
    setBusy(true)
    setError(null)
    try {
      // The database stamps who and when; sending unlocked_at is what
      // marks the row as the unlock rather than an edit.
      await run(
        supabase.from('locked_periods').update({ unlocked_at: new Date().toISOString() }).eq('id', lock.id),
      )
      setNotice(`Unlocked ${lockRangeLabel(lock)}.`)
      locks.reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader
        title="Locked periods"
        subtitle="Closed date ranges. Attendance and adjustments inside them cannot be added, changed or deleted by anyone."
        actions={
          !readOnly && (
            <Button size="sm" onClick={startDraft} disabled={busy || !!draft}>
              Lock a period
            </Button>
          )
        }
      />

      <div className="px-5">
        {error && <Alert tone="error" onDismiss={() => setError(null)}>{error}</Alert>}
        {notice && <Alert tone="success" onDismiss={() => setNotice(null)}>{notice}</Alert>}
        {locks.error && <Alert tone="error">{locks.error}</Alert>}
      </div>

      {draft && (
        <form className="grid gap-4 border-b border-line p-5 sm:grid-cols-4" onSubmit={lockPeriod}>
          <Field label="From" hint="Inclusive.">
            <Input
              type="date"
              required
              value={draft.from_date}
              onChange={(e) => setDraft((d) => ({ ...d, from_date: e.target.value }))}
            />
          </Field>
          <Field label="To" hint="Inclusive.">
            <Input
              type="date"
              required
              value={draft.to_date}
              onChange={(e) => setDraft((d) => ({ ...d, to_date: e.target.value }))}
            />
          </Field>
          <Field label="Note" className="sm:col-span-2" hint="Why it was closed, for whoever reads this later.">
            <Input
              value={draft.note ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
            />
          </Field>
          <div className="flex gap-2 sm:col-span-4">
            <Button type="submit" disabled={busy}>
              {busy ? 'Locking…' : 'Lock these dates'}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setDraft(null)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {locks.loading ? (
        <Spinner />
      ) : locks.all.length === 0 ? (
        <EmptyState title="No period has been locked">
          Locking a range freezes its attendance and adjustments, so a payroll month that has been
          paid cannot drift afterwards.
        </EmptyState>
      ) : (
        <div className="max-h-[50vh] overflow-auto">
          <table className="sticky-head w-full border-collapse">
            <thead>
              <tr>
                <Th>Period</Th>
                <Th>Status</Th>
                <Th>Note</Th>
                <Th>Locked by</Th>
                <Th>Unlocked by</Th>
                <Th />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {locks.all.map((lock) => {
                const open = !lock.unlocked_at
                return (
                  <tr key={lock.id} className={open ? 'bg-tint-warning/30' : 'hover:bg-hover'}>
                    <Td className="font-medium text-ink">{lockRangeLabel(lock)}</Td>
                    <Td>
                      <Badge tone={open ? 'amber' : 'slate'}>{open ? 'Locked' : 'Unlocked'}</Badge>
                    </Td>
                    <Td className="text-ink-3">{lock.note || '—'}</Td>
                    <Td className="text-ink-3">
                      {lock.locker?.name || '—'}
                      <div className="text-xs text-ink-4">{stamp(lock.locked_at)}</div>
                    </Td>
                    <Td className="text-ink-3">
                      {open ? (
                        '—'
                      ) : (
                        <>
                          {lock.unlocker?.name || '—'}
                          <div className="text-xs text-ink-4">{stamp(lock.unlocked_at)}</div>
                        </>
                      )}
                    </Td>
                    <Td className="text-right">
                      {open && !readOnly && (
                        <Button variant="ghost" size="sm" onClick={() => unlock(lock)} disabled={busy}>
                          Unlock
                        </Button>
                      )}
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="px-5 pb-5 pt-3 text-xs text-ink-4">
        A lock freezes records that carry a date — attendance and adjustments. It does not freeze
        employee details such as leave balances or payroll switches, which have no date on them, so
        changing one of those still affects what a closed period calculates.
      </p>
    </Card>
  )
}

function stamp(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
