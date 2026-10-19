import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, run } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useLookups } from '../lib/useLookups'
import { dateLabel, dayLabel, payrollPeriod, payrollPeriodLabel, num, toISODate } from '../lib/format'
import {
  Alert,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Spinner,
  Stat,
  Td,
  Th,
} from '../components/ui'

export default function Dashboard() {
  const { profile, isAdmin } = useAuth()
  const lookups = useLookups()

  const [stats, setStats] = useState(null)
  const [missing, setMissing] = useState([])
  const [mySummary, setMySummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const range = payrollPeriod()
  const today = toISODate(new Date())

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // One call, counted in the database. This used to pull every
      // attendance row in the period for every employee and count them
      // here, which is a second of work for an admin and eight for a user
      // once there are a few hundred people -- to show three numbers.
      const [snapshot, summary] = await Promise.all([
        run(
          supabase.rpc('dashboard_summary', {
            p_from: range.from,
            p_to: range.to,
            p_today: today,
          }),
        ),
        profile
          ? run(
              supabase.rpc('report_employee_summary', {
                p_employee_id: profile.id,
                p_from: range.from,
                p_to: range.to,
              }),
            )
          : Promise.resolve(null),
      ])

      setStats({
        employees: snapshot?.employees ?? 0,
        recordsThisMonth: snapshot?.records_this_month ?? 0,
        recordedToday: snapshot?.recorded_today ?? 0,
        missingCount: snapshot?.missing_count ?? 0,
      })
      setMissing(snapshot?.missing_today ?? [])
      setMySummary(summary)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [profile, range.from, range.to, today])

  useEffect(() => {
    load()
  }, [load])

  if (loading || lookups.loading) return <Spinner />

  return (
    <div className="grid grid-cols-1 gap-5">
      <div>
        <h1 className="text-xl font-semibold text-ink">
          Welcome back, {profile?.name?.split(' ')[0]}
        </h1>
        <p className="mt-0.5 text-sm text-ink-3">
          {dayLabel(today)} · {isAdmin ? 'Administrator' : profile?.departments?.name ?? 'Employee'}
        </p>
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label={isAdmin ? 'Active employees' : 'Visible to you'}
          value={num(stats?.employees ?? 0, 0)}
          sub={isAdmin ? 'Across all departments' : profile?.departments?.name ?? ''}
        />
        <Stat
          label="Recorded today"
          value={`${stats?.recordedToday ?? 0} / ${stats?.employees ?? 0}`}
          tone={
            stats?.employees && stats.recordedToday === stats.employees ? 'good' : 'neutral'
          }
        />
        <Stat
          label="Entries this period"
          value={num(stats?.recordsThisMonth ?? 0, 0)}
          sub={payrollPeriodLabel(range.to)}
        />
        <Stat
          label="Your hours this period"
          value={mySummary ? num(mySummary.worked_hours) : '—'}
          sub={mySummary ? `${num(mySummary.required_hours)} h required` : ''}
          tone={
            mySummary && Number(mySummary.hours_variance) < 0 ? 'bad' : 'neutral'
          }
        />
      </div>

      {mySummary && (
        <Card>
          <CardHeader
            title="Your leave balances"
            subtitle={`Calendar year ${dateLabel(mySummary.leave_year.from)} to ${dateLabel(mySummary.leave_year.to)}`}
            actions={
              <Link to="/employee-report">
                <Button variant="secondary" size="sm">
                  Open my report
                </Button>
              </Link>
            }
          />
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                <Th />
                <Th className="text-right">Balance</Th>
                <Th className="text-right">Consumed</Th>
                <Th className="text-right">Remaining</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {mySummary.balances.map((b) => (
                <tr key={b.label}>
                  <Td className="font-medium text-ink">{b.label}</Td>
                  <Td className="tabular text-right">{num(b.balance, 1)}</Td>
                  <Td className="tabular text-right">{num(b.consumed, 1)}</Td>
                  <Td
                    className={`tabular text-right font-semibold ${
                      Number(b.remaining) < 0 ? 'text-on-danger' : 'text-on-success'
                    }`}
                  >
                    {num(b.remaining, 1)}
                  </Td>
                </tr>
              ))}
              {/* Leave days none of the three rows above account for --
                  sick, deducted, granted. There is no entitlement to count
                  them against, so only the consumed column has a figure,
                  and what is in it is named rather than left to trust. */}
              <tr>
                <Td className="font-medium text-ink">
                  Other leaves
                  <span className="ml-2 text-xs font-normal text-ink-4">
                    {mySummary.other_leaves > 0
                      ? (mySummary.other_leave_types ?? [])
                          .map((t) => `${t.name_en} ${t.days}`)
                          .join(' · ')
                      : 'sick, deducted, granted'}
                  </span>
                </Td>
                <Td className="tabular text-right text-ink-4">—</Td>
                <Td className="tabular text-right">{num(mySummary.other_leaves, 1)}</Td>
                <Td className="tabular text-right text-ink-4">—</Td>
              </tr>
            </tbody>
          </table>
        </Card>
      )}

      {isAdmin && (
        <Card>
          <CardHeader
            title="Not recorded today"
            subtitle={`${stats?.missingCount ?? 0} of ${stats?.employees ?? 0} employees have no entry for ${today}${
              (stats?.missingCount ?? 0) > missing.length ? ` — showing the first ${missing.length}` : ''
            }`}
            actions={
              <Link to="/attendance">
                <Button size="sm">Record attendance</Button>
              </Link>
            }
          />
          {missing.length === 0 ? (
            <EmptyState title="Everyone is accounted for today" />
          ) : (
            <table className="w-full">
              <tbody className="divide-y divide-line">
                {missing.map((e) => (
                  <tr key={e.id} className="hover:bg-hover">
                    <Td className="tabular w-20 text-ink-3">#{e.code}</Td>
                    <Td className="font-medium text-ink">{e.name}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
    </div>
  )
}
