import { payrollPeriod, payrollPeriodLabel } from '../lib/format'
import { Badge } from './ui'

/**
 * Names the payroll period a date range covers.
 *
 * Periods run 21st to 20th, so "01-Oct to 31-Oct" is NOT October's payroll
 * month. Showing the name next to the pickers stops that being mistaken,
 * and a hand-edited range is called out as custom rather than quietly
 * reported under a month name it does not match.
 */
export default function PeriodLabel({ from, to, className }) {
  if (!from || !to) return null
  const standard = payrollPeriod(new Date(`${to}T00:00:00`))
  const isStandard = standard.from === from && standard.to === to

  return (
    <div className={className}>
      {isStandard ? (
        <Badge tone="blue">{payrollPeriodLabel(to)} payroll</Badge>
      ) : (
        <Badge tone="amber">Custom range</Badge>
      )}
    </div>
  )
}
