import { useCallback, useEffect, useState } from 'react'
import { supabase, run } from '../lib/supabase'
import { useLookups } from '../lib/useLookups'
import { useLocks, lockRangeLabel } from '../lib/useLocks'
import { dayLabel, toISODate } from '../lib/format'
import {
  Alert,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Select,
  Spinner,
  Td,
  Th,
} from '../components/ui'

/**
 * Company holidays: days declared for everybody at once.
 *
 * Declaring one writes an attendance record for every employee who may
 * hold records, and leaves alone anybody who already has something
 * recorded on that day. Both halves happen in one database call, so a
 * day cannot be half-declared, and the call reports who was skipped
 * rather than a count -- a name and what they are already recorded as
 * is what tells you whether to go and change it.
 */
export default function Holidays() {
  const lookups = useLookups()
  const locks = useLocks()

  const [holidays, setHolidays] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  // { created, total, skipped: [...] } from the last declaration.
  const [result, setResult] = useState(null)

  const [date, setDate] = useState(() => toISODate(new Date()))
  const [typeId, setTypeId] = useState('')
  const [description, setDescription] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setHolidays(await run(supabase.rpc('list_company_holidays')))
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  /* Holiday first if there is one, so the common case is already
     chosen. It is only a default -- a company day off is sometimes a
     paid day or an overtime day, which is why the type is asked for at
     all rather than assumed. */
  useEffect(() => {
    if (typeId || !lookups.types?.length) return
    const holiday = lookups.types.find((t) => t.code === 'holiday')
    setTypeId(String(holiday?.id ?? lookups.types[0].id))
  }, [lookups.types, typeId])

  const existing = holidays.find((h) => h.holiday_date === date) ?? null
  const dateLocked = date ? locks.isLocked(date) : false

  async function handleDeclare() {
    if (!date || !typeId || !description.trim()) return
    setSaving(true)
    setError(null)
    setResult(null)
    try {
      const data = await run(
        supabase.rpc('declare_company_holiday', {
          p_date: date,
          p_type_id: Number(typeId),
          p_description: description.trim(),
        }),
      )
      setResult(data)
      setDescription('')
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (lookups.loading) return <Spinner />

  return (
    <div className="grid grid-cols-1 gap-5">
      <div>
        <h1 className="text-xl font-semibold text-ink">Holidays</h1>
        <p className="mt-0.5 text-sm text-ink-3">
          Days given to the whole company. Declaring one records it for every employee who may
          hold records, and leaves alone anyone whose day is already recorded.
        </p>
      </div>

      {error && <Alert tone="error" onDismiss={() => setError(null)}>{error}</Alert>}

      <Card>
        <CardHeader
          title="Add a company holiday"
          subtitle="The day, what it counts as, and why. All three are needed."
        />
        <div className="grid gap-4 px-5 py-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Day">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Attendance type">
            <Select value={typeId} onChange={(e) => setTypeId(e.target.value)}>
              {(lookups.types ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name_en} — {t.name_ar}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Description"
            hint="Written onto every record for this day, so the reason is on the record itself."
            className="lg:col-span-2"
          >
            <Input
              value={description}
              placeholder="Eid al-Fitr, Revolution Day…"
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
        </div>

        {/* Said before the button is pressed, not after. Each of these
            changes what the button is about to do, and finding out
            afterwards means undoing two hundred rows by hand. */}
        {dateLocked && (
          <div className="px-5 pb-2">
            <Alert tone="warning" title="That day is in a locked period">
              {lockRangeLabel(locks.lockFor(date))} Unlock it in Settings first; nothing else in
              the tracker writes into a locked period and a bulk write will not be the exception.
            </Alert>
          </div>
        )}
        {existing && !dateLocked && (
          <div className="px-5 pb-2">
            <Alert tone="warning" title="That day is already a holiday">
              {existing.description} — {existing.type_en}. Declaring it again updates the
              description and the type here, and gives the day to anyone who still has nothing
              recorded on it. Employees who already have the day keep what they have.
            </Alert>
          </div>
        )}

        <div className="flex items-center gap-3 border-t border-line px-5 py-4">
          <Button
            onClick={handleDeclare}
            disabled={saving || !date || !typeId || !description.trim() || dateLocked}
          >
            {saving ? 'Saving…' : existing ? 'Update holiday' : 'Add holiday'}
          </Button>
          <span className="text-xs text-ink-4">
            Written straight away, for everybody. There is no Save on this page.
          </span>
        </div>
      </Card>

      {/* What the declaration actually did.

          The names matter more than the numbers. "3 employees already
          had this day" sends somebody looking through two hundred rows;
          their names, with what each is already recorded as, is a list
          that can be acted on or dismissed on sight. */}
      {result && (
        <Card>
          <CardHeader
            title={`${result.created} of ${result.total} employees given the day`}
            subtitle={
              result.skipped.length
                ? `${result.skipped.length} already had something recorded and were left as they are.`
                : 'Nobody had anything recorded on that day, so everybody got it.'
            }
            actions={
              <Button variant="ghost" size="sm" onClick={() => setResult(null)}>
                Dismiss
              </Button>
            }
          />
          {result.skipped.length > 0 && (
            <div className="max-h-[40vh] overflow-auto">
              <table className="sticky-head w-full border-collapse">
                <thead>
                  <tr>
                    <Th className="min-w-[90px]">Code</Th>
                    <Th>Name</Th>
                    <Th>Already recorded as</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {result.skipped.map((person) => (
                    <tr key={person.code}>
                      <Td className="tabular whitespace-nowrap">{person.code}</Td>
                      <Td className="font-medium text-ink">{person.name}</Td>
                      <Td>
                        {person.type_en} <span className="arabic text-ink-3">{person.type_ar}</span>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <Card>
        <CardHeader
          title="Recorded holidays"
          subtitle="Newest first. The count is how many employees hold that day as that type right now."
        />
        {loading ? (
          <Spinner />
        ) : holidays.length === 0 ? (
          <EmptyState title="No company holidays have been declared yet" />
        ) : (
          <div className="max-h-[60vh] overflow-auto">
            <table className="sticky-head w-full border-collapse">
              <thead>
                <tr>
                  <Th className="min-w-[140px]">Day</Th>
                  <Th className="min-w-[180px]">Counts as</Th>
                  <Th>Description</Th>
                  <Th className="text-right">Employees</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {holidays.map((h) => (
                  <tr key={h.id} className="hover:bg-hover">
                    <Td className="tabular whitespace-nowrap">{dayLabel(h.holiday_date)}</Td>
                    <Td className="whitespace-nowrap">
                      {h.type_en} <span className="arabic text-ink-3">{h.type_ar}</span>
                    </Td>
                    <Td className="text-ink-3">{h.description}</Td>
                    <Td className="tabular text-right font-semibold">{h.employees}</Td>
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
