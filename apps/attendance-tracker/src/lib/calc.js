/**
 * Client-side mirror of the SQL calculation layer.
 *
 * The database is the source of truth for every saved figure — these
 * functions exist so the attendance grid can show live totals as the user
 * types, before anything is persisted. Each one is kept deliberately
 * identical to its counterpart in supabase/02_functions.sql; if you change
 * a rule, change it in both places.
 */

/**
 * Absence Rule sheet — cumulative deduction in days for N unauthorised
 * absences within one calendar year.
 *
 *   0 -> 0      2 -> 2.75     N >= 4 -> 7.75 + (N - 4) * 3
 *   1 -> 1.25   3 -> 4.75
 */
export function absenceDeduction(n) {
  const count = Number(n) || 0
  if (count <= 0) return 0
  if (count === 1) return 1.25
  if (count === 2) return 2.75
  if (count === 3) return 4.75
  return 7.75 + (count - 4) * 3
}

/**
 * Penalty attributable to a period, given the absence count before it and
 * the count through its end. The scale is progressive, so a period is
 * charged the increment rather than a fresh recount from zero.
 */
export function absencePenaltyForPeriod(countBefore, countThrough) {
  return absenceDeduction(countThrough) - absenceDeduction(countBefore)
}

/** Overtime for an attendance type: extra * 1.5 + added (workbook =D*1.5+E). */
export function overtimeHours(type) {
  if (!type) return 0
  return Number(type.extra_hours || 0) * 1.5 + Number(type.added_hours || 0)
}

/** Hours between two 'HH:MM' clock readings, rolling past midnight. */
export function workedHours(clockIn, clockOut) {
  if (!clockIn || !clockOut) return 0
  const toMin = (t) => {
    const [h, m] = String(t).split(':').map(Number)
    return (h || 0) * 60 + (m || 0)
  }
  const start = toMin(clockIn)
  const end = toMin(clockOut)
  const span = end >= start ? end - start : end - start + 24 * 60
  return Math.round((span / 60) * 10000) / 10000
}

/**
 * Live totals for a set of grid rows.
 *
 * `rows` are grid rows ({ attendance_type_id, late_minutes, transport,
 * clock_in, clock_out, add_to_leave_balance }); `typeById` maps an
 * attendance_type id to its row from the attendance_types table.
 */
export function summarise(rows, typeById, requiredHoursPerDay = 8) {
  const totals = {
    mealUnits: 0,
    transport: 0,
    overtime: 0,
    lateMinutes: 0,
    workingDays: 0,
    workedHours: 0,
    absenceDays: 0,
    deductedLeaves: 0,
    annualUsed: 0,
    unplannedUsed: 0,
    addedUsed: 0,
    addedEarned: 0,
    recordedDays: 0,
    byType: new Map(),
  }

  for (const row of rows) {
    const type = typeById.get(row.attendance_type_id)
    if (!type) continue

    totals.recordedDays += 1
    totals.mealUnits += Number(type.meal_multiplier || 0)
    totals.overtime += overtimeHours(type)
    totals.transport += Number(row.transport || 0)
    totals.lateMinutes += Number(row.late_minutes || 0)
    totals.workedHours += workedHours(row.clock_in, row.clock_out)
    if (type.is_working_day) totals.workingDays += 1
    if (row.add_to_leave_balance) totals.addedEarned += 1

    switch (type.effect) {
      case 'absence':
        totals.absenceDays += 1
        break
      case 'deducted':
        totals.deductedLeaves += 1
        break
      case 'annual':
        totals.annualUsed += 1
        break
      case 'unplanned':
        totals.unplannedUsed += 1
        break
      case 'added_days':
        totals.addedUsed += 1
        break
      default:
        break
    }

    const key = type.id
    totals.byType.set(key, (totals.byType.get(key) || 0) + 1)
  }

  totals.requiredHours = totals.workingDays * requiredHoursPerDay
  totals.hoursVariance = totals.workedHours - totals.requiredHours
  return totals
}

/** Day counts sorted most-frequent-first — the sheet's "total days 1..7". */
export function rankedDayCounts(totals, typeById) {
  return [...totals.byType.entries()]
    .map(([id, days]) => ({ type: typeById.get(id), days }))
    .filter((entry) => entry.type)
    .sort((a, b) => b.days - a.days || a.type.name_en.localeCompare(b.type.name_en))
}
