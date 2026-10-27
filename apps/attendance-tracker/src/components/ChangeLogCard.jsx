import { useState } from 'react'
import { supabase, run } from '../lib/supabase'
import { exportSheet } from '../lib/exportXlsx'
import { toISODate, longDateLabel } from '../lib/format'
import { Alert, Button, Card, CardHeader, Field, Input } from './ui'

/** The first day of the month n months before today, and today. */
function defaultRange() {
  const today = new Date()
  const from = new Date(today.getFullYear(), today.getMonth() - 1, today.getDate())
  return { from: toISODate(from), to: toISODate(today) }
}

/**
 * Export the change log.
 *
 * The log records who changed what, when, and what it was before --
 * written by a database trigger on attendance, adjustments, employees
 * and the settings themselves, so it cannot be edited from here or
 * anywhere else in the app. This card only reads it out.
 *
 * It is deliberately an export rather than a table on screen. The
 * question people bring to a change log is "what happened to this
 * person in this period", which is a filter-and-sort job, and a
 * spreadsheet does that better than a page of rows nobody can pivot.
 */
export default function ChangeLogCard() {
  const [range, setRange] = useState(defaultRange)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)

  async function exportLog() {
    setError(null)
    setNotice(null)
    if (range.from > range.to) {
      setError('The first date must be on or before the second.')
      return
    }
    setBusy(true)
    try {
      const rows = await run(
        supabase.rpc('report_audit_log', { p_from: range.from, p_to: range.to }),
      )
      if (!rows?.length) {
        // Not an error: an empty period is a real answer, and the log
        // only holds changes made since it was switched on.
        setNotice(
          `No changes recorded between ${longDateLabel(range.from)} and ${longDateLabel(range.to)}.`,
        )
        return
      }
      await exportSheet(
        {
          title: 'Change log',
          subtitle: `${longDateLabel(range.from)} to ${longDateLabel(range.to)}`,
          sheetName: 'Change log',
          meta: [['Changes', rows.length]],
          columns: [
            { header: 'Date', key: 'changed_on' },
            { header: 'Time', key: 'changed_at' },
            { header: 'Signed-in user', key: 'actor' },
            { header: 'Role', key: 'actor_role' },
            { header: 'Action', key: 'action' },
            { header: 'Record', key: 'record' },
            { header: 'Employee code', key: 'employee_code', numFmt: '0' },
            { header: 'Employee', key: 'employee_name' },
            { header: 'Change made', key: 'change' },
          ],
          rows,
        },
        `change-log-${range.from}_${range.to}.xlsx`,
      )
      setNotice(`Exported ${rows.length} change${rows.length === 1 ? '' : 's'}.`)
    } catch (e) {
      setError(e.message ?? String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader
        title="Change log"
        subtitle="Who changed what, when, and what it was before. Recorded by the database on attendance, adjustments, employee records and these settings."
      />
      <div className="grid gap-4 p-5 sm:grid-cols-[repeat(2,minmax(0,160px))_auto] sm:items-end">
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
        <div>
          <Button onClick={exportLog} disabled={busy}>
            {busy ? 'Exporting…' : 'Export log (Excel)'}
          </Button>
        </div>
      </div>

      {error && (
        <div className="px-5 pb-4">
          <Alert tone="error" onDismiss={() => setError(null)}>{error}</Alert>
        </div>
      )}
      {notice && (
        <div className="px-5 pb-4">
          <Alert tone="info" onDismiss={() => setNotice(null)}>{notice}</Alert>
        </div>
      )}

      <p className="px-5 pb-5 pt-1 text-xs text-ink-4">
        The log starts from the day it was switched on. Changes made before that were never
        recorded anywhere — the tables only ever kept who touched a row last, overwritten by the
        next edit — so they cannot be shown here or recovered.
      </p>
    </Card>
  )
}
