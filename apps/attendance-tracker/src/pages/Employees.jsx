import { useEffect, useMemo, useState } from 'react'
import { supabase, run } from '../lib/supabase'
import { exportSheet, prefetchExcel } from '../lib/exportXlsx'
import { num } from '../lib/format'
import { useLookups, useEmployees } from '../lib/useLookups'
import { useAuth } from '../lib/auth'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Input,
  Spinner,
  Td,
  Th,
} from '../components/ui'

const blankUsage = () => ({ annual: 0, unplanned: 0, added_days: 0, addedEarned: 0 })

/**
 * Leave days taken and earned, per employee, for a calendar year.
 *
 * Postgres counts them and sends four numbers per employee who has any.
 * This page used to download the rows and count them here: two
 * paginated scans of a year of attendance_records, a thousand rows a
 * request, to arrive at the same four integers. The counting rules are
 * unchanged -- they are leave_balances()'s, now stated once in SQL
 * instead of restated here -- and the function reads as the caller, so
 * the figures still cover the caller's own sector and no more.
 */
async function countLeaveUsage(year, isCancelled) {
  const { data, error } = await supabase.rpc('report_leave_usage', { p_year: year })

  // PGRST202: PostgREST cannot find the function. 42883: Postgres cannot.
  if (error && (error.code === 'PGRST202' || error.code === '42883')) {
    return countLeaveUsageInBrowser(year, isCancelled)
  }
  if (error) throw new Error(error.message ?? 'Request failed')
  if (isCancelled()) return null

  const usage = new Map()
  for (const row of data ?? []) {
    usage.set(row.emp_id, {
      annual: Number(row.annual_used || 0),
      unplanned: Number(row.unplanned_used || 0),
      added_days: Number(row.added_used || 0),
      addedEarned: Number(row.added_earned || 0),
    })
  }
  // Employees with nothing to report are not sent; leaves() already
  // reads a missing employee as four zeros.
  return usage
}

/*
 * The same counting, done here, for a browser holding a bundle newer
 * than the database has migrations -- the ordinary state of affairs for
 * the few minutes between a deploy and a migration. It is the code this
 * replaced, unchanged, and is kept for that reason; it is not dead.
 */
async function countLeaveUsageInBrowser(year, isCancelled) {
  const usage = new Map()
  const forEmployee = (id) => {
    if (!usage.has(id)) usage.set(id, blankUsage())
    return usage.get(id)
  }

  // Days taken. Same calendar-year and effect rules as leave_balances,
  // with added_days joining the two leave kinds. The caller's attendance
  // permissions still apply.
  for (let offset = 0; ; offset += 1000) {
    const records = await run(supabase.from('attendance_records')
      .select('id, employee_id, attendance_types!inner(effect)')
      .gte('work_date', `${year}-01-01`)
      .lt('work_date', `${year + 1}-01-01`)
      .in('attendance_types.effect', ['annual', 'unplanned', 'added_days'])
      .order('id')
      .range(offset, offset + 999))
    if (isCancelled()) return null
    for (const record of records) {
      forEmployee(record.employee_id)[record.attendance_types.effect] += 1
    }
    if (records.length < 1000) break
  }

  /* Days earned, which has to be asked for separately.

     An added day is earned by ticking "add to balance" on a day that
     was worked -- normally an Attended day, whose effect is 'none'.
     The query above filters on effect and would never see one, so
     widening its list would have counted the days taken and none of
     the days that paid for them: every balance would have read zero
     earned against however many were used. */
  for (let offset = 0; ; offset += 1000) {
    const earned = await run(supabase.from('attendance_records')
      .select('id, employee_id')
      .gte('work_date', `${year}-01-01`)
      .lt('work_date', `${year + 1}-01-01`)
      .eq('add_to_leave_balance', true)
      .order('id')
      .range(offset, offset + 999))
    if (isCancelled()) return null
    for (const record of earned) forEmployee(record.employee_id).addedEarned += 1
    if (earned.length < 1000) break
  }

  return usage
}

