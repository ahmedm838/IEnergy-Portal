import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, run } from './supabase'

/**
 * Reference data (sites, sectors, departments, statuses, attendance types,
 * settings) changes rarely but is needed on almost every page, so it is
 * fetched once per session and shared.
 */
export function useLookups() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [sites, sectors, departments, statuses, types, settings] = await Promise.all([
        run(supabase.from('sites').select('*').order('sort_order')),
        run(supabase.from('sectors').select('*').order('sort_order')),
        run(
          supabase
            .from('departments')
            .select('id, name, sector_id, sort_order, sectors ( id, name )')
            .order('sort_order'),
        ),
        run(supabase.from('employee_statuses').select('*').order('sort_order')),
        run(
          supabase
            .from('attendance_types')
            .select('*')
            .eq('is_active', true)
            .order('sort_order'),
        ),
        run(supabase.from('app_settings').select('*')),
      ])

      const settingsMap = Object.fromEntries(settings.map((s) => [s.key, s.value]))
      setData({ sites, sectors, departments, statuses, types, settings: settingsMap })
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const typeById = useMemo(() => {
    const map = new Map()
    for (const type of data?.types ?? []) map.set(type.id, type)
    return map
  }, [data])

  const defaultTypeId = useMemo(
    () => data?.types?.find((t) => t.code === 'no_status')?.id ?? data?.types?.[0]?.id ?? null,
    [data],
  )

  const requiredHoursPerDay = Number(data?.settings?.required_hours_per_day ?? 8)
  const mealRate = Number(data?.settings?.meal_allowance_rate ?? 0)
  const lateGraceHours = Number(data?.settings?.late_grace_hours ?? 2)
  const currency = String(data?.settings?.currency ?? 'EGP')

  return {
    ...(data ?? {}),
    typeById,
    defaultTypeId,
    requiredHoursPerDay,
    mealRate,
    lateGraceHours,
    currency,
    loading,
    error,
    reload: load,
  }
}

/** Employees the current user may see, for pickers and report filters. */
export function useEmployees({ activeOnly = true } = {}) {
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      let query = supabase
        .from('employees')
        .select(
          `id, code, name, title, email, username, role, is_active, si_no, auth_user_id,
           company_mobile, office_number,
           site_id, department_id, status_id,
           has_meal, has_allowance, has_overtime, has_incentive, has_deductions,
           annual_leave_balance, unplanned_leave_balance,
           sites ( id, name ),
           departments ( id, name ),
           employee_statuses ( id, name, in_payroll )`,
        )
        .order('code')
      if (activeOnly) query = query.eq('is_active', true)
      setEmployees(await run(query))
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [activeOnly])

  useEffect(() => {
    load()
  }, [load])

  return { employees, loading, error, reload: load }
}
