import { useMemo, useState } from 'react'
import { useLookups, useEmployees } from '../lib/useLookups'
import { useAuth } from '../lib/auth'
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  EmptyState,
  Input,
  Spinner,
  Td,
  Th,
} from '../components/ui'

export default function Employees() {
  const lookups = useLookups()
  const { isSuperAdmin } = useAuth()
  const { employees, loading, error } = useEmployees({ activeOnly: false })

  const [search, setSearch] = useState('')

  // Searching only what the table shows. Matching a hidden column would
  // put rows on screen with nothing in them that explains why.
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return employees
    return employees.filter(
      (e) =>
        e.name.toLowerCase().includes(needle) ||
        String(e.code).includes(needle) ||
        (e.title ?? '').toLowerCase().includes(needle) ||
        (e.sites?.name ?? '').toLowerCase().includes(needle) ||
        (e.departments?.name ?? '').toLowerCase().includes(needle),
    )
  }, [employees, search])

  if (lookups.loading || loading) return <Spinner />

  return (
    <div className="grid grid-cols-1 gap-5">
      {/* Adding and editing an employee happens in the portal's Database
          page, which holds the whole personnel record. This page shows
          what it shows. The link that used to say so is gone -- it is one
          click from the portal's own tile, and it was the last thing here
          still pointing at the old GitHub Pages address. */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Employees</h1>
          <p className="mt-0.5 text-sm text-ink-3">
            {employees.length} records. The Y/N switches drive what the monthly report pays.
          </p>
          <p className="mt-1 text-xs text-ink-4">
            {isSuperAdmin
              ? 'Roles and passwords are set in Settings, under Access.'
              : 'Roles and passwords are set by a super admin, in Settings. There is no email reset.'}
          </p>
        </div>
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      <Card>
        <CardHeader
          title="All employees"
          actions={
            <Input
              placeholder="Search name, code, title, department…"
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
                  <Th>Title</Th>
                  <Th>Site</Th>
                  <Th>Department</Th>
                  <Th>Status</Th>
                  <Th>Login</Th>
                  <Th>Switches</Th>
                  <Th>Leaves</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filtered.map((e) => (
                  <tr key={e.id} className={e.is_active ? 'hover:bg-hover' : 'bg-subtle/60 opacity-70'}>
                    <Td className="tabular font-medium">{e.code}</Td>
                    <Td className="font-medium text-ink">{e.name}</Td>
                    <Td>{e.title}</Td>
                    <Td>{e.sites?.name}</Td>
                    <Td>{e.departments?.name}</Td>
                    {/* Role lives in Settings, under Access, with the
                        password that goes with it. */}
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
