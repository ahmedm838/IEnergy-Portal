import { useEffect, useState } from 'react'
import { supabase, run } from '../lib/supabase'
import SaveBar from './SaveBar'
import { Alert, Button, Card, CardHeader, Field, Input, Td, Th } from './ui'

/**
 * Salary taxes and the social insurance wage band, editable by a super admin.
 *
 * The portal's Salary Calculator reads both from app_settings when it
 * opens, so a change here is what the next calculation uses:
 *
 *   salary_tax_brackets  the annual progressive tax table, in order
 *   si_wage_min          lowest S.I. basic wage the calculator accepts
 *   si_wage_max          highest S.I. basic wage the calculator accepts
 *
 * Each bracket is { up_to, rate, all_from_above }:
 *   up_to           top of the bracket (annual taxable EGP); null on the last
 *   rate            percent charged inside the bracket
 *   all_from_above  when annual taxable income is ABOVE this, every bracket
 *                   before this one is charged at this bracket's rate
 *                   instead (Egypt removes the lower-band reliefs for
 *                   higher incomes). Blank means it never applies.
 *
 * The defaults below are exactly the table the calculator used to have
 * written into its code, so nothing changes until somebody edits it.
 */
export const DEFAULT_TAX_BRACKETS = [
  { up_to: 40000, rate: 0, all_from_above: null },
  { up_to: 55000, rate: 10, all_from_above: 600000 },
  { up_to: 70000, rate: 15, all_from_above: 700000 },
  { up_to: 200000, rate: 20, all_from_above: 800000 },
  { up_to: 400000, rate: 22.5, all_from_above: 900000 },
  { up_to: 1200000, rate: 25, all_from_above: 1200000 },
  { up_to: null, rate: 27.5, all_from_above: null },
]
export const DEFAULT_SI_MIN = 5500
export const DEFAULT_SI_MAX = 16700

const fmt = (n) => (n == null || n === '' ? '' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 }))
const num = (v) => {
  const s = String(v ?? '').replace(/,/g, '').trim()
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : NaN
}

const toDraft = (brackets) =>
  brackets.map((b) => ({
    up_to: b.up_to == null ? '' : fmt(b.up_to),
    rate: String(b.rate ?? ''),
    all_from_above: b.all_from_above == null ? '' : fmt(b.all_from_above),
  }))

