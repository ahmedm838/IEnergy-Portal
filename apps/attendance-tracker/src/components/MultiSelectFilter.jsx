import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Checkbox, Input, cx } from './ui'

/**
 * A button that opens a checklist and narrows a table to the ticked values.
 *
 * Nothing ticked means no filtering at all, rather than showing nothing.
 * That is the reading people expect of a filter that has not been used
 * yet, and it means the button can be ignored entirely by anyone who
 * does not want it.
 *
 * The options are handed in from the rows on screen, not from a lookup
 * table: a department with nobody in it this period is not a useful thing
 * to offer, and the list would otherwise be mostly dead entries.
 */
export default function MultiSelectFilter({
  label,
  options,
  selected,
  onChange,
  searchFrom = 8,
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const boxRef = useRef(null)

  // Close on a click anywhere else, and on Escape. Same as the employee
  // picker, so the two feel like one app.
  useEffect(() => {
    if (!open) return undefined
    const away = (event) => {
      if (!boxRef.current?.contains(event.target)) setOpen(false)
    }
    const key = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', key)
    }
  }, [open])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((o) => o.label.toLowerCase().includes(q))
  }, [options, query])

  const toggle = (value) => {
    const next = new Set(selected)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    onChange(next)
  }

  const count = selected.size

  return (
    <div className="relative" ref={boxRef}>
      <Button
        variant={count ? 'primary' : 'secondary'}
        size="sm"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="true"
      >
        {label}
        {count > 0 && (
          <span className="ml-1.5 rounded-full bg-white/25 px-1.5 text-[11px] font-semibold">
            {count}
          </span>
        )}
      </Button>

      {open && (
        <div
          className="absolute right-0 top-full z-20 mt-1 w-64 rounded-lg border border-line
                     bg-panel p-2 shadow-lg"
        >
          {options.length >= searchFrom && (
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              className="mb-2 py-1.5 text-sm"
            />
          )}

          <div className="max-h-64 overflow-auto">
            {shown.length === 0 ? (
              <p className="px-2 py-3 text-sm text-ink-3">Nothing matches.</p>
            ) : (
              shown.map((o) => (
                <label
                  key={o.value}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5
                             text-sm hover:bg-hover"
                >
                  <Checkbox
                    checked={selected.has(o.value)}
                    onChange={() => toggle(o.value)}
                  />
                  <span className="min-w-0 flex-1 truncate text-ink-2">{o.label}</span>
                  <span className="tabular text-xs text-ink-4">{o.count}</span>
                </label>
              ))
            )}
          </div>

          <div className="mt-2 flex items-center justify-between border-t border-line pt-2">
            <span className="text-xs text-ink-3">
              {count ? `${count} selected` : 'Showing all'}
            </span>
            <button
              type="button"
              className={cx(
                'rounded px-2 py-1 text-xs font-medium',
                count ? 'text-brand-600 hover:bg-hover' : 'cursor-default text-ink-4',
              )}
              disabled={!count}
              onClick={() => onChange(new Set())}
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
