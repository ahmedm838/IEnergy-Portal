import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, run } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useLookups } from '../lib/useLookups'
import { dayLabel, monthBounds, num, toISODate } from '../lib/format'
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

  const range = monthBounds()
  const today = toISODate(new Date())

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [visibleEmployees, monthRecords, summary] = await Promise.all([
        run(
          supabase
            .from('employees')
            .select('id, code, name, is_active', { count: 'exact' })
            .eq('is_active', true),
        ),
        run(
          supabase
            .from('attendance_records')
            .select('id, employee_id, work_date')
            .gte('work_date', range.from)
            .lte('work_date', range.to),
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

      const recordedToday = new Set(
        monthRecords.filter((r) => r.work_date === today).map((r) => r.employee_id),
      )

      setStats({
        employees: visibleEmployees.length,
        recordsThisMonth: monthRecords.length,
        recordedToday: recordedToday.size,
      })
      setMissing(visibleEmployees.filter((e) => !recordedToday.has(e.id)).slice(0, 12))
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
        <Stat label="Entries this month" value={num(stats?.recordsThisMonth ?? 0, 0)} />
        <Stat
          label="Your hours this month"
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
            subtitle={`Calendar year ${mySummary.leave_year.from} to ${mySummary.leave_year.to}`}
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
            </tbody>
          </table>
        </Card>
      )}

      {isAdmin && (
        <Card>
          <CardHeader
            title="Not recorded today"
            subtitle={`${missing.length} of ${stats?.employees ?? 0} employees have no entry for ${today}`}
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
