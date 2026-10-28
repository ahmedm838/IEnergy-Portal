import { useMemo, useState } from 'react'
import { supabase, run } from '../lib/supabase'
import { useEmployees } from '../lib/useLookups'
import { setTemporaryPassword, generateTemporaryPassword } from '../lib/invites'
import { usePendingEdits } from '../lib/usePendingEdits'
import SaveBar from './SaveBar'
import { Alert, Badge, Button, Card, CardHeader, Field, Input, Select, Td, Th } from './ui'

const ROLES = [
  ['no_access', 'No access', 'Cannot sign in to anything.'],
  ['user', 'User', 'Read-only, and only their own department.'],
  ['admin', 'Admin', 'Attendance, adjustments, employees and reports.'],
  ['super_admin', 'Super admin', 'Everything, including this page.'],
]

const LABEL = Object.fromEntries(ROLES.map(([value, label]) => [value, label]))

/**
 * Who may do what.
 *
 * Every employee starts with no access -- that is the column default in
 * the database, so a record created in the portal's Database page grants
 * nothing by existing. Access is given here, deliberately, by a super
 * admin, and this page is the only place in either app where a role can
 * be changed.
 *
 * The database has the final say regardless: granting or removing admin
 * and super admin is refused to anyone who is not a super admin, and the
 * last active super admin cannot be demoted.
 *
 * Passwords are set from here too. Handing somebody a password is the
 * same act as giving them a role -- it is what turns a personnel record
 * into an account that can sign in -- so the two belong on one page
 * rather than one here and one on a list of employees.
 */
