import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, run } from './supabase'

/**
 * Locked periods: date ranges a super admin has closed to edits.
 *
 * The rule itself lives in a database trigger, so nothing here is what
 * stops a write -- this exists so a page can grey itself out first. Being
 * told a month is closed after typing a week of attendance is a bad way
 * to find out.
 *
 * The whole table is fetched, closed ranges included, because it is a
 * handful of rows a year and the Settings page wants the history.
 */
export function useLocks() {
  const [all, setAll] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // Two foreign keys point at employees, so each embed names its
      // constraint; without that PostgREST cannot tell them apart.
      setAll(
        await run(
          supabase
            .from('locked_periods')
            .select(
              `*,
               locker:employees!locked_periods_locked_by_fkey ( name ),
               unlocker:employees!locked_periods_unlocked_by_fkey ( name )`,
            )
            .order('from_date', { ascending: false }),
        ),
      )
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

  const active = useMemo(() => all.filter((l) => !l.unlocked_at), [all])

  // ISO dates compare correctly as plain strings, so no Date objects are
  // built here -- this runs once per row of the attendance grid.
  const lockFor = useCallback(
    (iso) => (iso ? active.find((l) => iso >= l.from_date && iso <= l.to_date) ?? null : null),
    [active],
  )

  const isLocked = useCallback((iso) => lockFor(iso) !== null, [lockFor])

  /** How many days of a range are closed, for a summary line. */
  const countLocked = useCallback(
    (days) => days.reduce((n, iso) => n + (isLocked(iso) ? 1 : 0), 0),
    [isLocked],
  )

  return { all, active, isLocked, lockFor, countLocked, loading, error, reload: load }
}

/** "21 Mar 2026 to 20 Apr 2026", matching the wording of the database error. */
export function lockRangeLabel(lock) {
  if (!lock) return ''
  const fmt = (iso) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })
  return `${fmt(lock.from_date)} to ${fmt(lock.to_date)}`
}
