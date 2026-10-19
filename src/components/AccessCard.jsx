import { useMemo, useState } from 'react'
import { supabase, run } from '../lib/supabase'
import { useEmployees } from '../lib/useLookups'
import { Alert, Badge, Button, Card, CardHeader, Input, Select, Td, Th } from './ui'

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
 */
export default function AccessCard({ readOnly }) {
  const { employees, loading, reload } = useEmployees({ activeOnly: false })
  const [search, setSearch] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)

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

  async function changeRole(employee, role) {
    if (role === employee.role) return
    const name = employee.name
    if (
      (role === 'admin' || role === 'super_admin') &&
      !window.confirm(
        `Give  the  role?\n\n` +
          (role === 'super_admin'
            ? 'A super admin can change every setting here, lock and unlock payroll periods, and grant this role to others.'
            : 'An admin can record attendance and adjustments for everyone and edit employee records.'),
      )
    ) {
      return
    }

    setBusyId(employee.id)
    setError(null)
    setNotice(null)
    try {
      await run(supabase.from('employees').update({ role }).eq('id', employee.id))
      setNotice(`${name} is now ${LABEL[role]}.`)
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
                      value={e.role}
                      disabled={readOnly || busyId === e.id}
                      className="py-1 text-sm"
                      onChange={(event) => changeRole(e, event.target.value)}
                    >
                      {ROLES.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </Select>
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
    </Card>
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
