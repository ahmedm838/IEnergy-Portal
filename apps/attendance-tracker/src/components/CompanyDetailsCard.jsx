import { useEffect, useState } from 'react'
import { supabase, run } from '../lib/supabase'
import SaveBar from './SaveBar'
import { Alert, Card, CardHeader, Field, Input } from './ui'

/**
 * Company details, editable by a super admin.
 *
 * What the forms print about the company. Form 1 Social Insurance (طلب
 * اشتراك مؤمن عليه) in the portal's HR Documents takes the office, the
 * establishment number, the Arabic name and the address from here, so
 * they are written as the form should print them: in Arabic, the number
 * in digits.
 *
 * One row (id 1). Everyone signed in reads it; only a super admin can
 * change it, which the database enforces as well.
 */
const FIELDS = [
  ['name_ar', 'Company name (Arabic)', 'اسم المنشأة, as printed on the forms.'],
  ['si_office', 'Social insurance office (مكتب)', 'The office the company is registered with.'],
  ['establishment_no', 'Establishment number (رقم المنشأة)', 'Its insurance number: up to 8 digits.'],
  ['address_ar', 'Company address (Arabic)', 'العنوان, as printed on the back of Form 1.'],
]

export default function CompanyDetailsCard({ readOnly }) {
  const [saved, setSaved] = useState(null)
  const [draft, setDraft] = useState({})
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [busy, setBusy] = useState(false)

  async function load() {
    try {
      const rows = await run(supabase.from('company_details').select('*').eq('id', 1))
      const row = rows?.[0] ?? {}
      setSaved(row)
      setDraft(Object.fromEntries(FIELDS.map(([k]) => [k, row[k] ?? ''])))
    } catch (err) {
      setError(explain(err))
    }
  }
  useEffect(() => { load() }, [])

  const changed = saved ? FIELDS.filter(([k]) => (draft[k] ?? '') !== (saved[k] ?? '')).length : 0

  /* What is wrong with the details as typed, or null. */
  function problem(v) {
    if (!String(v.name_ar ?? '').trim()) return 'The company needs a name.'
    const no = String(v.establishment_no ?? '').trim()
    if (no && !/^\d{1,8}$/.test(no)) return 'The establishment number is digits only, up to 8 of them.'
    return null
  }

  async function save() {
    const wrong = problem(draft)
    if (wrong) {
      setError(wrong)
      return
    }
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const values = Object.fromEntries(FIELDS.map(([k]) => {
        const v = String(draft[k] ?? '').trim()
        return [k, v === '' && k !== 'name_ar' ? null : v]
      }))
      values.updated_at = new Date().toISOString()
      await run(supabase.from('company_details').update(values).eq('id', 1))
      setNotice('Saved the company details.')
      await load()
    } catch (err) {
      setError(explain(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader
        title="Company details"
        subtitle="Printed on Form 1 Social Insurance in HR Documents: the office, the establishment number, the company name and its address."
      />
      <div className="px-5">
        {readOnly && (
          <Alert tone="info" title="Read-only">
            Only a super admin can change the company details.
          </Alert>
        )}
        {error && <Alert tone="error" onDismiss={() => setError(null)}>{error}</Alert>}
        {notice && <Alert tone="success" onDismiss={() => setNotice(null)}>{notice}</Alert>}
      </div>
      <div className="grid gap-4 p-5 sm:grid-cols-2">
        {FIELDS.map(([key, label, hint]) => (
          <Field key={key} label={label} hint={hint} className={key === 'address_ar' ? 'sm:col-span-2' : ''}>
            <Input
              value={draft[key] ?? ''}
              dir={key === 'establishment_no' ? 'ltr' : 'rtl'}
              inputMode={key === 'establishment_no' ? 'numeric' : undefined}
              maxLength={key === 'establishment_no' ? 8 : undefined}
              disabled={readOnly || busy || !saved}
              onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
            />
          </Field>
        ))}
      </div>
      {!readOnly && (
        <SaveBar
          count={changed}
          busy={busy}
          onSave={save}
          onDiscard={() => setDraft(Object.fromEntries(FIELDS.map(([k]) => [k, saved[k] ?? ''])))}
          hint="The company details are saved here."
        />
      )}
    </Card>
  )
}

/** Postgres errors, in words that say what to do about it. */
function explain(err) {
  const message = err?.message ?? String(err)
  if (message.includes('row-level security')) return 'Only a super admin can change the company details.'
  if (message.includes('check constraint')) return 'The establishment number is digits only, up to 8 of them.'
  if (message.includes('company_details') && message.includes('does not exist')) {
    return 'The company details table is not in the database yet.'
  }
  return message
}