export default function SalaryTaxCard({ readOnly }) {
  const [saved, setSaved] = useState(null)
  const [rows, setRows] = useState([])
  const [siMin, setSiMin] = useState('')
  const [siMax, setSiMax] = useState('')
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [busy, setBusy] = useState(false)

  async function load() {
    try {
      const data = await run(
        supabase
          .from('app_settings')
          .select('key, value')
          .in('key', ['salary_tax_brackets', 'si_wage_min', 'si_wage_max']),
      )
      const map = Object.fromEntries((data ?? []).map((r) => [r.key, r.value]))
      const brackets = Array.isArray(map.salary_tax_brackets) && map.salary_tax_brackets.length
        ? map.salary_tax_brackets
        : DEFAULT_TAX_BRACKETS
      const s = {
        rows: toDraft(brackets),
        siMin: fmt(map.si_wage_min ?? DEFAULT_SI_MIN),
        siMax: fmt(map.si_wage_max ?? DEFAULT_SI_MAX),
      }
      setSaved(s)
      setRows(s.rows)
      setSiMin(s.siMin)
      setSiMax(s.siMax)
    } catch (err) {
      setError(err.message)
    }
  }
  useEffect(() => { load() }, [])

  const changed = saved
    ? (JSON.stringify(rows) !== JSON.stringify(saved.rows) ? 1 : 0) +
      (siMin !== saved.siMin ? 1 : 0) +
      (siMax !== saved.siMax ? 1 : 0)
    : 0

  const setCell = (i, key, value) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [key]: value } : r)))

  function addRow() {
    // A new bracket goes just before the open-ended last one.
    setRows((rs) => {
      const copy = [...rs]
      copy.splice(Math.max(0, copy.length - 1), 0, { up_to: '', rate: '', all_from_above: '' })
      return copy
    })
  }
  const removeRow = (i) => setRows((rs) => rs.filter((_, j) => j !== i))

  /** The table and band as numbers, or a message saying what is wrong. */
  function parse() {
    if (rows.length === 0) return { problem: 'The tax table needs at least one bracket.' }
    const brackets = []
    let prev = 0
    for (let i = 0; i < rows.length; i++) {
      const last = i === rows.length - 1
      const upTo = num(rows[i].up_to)
      const rate = num(rows[i].rate)
      const above = num(rows[i].all_from_above)
      const n = i + 1
      if (last) {
        if (upTo !== null) return { problem: `The last bracket has no upper limit — leave its "To" blank.` }
      } else {
        if (upTo === null || Number.isNaN(upTo)) return { problem: `Bracket ${n} needs a "To" amount.` }
        if (upTo <= prev) return { problem: `Bracket ${n}'s "To" must be more than ${fmt(prev)}.` }
      }
      if (rate === null || Number.isNaN(rate) || rate < 0 || rate > 100) {
        return { problem: `Bracket ${n} needs a rate between 0 and 100%.` }
      }
      if (Number.isNaN(above) || (above !== null && above < 0)) {
        return { problem: `Bracket ${n}'s "Whole income at this rate above" must be a positive amount or blank.` }
      }
      brackets.push({ up_to: last ? null : upTo, rate, all_from_above: above })
      if (!last) prev = upTo
    }
    const min = num(siMin)
    const max = num(siMax)
    if (min === null || Number.isNaN(min) || min <= 0) return { problem: 'Enter the minimum social insurance wage.' }
    if (max === null || Number.isNaN(max) || max <= 0) return { problem: 'Enter the maximum social insurance wage.' }
    if (max <= min) return { problem: 'The maximum social insurance wage must be more than the minimum.' }
    return { brackets, min, max }
  }

  async function save() {
    const parsed = parse()
    if (parsed.problem) {
      setError(parsed.problem)
      return
    }
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await run(
        supabase.from('app_settings').upsert(
          [
            { key: 'salary_tax_brackets', value: parsed.brackets, description: 'Salary Calculator: annual progressive tax brackets' },
            { key: 'si_wage_min', value: parsed.min, description: 'Salary Calculator: minimum S.I. basic wage' },
            { key: 'si_wage_max', value: parsed.max, description: 'Salary Calculator: maximum S.I. basic wage' },
          ],
          { onConflict: 'key' },
        ),
      )
      setNotice('Saved. The Salary Calculator uses the new table and wage limits the next time it opens.')
      await load()
    } catch (err) {
      setError(err.message.includes('row-level security')
        ? 'Only a super admin can change salary taxes.'
        : err.message)
    } finally {
      setBusy(false)
    }
  }

  const disabled = readOnly || busy || !saved
  const fromOf = (i) => (i === 0 ? 0 : num(rows[i - 1]?.up_to))

  return (
    <Card>
      <CardHeader
        title="Salary taxes"
        subtitle="Used by the Salary Calculator. Amounts are annual taxable income in EGP. A bracket's “whole income at this rate above” removes the lower-band reliefs: when income is above that amount, every earlier bracket is charged at this bracket's rate."
      />
      <div className="px-5">
        {readOnly && (
          <Alert tone="info" title="Read-only">
            Only a super admin can change salary taxes and the social insurance wage limits.
          </Alert>
        )}
        {error && <Alert tone="error" onDismiss={() => setError(null)}>{error}</Alert>}
        {notice && <Alert tone="success" onDismiss={() => setNotice(null)}>{notice}</Alert>}
      </div>

      <div className="grid gap-4 px-5 pt-5 sm:grid-cols-2">
        <Field label="Minimum social insurance wage (EGP)" hint="The calculator refuses an S.I. basic wage below this.">
          <Input
            inputMode="decimal"
            className="tabular"
            value={siMin}
            disabled={disabled}
            onChange={(e) => setSiMin(e.target.value)}
            onBlur={() => { const n = num(siMin); if (Number.isFinite(n)) setSiMin(fmt(n)) }}
          />
        </Field>
        <Field label="Maximum social insurance wage (EGP)" hint="The calculator refuses an S.I. basic wage above this.">
          <Input
            inputMode="decimal"
            className="tabular"
            value={siMax}
            disabled={disabled}
            onChange={(e) => setSiMax(e.target.value)}
            onBlur={() => { const n = num(siMax); if (Number.isFinite(n)) setSiMax(fmt(n)) }}
          />
        </Field>
      </div>

      <div className="p-5">
        <div className="overflow-auto rounded-lg border border-line">
          <table className="w-full">
            <thead>
              <tr>
                <Th className="w-10">#</Th>
                <Th>From (EGP)</Th>
                <Th>To (EGP)</Th>
                <Th className="w-28">Rate (%)</Th>
                <Th>Whole income at this rate above (EGP)</Th>
                <Th />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r, i) => {
                const last = i === rows.length - 1
                const from = fromOf(i)
                return (
                  <tr key={i}>
                    <Td className="tabular">{i + 1}</Td>
                    <Td className="tabular text-ink-3">
                      {Number.isFinite(from) ? (i === 0 ? '0' : `${fmt(from)}`) : '—'}
                    </Td>
                    <Td>
                      {last ? (
                        <span className="text-ink-4">No limit</span>
                      ) : (
                        <Input
                          inputMode="decimal"
                          className="py-1 text-right text-sm tabular"
                          value={r.up_to}
                          disabled={disabled}
                          onChange={(e) => setCell(i, 'up_to', e.target.value)}
                          onBlur={() => { const n = num(r.up_to); if (Number.isFinite(n)) setCell(i, 'up_to', fmt(n)) }}
                        />
                      )}
                    </Td>
                    <Td>
                      <Input
                        inputMode="decimal"
                        className="py-1 text-right text-sm tabular"
                        value={r.rate}
                        disabled={disabled}
                        onChange={(e) => setCell(i, 'rate', e.target.value)}
                      />
                    </Td>
                    <Td>
                      <Input
                        inputMode="decimal"
                        className="py-1 text-right text-sm tabular"
                        placeholder="Never"
                        value={r.all_from_above}
                        disabled={disabled}
                        onChange={(e) => setCell(i, 'all_from_above', e.target.value)}
                        onBlur={() => { const n = num(r.all_from_above); if (Number.isFinite(n)) setCell(i, 'all_from_above', fmt(n)) }}
                      />
                    </Td>
                    <Td className="w-20 text-right">
                      {!readOnly && rows.length > 1 && (
                        <Button variant="ghost" size="sm" disabled={disabled} onClick={() => removeRow(i)}>
                          Remove
                        </Button>
                      )}
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {!readOnly && (
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" disabled={disabled} onClick={addRow}>Add bracket</Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => setRows(toDraft(DEFAULT_TAX_BRACKETS))}
            >
              Restore the 2026 table
            </Button>
          </div>
        )}
      </div>

      {!readOnly && (
        <SaveBar
          count={changed}
          busy={busy}
          onSave={save}
          onDiscard={() => { setRows(saved.rows); setSiMin(saved.siMin); setSiMax(saved.siMax) }}
          hint="Salary taxes and the S.I. wage limits are saved together."
        />
      )}
    </Card>
  )
}
