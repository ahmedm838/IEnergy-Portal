import { useMemo, useState } from 'react'
import { supabase, run } from '../lib/supabase'
import { useLookups, useEmployees } from '../lib/useLookups'
import { useAuth } from '../lib/auth'
import { setTemporaryPassword, generateTemporaryPassword } from '../lib/invites'
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

/**
 * Employee codes are at least six digits. The database enforces this with
 * a check constraint; repeating it here is so the form can say so before
 * someone fills the rest of it in.
 */
export const MIN_EMPLOYEE_CODE = 100000

const BLANK = {
  code: '',
  name: '',
  si_no: '',
  title: '',
  company_mobile: '',
  office_number: '',
  email: '',
  site_id: '',
  department_id: '',
  status_id: '',
  role: 'no_access',
  // Every payroll component is on for a new employee; HR turns off the
  // ones that do not apply. Matches the column defaults in the database.
  has_meal: true,
  has_allowance: true,
  has_overtime: true,
  has_incentive: true,
  has_deductions: true,
  annual_leave_balance: 21,
  unplanned_leave_balance: 7,
  is_active: true,
}

export default function Employees() {
  const lookups = useLookups()
  const { isSuperAdmin } = useAuth()
  const { employees, loading, error, reload } = useEmployees({ activeOnly: false })

  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState(null)
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
        (e.company_mobile ?? '').toLowerCase().includes(needle) ||
        (e.office_number ?? '').toLowerCase().includes(needle) ||
        (e.departments?.name ?? '').toLowerCase().includes(needle),
    )
  }, [employees, search])

  async function handleSave(form) {
    setFormError(null)

    // The check constraint would catch this anyway, but its message names
    // the constraint rather than the rule.
    if (!Number.isInteger(Number(form.code)) || Number(form.code) < MIN_EMPLOYEE_CODE) {
      setFormError(
        `Employee code must be a whole number of at least 6 digits — ${MIN_EMPLOYEE_CODE} or above.`,
      )
      return
    }

    try {
      const payload = {
        code: Number(form.code),
        name: form.name.trim(),
        si_no: form.si_no?.trim() || null,
        title: form.title?.trim() || null,
        company_mobile: form.company_mobile?.trim() || null,
        office_number: form.office_number?.trim() || null,
        email: form.email?.trim() || null,
        site_id: form.site_id === '' ? null : Number(form.site_id),
        department_id: form.department_id === '' ? null : Number(form.department_id),
        status_id: form.status_id === '' ? null : Number(form.status_id),
        role: form.role,
        has_meal: !!form.has_meal,
        has_allowance: !!form.has_allowance,
        has_overtime: !!form.has_overtime,
        has_incentive: !!form.has_incentive,
        has_deductions: !!form.has_deductions,
        annual_leave_balance: Number(form.annual_leave_balance) || 0,
        unplanned_leave_balance: Number(form.unplanned_leave_balance) || 0,
        is_active: !!form.is_active,
      }

      if (form.id) {
        await run(supabase.from('employees').update(payload).eq('id', form.id))
        setNotice(`Updated ${payload.name}.`)
      } else {
        await run(supabase.from('employees').insert(payload))
        setNotice(
          `Created ${payload.name}. They can sign in once you invite ${
            payload.email ?? 'their email'
          } from the Supabase dashboard — the account links to this record automatically.`,
        )
      }
      setEditing(null)
      reload()
    } catch (err) {
      setFormError(duplicateMessage(err.message) ?? err.message)
    }
  }

  async function toggleActive(employee) {
    try {
      await run(
        supabase.from('employees').update({ is_active: !employee.is_active }).eq('id', employee.id),
      )
      reload()
    } catch (err) {
      setNotice(null)
      setFormError(err.message)
    }
  }

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
        <Button onClick={() => setEditing({ ...BLANK })}>Add employee</Button>
      </div>

      {error && <Alert tone="error">{error}</Alert>}
      {formError && <Alert tone="error" onDismiss={() => setFormError(null)}>{formError}</Alert>}
      {notice && <Alert tone="success" onDismiss={() => setNotice(null)}>{notice}</Alert>}

      {editing && (
        <EmployeeForm
          value={editing}
          lookups={lookups}
          canGrantElevated={isSuperAdmin}
          onCancel={() => setEditing(null)}
          onSave={handleSave}
        />
      )}

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
                        <Button variant="ghost" size="sm" onClick={() => setEditing({ ...e })}>
                          Edit
                        </Button>
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
                        <Button variant="ghost" size="sm" onClick={() => toggleActive(e)}>
                          {e.is_active ? 'Deactivate' : 'Restore'}
                        </Button>
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

