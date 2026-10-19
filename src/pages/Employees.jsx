import { useMemo, useState } from 'react'
import { supabase, run } from '../lib/supabase'
import { useLookups, useEmployees } from '../lib/useLookups'
import { useAuth } from '../lib/auth'
import { setTemporaryPassword, generateTemporaryPassword } from '../lib/invites'
import { mobileDigits } from '../lib/format'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Checkbox,
  EmptyState,
  Field,
  Input,
  Select,
  Spinner,
  Td,
  Th,
} from '../components/ui'

export default function Employees() {
  const lookups = useLookups()
  const { isSuperAdmin } = useAuth()
  const { employees, loading, error, reload } = useEmployees({ activeOnly: false })

  const [search, setSearch] = useState('')
  const [formError, setFormError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [passwordFor, setPasswordFor] = useState(null)

  async function handleSetPassword(employee, password) {
    setFormError(null)
    setNotice(null)
    setBusyId(employee.id)
    try {
      const result = await setTemporaryPassword(employee.id, password)
      setNotice(result.message)
      setPasswordFor(null)
      reload()
    } catch (err) {
      setFormError(err.message)
    } finally {
      setBusyId(null)
    }
  }

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return employees
    return employees.filter(
      (e) =>
        e.name.toLowerCase().includes(needle) ||
        String(e.code).includes(needle) ||
        (e.email ?? '').toLowerCase().includes(needle) ||
        (e.username ?? '').toLowerCase().includes(needle) ||
        // Numbers are stored with dashes, so match on digits too --
        // otherwise typing a number straight off a phone finds nothing.
        (e.company_mobile ?? '').toLowerCase().includes(needle) ||
        (mobileDigits(needle).length > 0 &&
          mobileDigits(e.company_mobile).includes(mobileDigits(needle))) ||
        (e.office_number ?? '').toLowerCase().includes(needle) ||
        (e.departments?.name ?? '').toLowerCase().includes(needle),
    )
  }, [employees, search])

  if (lookups.loading || loading) return <Spinner />

  return (
    <div className="grid grid-cols-1 gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Employees</h1>
          <p className="mt-0.5 text-sm text-ink-3">
            {employees.length} records. Role and the Y/N switches drive access and payroll.
          </p>
          {!isSuperAdmin && (
            <p className="mt-1 text-xs text-ink-4">
              Passwords are set by a super admin. There is no email reset.
            </p>
          )}
        </div>
        {/* Adding an employee happens in the portal's Database page, which
            holds the full personnel record -- national ID, insurance
            details, documents. Creating a half-filled row here and then
            completing it somewhere else is how records end up incomplete,
            so this page edits only what it already shows. */}
        <a
          className="text-sm font-medium text-brand-600 underline-offset-2 hover:underline dark:text-brand-400"
          href="https://ahmedm838.github.io/IEnergy-Portal/employee-database/"
          target="_blank"
          rel="noreferrer"
        >
          Add an employee in the Database page ↗
        </a>
      </div>

      {error && <Alert tone="error">{error}</Alert>}
      {formError && <Alert tone="error" onDismiss={() => setFormError(null)}>{formError}</Alert>}
      {notice && <Alert tone="success" onDismiss={() => setNotice(null)}>{notice}</Alert>}

      {passwordFor && (
        <TemporaryPasswordForm
          employee={passwordFor}
          busy={busyId === passwordFor.id}
          onCancel={() => setPasswordFor(null)}
          onSave={(password) => handleSetPassword(passwordFor, password)}
        />
      )}

      <Card>
        <CardHeader
          title="All employees"
          actions={
            <Input
              placeholder="Search name, code, email, department…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-72"
            />
          }
        />
        {filtered.length === 0 ? (
          <EmptyState title="No matching employees" />
        ) : (
          <div className="max-h-[70vh] overflow-auto">
            <table className="sticky-head w-full border-collapse">
              <thead>
                <tr>
                  <Th>Code</Th>
                  <Th>Name</Th>
                  <Th>Username</Th>
                  <Th>Title</Th>
                  <Th>Site</Th>
                  <Th>Department</Th>
                  <Th>Email</Th>
                  <Th>Mobile</Th>
                  <Th>Office</Th>
                  <Th>Role</Th>
                  <Th>Status</Th>
                  <Th>Login</Th>
                  <Th>Switches</Th>
                  <Th>Leaves</Th>
                  <Th className="sticky right-0 bg-panel text-right">Actions</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filtered.map((e) => (
                  <tr key={e.id} className={e.is_active ? 'hover:bg-hover' : 'bg-subtle/60 opacity-70'}>
                    <Td className="tabular font-medium">{e.code}</Td>
                    <Td className="font-medium text-ink">{e.name}</Td>
                    <Td className="text-ink-3">{e.username ?? '—'}</Td>
                    <Td>{e.title}</Td>
                    <Td>{e.sites?.name}</Td>
                    <Td>{e.departments?.name}</Td>
                    <Td className="text-ink-3">{e.email}</Td>
                    <Td className="tabular text-ink-3">{e.company_mobile ?? '—'}</Td>
                    <Td className="tabular text-ink-3">{e.office_number ?? '—'}</Td>
                    <Td>
                      <Badge
                        tone={
                          e.role === 'super_admin'
                            ? 'green'
                            : e.role === 'admin'
                              ? 'blue'
                              : e.role === 'user'
                                ? 'slate'
                                : 'red'
                        }
                      >
                        {{ super_admin: 'Super admin', no_access: 'No access' }[e.role] ?? e.role}
                      </Badge>
                    </Td>
                    <Td>
                      <Badge tone={e.employee_statuses?.in_payroll ? 'green' : 'amber'}>
                        {e.employee_statuses?.name ?? '—'}
                      </Badge>
                    </Td>
                    <Td>
                      {e.auth_user_id ? (
                        <Badge tone="green">Active</Badge>
                      ) : e.email ? (
                        <Badge tone="amber">Not invited</Badge>
                      ) : (
                        <Badge tone="slate">No email</Badge>
                      )}
                    </Td>
                    <Td className="text-xs text-ink-3">
                      {[
                        e.has_meal && 'Meal',
                        e.has_allowance && 'Allow',
                        e.has_overtime && 'OT',
                        e.has_incentive && 'Incent',
                        e.has_deductions && 'Deduct',
                      ]
                        .filter(Boolean)
                        .join(' · ') || '—'}
                    </Td>
                    <Td className="tabular text-xs text-ink-3">
                      {e.annual_leave_balance} / {e.unplanned_leave_balance}
                    </Td>
                    <Td className="sticky right-0 z-[1] bg-panel text-right shadow-[-8px_0_8px_-8px_rgba(0,0,0,0.25)]">
                      <div className="flex justify-end gap-1">
                        {/* Editing lives in the portal's Database page, which
                            holds the whole personnel record. Two forms
                            writing the same row from different places is how
                            fields quietly diverge. */}
                        {isSuperAdmin && e.email && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busyId === e.id}
                            onClick={() => setPasswordFor(e)}
                          >
                            Set password
                          </Button>
                        )}
                        {/* Active is not a switch any more: it follows the
                            status, which is set in the Database page. */}
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}



/**
 * Hands an administrator a temporary password to pass on in person.
 *
 * It is shown in plain text on purpose -- the whole point is that it has to
 * be read out -- and it is useless after first sign-in, because the account
 * is flagged to force the employee to choose their own.
 */
function TemporaryPasswordForm({ employee, busy, onCancel, onSave }) {
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
    <Card>
      <CardHeader
        title={`Temporary password for ${employee.name}`}
        subtitle={`They sign in as ${employee.username ?? employee.email} and must choose their own password immediately.`}
      />
      <form
        className="grid gap-4 p-5 sm:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault()
          onSave(password)
        }}
      >
        <Field label="Temporary password" className="sm:col-span-2" hint="At least 8 characters. Write it down before saving — it is not shown again.">
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
    </Card>
  )
}