export default function Employees() {
  const lookups = useLookups()
  const { isSuperAdmin } = useAuth()
  const { employees, loading, error } = useEmployees({ activeOnly: false })

  const [search, setSearch] = useState('')
  const [leaveUsage, setLeaveUsage] = useState(new Map())
  const [leavesLoading, setLeavesLoading] = useState(true)
  const [leavesError, setLeavesError] = useState(null)
  const [exportError, setExportError] = useState(null)
  const [exporting, setExporting] = useState(false)
  const year = new Date().getFullYear()

  useEffect(() => { prefetchExcel() }, [])

  useEffect(() => {
    let cancelled = false
    async function loadLeaveUsage() {
      setLeavesLoading(true)
      setLeavesError(null)
      try {
        const usage = await countLeaveUsage(year, () => cancelled)
        if (!cancelled && usage) setLeaveUsage(usage)
      } catch (err) {
        if (!cancelled) setLeavesError(err.message)
      } finally {
        if (!cancelled) setLeavesLoading(false)
      }
    }
    loadLeaveUsage()
    return () => { cancelled = true }
  }, [year])

  function leaves(employee) {
    const used = leaveUsage.get(employee.id) ?? blankUsage()
    return {
      annual: Number(employee.annual_leave_balance || 0),
      unplanned: Number(employee.unplanned_leave_balance || 0),
      annualUsed: used.annual,
      unplannedUsed: used.unplanned,
      annualRemaining: Number(employee.annual_leave_balance || 0) - used.annual,
      unplannedRemaining: Number(employee.unplanned_leave_balance || 0) - used.unplanned,
      /* Added days have no entitlement on the employee record: the
         balance is what was earned in the year, not a number somebody
         set. Same three figures the employee report shows, worked out
         the same way, so the two pages cannot disagree. */
      addedBalance: used.addedEarned,
      addedUsed: used.added_days,
      addedRemaining: used.addedEarned - used.added_days,
    }
  }

  const loginLabel = (employee) => employee.auth_user_id ? 'Active' : employee.email ? 'Not invited' : 'No email'

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

  async function handleExport() {
    setExporting(true)
    setExportError(null)
    try {
      await exportSheet({
        title: 'Employees',
        subtitle: `Leave balances — calendar year ${year}. All leave figures are in days.`,
        sheetName: 'Employees',
        meta: [['Employees', filtered.length], ['Search', search || 'All employees'], ['Generated', new Date().toLocaleString()]],
        columns: [
          { header: 'Code', key: 'code', numFmt: '0' },
          { header: 'Name', key: 'name' },
          { header: 'Title', key: 'title' },
          { header: 'Site', key: 'site' },
          { header: 'Department', key: 'department' },
          { header: 'Status', key: 'status' },
          { header: 'Login', key: 'login' },
          { header: 'Annual leave balance', key: 'annual', numFmt: 'General' },
          { header: 'Unplanned leave balance', key: 'unplanned', numFmt: 'General' },
          { header: 'Annual consumed', key: 'annualUsed', numFmt: 'General' },
          { header: 'Unplanned consumed', key: 'unplannedUsed', numFmt: 'General' },
          { header: 'Annual remaining', key: 'annualRemaining', numFmt: 'General' },
          { header: 'Unplanned remaining', key: 'unplannedRemaining', numFmt: 'General' },
          { header: 'Added days balance', key: 'addedBalance', numFmt: 'General' },
          { header: 'Added days consumed', key: 'addedUsed', numFmt: 'General' },
          { header: 'Added days remaining', key: 'addedRemaining', numFmt: 'General' },
        ],
        rows: filtered.map((employee) => ({
          code: Number(employee.code), name: employee.name, title: employee.title,
          site: employee.sites?.name, department: employee.departments?.name,
          status: employee.employee_statuses?.name, login: loginLabel(employee),
          ...leaves(employee),
        })),
      }, `employees-${year}.xlsx`)
    } catch (err) {
      setExportError(`Could not export employees: ${err.message}`)
    } finally {
      setExporting(false)
    }
  }

  if (lookups.loading || loading) return <Spinner />

  return (
    <div className="employees-page grid grid-cols-1 gap-5">
      {/* Adding and editing an employee happens in the portal's Database
          page, which holds the whole personnel record. This page shows
          what it shows. The link that used to say so is gone -- it is one
          click from the portal's own tile, and it was the last thing here
          still pointing at the old GitHub Pages address. */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Employees</h1>
          <p className="mt-0.5 text-sm text-ink-3">
            {filtered.length} of {employees.length} employees. Leave figures are in days, shown as Annual / Unplanned for {year}.
          </p>
          <p className="no-print mt-1 text-xs text-ink-4">
            {isSuperAdmin
              ? 'Roles and passwords are set in Settings, under Access.'
              : 'Roles and passwords are set by a super admin, in Settings. There is no email reset.'}
          </p>
        </div>
        <div className="no-print flex gap-2">
          <Button variant="secondary" onClick={() => window.print()}
            disabled={leavesLoading || !!leavesError || !!error || filtered.length === 0}>Print</Button>
          <Button onClick={handleExport}
            disabled={leavesLoading || !!leavesError || !!error || exporting || filtered.length === 0}>
            {exporting ? 'Preparing…' : 'Export Excel'}
          </Button>
        </div>
      </div>

      {error && <Alert tone="error">{error}</Alert>}
      {leavesError && <Alert tone="error">Could not load leave usage: {leavesError}</Alert>}
      {exportError && <Alert tone="error">{exportError}</Alert>}

      <Card>
        <CardHeader
          title="All employees"
          subtitle={`Annual / Unplanned · 1 Jan–31 Dec ${year}${search ? ` · Search: ${search}` : ''}`}
          actions={
            <Input
              placeholder="Search name, code, title, department…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="no-print w-72"
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
                  {/* Annual / un-planned / added, in that order, in all
                      three columns. The order is not readable off the
                      numbers, so each header says it rather than leaving
                      people to work it out from a row they recognise. */}
                  <Th title="Annual / Un-planned / Added days">Leaves</Th>
                  <Th title="Annual / Un-planned / Added days">Consumed</Th>
                  <Th title="Annual / Un-planned / Added days">Remaining</Th>
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
                    <Td className="tabular text-xs text-ink-3">
                      {leavesLoading || leavesError
                        ? `${num(e.annual_leave_balance, 0)} / ${num(e.unplanned_leave_balance, 0)} / —`
                        : `${num(e.annual_leave_balance, 0)} / ${num(e.unplanned_leave_balance, 0)} / ${num(leaves(e).addedBalance, 0)}`}
                    </Td>
                    <Td className="tabular text-xs text-ink-3">
                      {leavesLoading || leavesError
                        ? '—'
                        : `${num(leaves(e).annualUsed, 0)} / ${num(leaves(e).unplannedUsed, 0)} / ${num(leaves(e).addedUsed, 0)}`}
                    </Td>
                    <Td className="tabular text-xs text-ink-3">
                      {leavesLoading || leavesError
                        ? '—'
                        : `${num(leaves(e).annualRemaining, 0)} / ${num(leaves(e).unplannedRemaining, 0)} / ${num(leaves(e).addedRemaining, 0)}`}
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