function EmployeeForm({ value, lookups, canGrantElevated, onCancel, onSave }) {
  const [form, setForm] = useState(value)
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))

  return (
    <Card>
      <CardHeader
        title={form.id ? `Edit ${form.name}` : 'New employee'}
        subtitle="Access is enforced by the database, so the role here is the real one."
      />
      <form
        className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4"
        onSubmit={(e) => {
          e.preventDefault()
          onSave(form)
        }}
      >
        <Field
          label="Code"
          hint="At least 6 digits, so 100000 or above."
          error={
            form.code !== '' && Number(form.code) < MIN_EMPLOYEE_CODE
              ? `Too short — codes are at least 6 digits (${MIN_EMPLOYEE_CODE} or above).`
              : undefined
          }
        >
          <Input
            type="number"
            required
            min={MIN_EMPLOYEE_CODE}
            step="1"
            placeholder={String(MIN_EMPLOYEE_CODE)}
            value={form.code}
            onChange={(e) => set({ code: e.target.value })}
          />
        </Field>
        <Field label="Name" className="sm:col-span-2">
          <Input required value={form.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label="S.I. No." hint="Must be unique across all employees.">
          <Input value={form.si_no ?? ''} onChange={(e) => set({ si_no: e.target.value })} />
        </Field>

        <Field label="Title">
          <Input value={form.title ?? ''} onChange={(e) => set({ title: e.target.value })} />
        </Field>
        <Field label="Company mobile">
          <Input
            type="tel"
            inputMode="tel"
            placeholder="0100 000 0000"
            value={form.company_mobile ?? ''}
            onChange={(e) => set({ company_mobile: e.target.value })}
          />
        </Field>
        <Field label="Office number">
          <Input
            type="tel"
            inputMode="tel"
            placeholder="Extension or direct line"
            value={form.office_number ?? ''}
            onChange={(e) => set({ office_number: e.target.value })}
          />
        </Field>
        <Field
          label="Email"
          hint={
            form.email?.includes('@')
              ? `Username will be "${form.email.split('@')[0].toLowerCase()}" — derived automatically.`
              : 'Used to sign in; must match their Supabase account.'
          }
        >
          <Input
            type="email"
            value={form.email ?? ''}
            onChange={(e) => set({ email: e.target.value })}
          />
        </Field>
        <Field label="Site">
          <Select value={form.site_id ?? ''} onChange={(e) => set({ site_id: e.target.value })}>
            <option value="">—</option>
            {lookups.sites?.map((s) => (
              <option key={s.id} value={s.id} disabled={!s.available && String(form.site_id) !== String(s.id)}>
                {s.name}
                {!s.available ? ' (unavailable)' : ''}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Department">
          <Select
            value={form.department_id ?? ''}
            onChange={(e) => set({ department_id: e.target.value })}
          >
            <option value="">—</option>
            {lookups.departments?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({d.sectors?.name})
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Status">
          <Select value={form.status_id ?? ''} onChange={(e) => set({ status_id: e.target.value })}>
            <option value="">—</option>
            {lookups.statuses?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.in_payroll ? '' : ' (not payable)'}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Role"
          hint={
            !canGrantElevated
              ? 'Only a super admin can grant or remove the admin and super admin roles.'
              : form.role === 'super_admin'
                ? 'Everything an admin can do, plus editing Settings.'
                : form.role === 'admin'
                  ? 'Manages employees, attendance and adjustments. Settings are read-only.'
                  : undefined
          }
        >
          {/* Admin and super admin are offered only to a super admin. The
              database refuses either grant from anyone else, so leaving them
              selectable would just produce a save that fails. */}
          <Select value={form.role} onChange={(e) => set({ role: e.target.value })}>
            <option value="user">User — read own department (default)</option>
            <option value="no_access">No access — blocked entirely</option>
            <option value="admin" disabled={!canGrantElevated && form.role !== 'admin'}>
              Admin — manage staff and attendance
              {!canGrantElevated && form.role !== 'admin' ? ' (super admin only)' : ''}
            </option>
            <option value="super_admin" disabled={!canGrantElevated && form.role !== 'super_admin'}>
              Super admin — also edits Settings
              {!canGrantElevated && form.role !== 'super_admin' ? ' (super admin only)' : ''}
            </option>
          </Select>
        </Field>
        <Field label="Annual leave balance">
          <Input
            type="number"
            step="0.5"
            value={form.annual_leave_balance}
            onChange={(e) => set({ annual_leave_balance: e.target.value })}
          />
        </Field>
        <Field label="Un planned leave balance">
          <Input
            type="number"
            step="0.5"
            value={form.unplanned_leave_balance}
            onChange={(e) => set({ unplanned_leave_balance: e.target.value })}
          />
        </Field>

        <div className="sm:col-span-2 lg:col-span-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-3">
            Payroll switches
          </p>
          <div className="flex flex-wrap gap-5">
            <Checkbox
              label="Meal"
              checked={!!form.has_meal}
              onChange={(e) => set({ has_meal: e.target.checked })}
            />
            <Checkbox
              label="Allowance"
              checked={!!form.has_allowance}
              onChange={(e) => set({ has_allowance: e.target.checked })}
            />
            <Checkbox
              label="Overtime"
              checked={!!form.has_overtime}
              onChange={(e) => set({ has_overtime: e.target.checked })}
            />
            <Checkbox
              label="Incentive"
              checked={!!form.has_incentive}
              onChange={(e) => set({ has_incentive: e.target.checked })}
            />
            <Checkbox
              label="Deductions"
              checked={!!form.has_deductions}
              onChange={(e) => set({ has_deductions: e.target.checked })}
            />
            <Checkbox
              label="Active"
              checked={!!form.is_active}
              onChange={(e) => set({ is_active: e.target.checked })}
            />
          </div>
        </div>

        <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
          <Button type="submit">{form.id ? 'Save changes' : 'Create employee'}</Button>
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  )
}

/**
 * Turn a Postgres unique-violation into something actionable.
 *
 * A duplicate email trips employees_username_idx first, because username is
 * generated from the local part of the address -- so that index name has to
 * map back to "email" or the message would point at a field the form does
 * not even show.
 */
function duplicateMessage(message) {
  if (!message) return null
  if (message.includes('super admin')) {
    return 'Only a super admin can grant or remove the admin and super admin roles.'
  }
  if (!message.includes('duplicate key') && !message.includes('unique constraint')) return null

  const byIndex = [
    ['employees_code_key', 'That employee code is already used. Codes must be unique.'],
    ['employees_name_unique_idx', 'An employee with this name already exists. Names must be unique.'],
    ['employees_si_no_unique_idx', 'That S.I. No. is already used by another employee.'],
    ['employees_username_idx', 'That email is already used by another employee.'],
    ['employees_email_lower_idx', 'That email is already used by another employee.'],
  ]
  for (const [index, text] of byIndex) {
    if (message.includes(index)) return text
  }
  return 'One of these values is already used by another employee.'
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