export default function AccessCard({ readOnly }) {
  const { employees, loading, reload } = useEmployees({ activeOnly: false })
  const [search, setSearch] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [passwordFor, setPasswordFor] = useState(null)
  const [saving, setSaving] = useState(false)
  const edits = usePendingEdits()

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const list = [...employees].sort((a, b) => a.code - b.code)
    if (!needle) return list
    return list.filter(
      (e) =>
        e.name.toLowerCase().includes(needle) ||
        String(e.code).includes(needle) ||
        (e.email ?? '').toLowerCase().includes(needle),
    )
  }, [employees, search])

  const counts = useMemo(() => {
    const out = Object.fromEntries(ROLES.map(([value]) => [value, 0]))
    for (const e of employees) out[e.role] = (out[e.role] ?? 0) + 1
    return out
  }, [employees])

  /**
   * Save the roles that were changed.
   *
   * The warning about granting admin or super admin used to appear the
   * moment the dropdown moved. It belongs here instead: choosing a role
   * does nothing on its own now, so asking then would be asking about
   * something that has not happened -- and asking once per row would be
   * three dialogs for three people. Every grant is listed in one, at the
   * moment it is about to be real.
   */
  async function saveRoles() {
    const changes = edits.pending(employees)
    if (changes.length === 0) return

    const grants = changes.filter(
      ({ patch }) => patch.role === 'admin' || patch.role === 'super_admin',
    )
    if (grants.length > 0) {
      const lines = grants.map(({ row, patch }) => `  - ${row.name} to ${LABEL[patch.role]}`)
      const anySuper = grants.some(({ patch }) => patch.role === 'super_admin')
      const warning = anySuper
        ? 'A super admin can change every setting here, lock and unlock payroll periods, and grant this role to others.'
        : 'An admin can record attendance and adjustments for everyone and edit employee records.'
      if (!window.confirm(`Grant these roles?\n\n${lines.join('\n')}\n\n${warning}`)) return
    }

    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      for (const { row, patch } of changes) {
        await run(supabase.from('employees').update({ role: patch.role }).eq('id', row.id))
      }
      edits.discard()
      setNotice(
        changes.length === 1
          ? `${changes[0].row.name} is now ${LABEL[changes[0].patch.role]}.`
          : `Saved ${changes.length} role changes.`,
      )
      reload()
    } catch (err) {
      setError(explain(err))
    } finally {
      setSaving(false)
    }
  }

  async function savePassword(employee, password) {
    setBusyId(employee.id)
    setError(null)
    setNotice(null)
    try {
      const result = await setTemporaryPassword(employee.id, password)
      setNotice(result.message)
      setPasswordFor(null)
      reload()
    } catch (err) {
      setError(explain(err))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Card>
      <CardHeader
        title="Access"
        subtitle="New employees start with no access. Give it here."
        actions={
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, code or email"
            className="w-64 py-1.5 text-sm"
          />
        }
      />

      <div className="px-5">
        {readOnly && (
          <Alert tone="info" title="Read-only">
            Only a super admin can change who has access. The database refuses it from anyone
            else, so this is showing you the roles rather than hiding them.
          </Alert>
        )}
        {error && <Alert tone="error" onDismiss={() => setError(null)}>{error}</Alert>}
        {notice && <Alert tone="success" onDismiss={() => setNotice(null)}>{notice}</Alert>}
      </div>

      {passwordFor && (
        <TemporaryPassword
          employee={passwordFor}
          busy={busyId === passwordFor.id}
          onCancel={() => setPasswordFor(null)}
          onSave={(password) => savePassword(passwordFor, password)}
        />
      )}

      <div className="flex flex-wrap gap-2 px-5 pb-3 pt-1">
        {ROLES.map(([value, label]) => (
          <Badge key={value} tone={value === 'no_access' ? 'slate' : value === 'user' ? 'blue' : 'amber'}>
            {label}: {counts[value] ?? 0}
          </Badge>
        ))}
      </div>

      {loading ? (
        <div className="px-5 pb-5 text-sm text-ink-3">Loading employees…</div>
      ) : (
        <div className="max-h-[32rem] overflow-auto">
          <table className="sticky-head w-full border-collapse">
            <thead>
              <tr>
                <Th className="w-24">Code</Th>
                <Th>Name</Th>
                <Th>Can sign in</Th>
                <Th className="w-56">Role</Th>
                <Th className="w-32 text-right">Password</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((e) => (
                <tr key={e.id} className={e.is_active ? 'hover:bg-hover' : 'bg-subtle/50 opacity-70'}>
                  <Td className="tabular">{e.code}</Td>
                  <Td className="font-medium text-ink">
                    {e.name}
                    {!e.is_active && <span className="ml-2 text-xs text-ink-4">(deactivated)</span>}
                  </Td>
                  <Td className="text-ink-3">
                    {e.auth_user_id ? (
                      e.email ?? 'yes'
                    ) : (
                      <span className="text-ink-4">no sign-in yet</span>
                    )}
                  </Td>
                  <Td>
                    <Select
                      value={edits.valueOf(e, 'role')}
                      disabled={readOnly || busyId === e.id || saving}
                      className={`py-1 text-sm ${
                        edits.isEdited(e, 'role') ? 'border-edge-warning' : ''
                      }`}
                      onChange={(event) => edits.stage(e, { role: event.target.value })}
                    >
                      {ROLES.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </Select>
                  </Td>
                  <Td className="text-right">
                    {/* No email, no account to give a password to. */}
                    {e.email ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={readOnly || busyId === e.id}
                        onClick={() => setPasswordFor(e)}
                      >
                        Set password
                      </Button>
                    ) : (
                      <span className="text-xs text-ink-4">no email</span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="px-5 pb-5 pt-3 text-xs text-ink-4">
        {ROLES.map(([value, label, description]) => (
          <span key={value} className="mr-3 inline-block">
            <strong className="text-ink-3">{label}:</strong> {description}
          </span>
        ))}
      </p>

      {!readOnly && (
        <SaveBar
          count={edits.count}
          busy={saving}
          onSave={saveRoles}
          onDiscard={edits.discard}
          hint="Role changes are saved here. Setting a password happens straight away."
        />
      )}
    </Card>
  )
}

/**
 * Hands a super admin a temporary password to pass on in person.
 *
 * It is shown in plain text on purpose -- the whole point is that it has
 * to be read out -- and it is useless after first sign-in, because the
 * account is flagged to force the employee to choose their own.
 */
function TemporaryPassword({ employee, busy, onCancel, onSave }) {
  const [password, setPassword] = useState(() => generateTemporaryPassword())
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(password)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard access can be refused; the password is on screen anyway.
    }
  }

  return (
    <div className="mx-5 mb-4 rounded-xl border border-line bg-subtle/60 p-4">
      <div className="mb-3 text-sm font-semibold text-ink">
        Temporary password for {employee.name}
      </div>
      <p className="mb-3 text-xs text-ink-3">
        They sign in as {employee.username ?? employee.email} and must choose their own
        password immediately.
      </p>
      <form
        className="grid gap-3 sm:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault()
          onSave(password)
        }}
      >
        <Field
          label="Temporary password"
          className="sm:col-span-2"
          hint="At least 8 characters. Write it down before saving — it is not shown again."
        >
          <Input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="font-mono"
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
        <div className="flex items-end gap-2">
          <Button type="button" variant="secondary" onClick={() => setPassword(generateTemporaryPassword())}>
            Regenerate
          </Button>
          <Button type="button" variant="secondary" onClick={copy}>
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
        <div className="flex gap-2 sm:col-span-3">
          <Button type="submit" disabled={busy || password.length < 8}>
            {busy ? 'Saving…' : 'Set password'}
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  )
}

function explain(err) {
  const message = err?.message ?? String(err)
  if (message.includes('super admin')) {
    return 'Only a super admin can grant or remove the admin and super admin roles.'
  }
  if (message.includes('active admin') || message.includes('ensure_admin_remains')) {
    return 'That would leave the system with no super admin, which nothing could undo from inside the app.'
  }
  if (message.includes('row-level security')) {
    return 'Your account is not allowed to change roles.'
  }
  return message
}
