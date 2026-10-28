import { useCallback, useMemo, useState } from 'react'

/**
 * Hold edits until somebody presses Save.
 *
 * The Settings cards used to write on every keystroke's blur and every
 * tick: changing a role was a role change, and leaving a renamed box was
 * a rename. That is fine until you change your mind, because there is
 * nothing to change it back with -- the write already happened. This
 * collects edits against the row they belong to and hands them over in
 * one go.
 *
 * Only fields are held. Adding and deleting stay immediate: both are
 * already a deliberate press of their own button, deleting asks first,
 * and a queued delete would have to be drawn as a row that is both still
 * there and already gone.
 *
 * Edits are keyed by row id, so two changes to the same row are one
 * entry and the last value wins -- which is what somebody typing, then
 * retyping, then saving expects to happen.
 *
 * An edit that returns a field to its saved value removes the entry
 * rather than queuing a write of the same data, so Save stays off when
 * nothing has actually changed.
 */
export function usePendingEdits() {
  const [edits, setEdits] = useState(() => new Map())

  const stage = useCallback((row, patch) => {
    setEdits((previous) => {
      const next = new Map(previous)
      const merged = { ...(next.get(row.id) ?? {}), ...patch }
      // Anything back at its saved value is not a change.
      for (const key of Object.keys(merged)) {
        if (Object.is(merged[key], row[key])) delete merged[key]
      }
      if (Object.keys(merged).length === 0) next.delete(row.id)
      else next.set(row.id, merged)
      return next
    })
  }, [])

  const discard = useCallback(() => setEdits(new Map()), [])

  /** The value to show: what is staged for this row, else what was saved. */
  const valueOf = useCallback(
    (row, field) => {
      const patch = edits.get(row.id)
      return patch && field in patch ? patch[field] : row[field]
    },
    [edits],
  )

  const isEdited = useCallback((row, field) => {
    const patch = edits.get(row.id)
    return Boolean(patch && field in patch)
  }, [edits])

  /** [{ row, patch }] for whatever is waiting, in no guaranteed order. */
  const pending = useCallback(
    (rows) =>
      rows
        .filter((row) => edits.has(row.id))
        .map((row) => ({ row, patch: edits.get(row.id) })),
    [edits],
  )

  const count = edits.size
  const dirty = useMemo(() => count > 0, [count])

  return { stage, discard, valueOf, isEdited, pending, count, dirty }
}
