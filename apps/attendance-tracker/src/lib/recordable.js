/**
 * Whether attendance and adjustments may be written for an employee.
 *
 * The rule is enforced by a database trigger; this exists only so a page
 * can say so before someone fills a form in. The wording is kept in step
 * with employee_record_block_reason() in the database, so the message is
 * the same whichever one catches it.
 *
 * Takes an employee row with is_active and its employee_statuses embed.
 * Returns the reason as a sentence, or null when the employee is fine.
 */
export function recordBlockReason(employee) {
  if (!employee) return null

  const name = employee.name || 'This employee'
  const status = employee.employee_statuses

  if (!employee.is_active) {
    return (
      `${name} is deactivated, so their attendance and adjustments cannot be added, ` +
      'changed or deleted. Restore the employee under Employees first.'
    )
  }
  if (!status) {
    return (
      `${name} has no status set, so their attendance and adjustments cannot be added, ` +
      'changed or deleted. Set a status that allows records under Employees.'
    )
  }
  if (!status.allows_records) {
    return (
      `${name} has the status “${status.name}”, which does not allow records. ` +
      'Only statuses ticked as “Can be recorded” under Settings do.'
    )
  }
  return null
}

/** Convenience for the common case. */
export function canRecord(employee) {
  return recordBlockReason(employee) === null
}
