import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Checkbox, Input, Th, cx } from './ui'

/**
 * A table header that sorts its column and narrows it to chosen values,
 * the way a filtered column in Excel does.
 *
 * Clicking the label cycles ascending -> descending -> off. The small
 * funnel opens a checklist of the values in the column, with how many
 * rows hold each one. Nothing ticked means no filtering, the same reading
 * MultiSelectFilter uses, so an untouched header changes nothing.
 *
 * The checklist is positioned against the viewport rather than the
 * header. The tables this sits in scroll inside their own box
 * (max-h + overflow-auto), and a popup absolutely placed inside that box
 * is clipped by it -- with a short table, most of the list would be cut
 * off.
 *
 * Both controls are no-print: on paper the header reads as plain text.
 */
export default function ColumnFilterTh({
  label,
  className,
  sort, // 'asc' | 'desc' | null
  onSort,
  options, // [{ value, label, count }]
  selected, // Set of values
  onChange,
  searchFrom = 8,
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [pos, setPos] = useState(null)
  const buttonRef = useRef(null)
  const popRef = useRef(null)

  useLayoutEffect(() => {
    if (!open) return
    const rect = buttonRef.current?.getBoundingClientRect()
    if (!rect) return
    const width = 256
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))
    setPos({ top: rect.bottom + 4, left, width })
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    const away = (event) => {
      if (popRef.current?.contains(event.target)) return
      if (buttonRef.current?.contains(event.target)) return
      setOpen(false)
    }
    const key = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    // A fixed popup would drift away from its header on scroll, so it
    // closes instead -- except when the scroll is the list inside it.
    const scrolled = (event) => {
      if (popRef.current?.contains(event.target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', key)
    window.addEventListener('scroll', scrolled, true)
    window.addEventListener('resize', scrolled)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', key)
      window.removeEventListener('scroll', scrolled, true)
      window.removeEventListener('resize', scrolled)
    }
  }, [open])

  useEffect(() => {
    if (!open) setQuery('')
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
  const right = className?.includes('text-right')
  const center = className?.includes('text-center')

  return (
    <Th
      className={className}
      aria-sort={sort === 'asc' ? 'ascending' : sort === 'desc' ? 'descending' : undefined}
    >
      <span
        className={cx(
          'inline-flex items-center gap-1',
          right && 'flex-row-reverse',
          center && 'justify-center',
        )}
      >
        <button
          type="button"
          onClick={onSort}
          className="inline-flex items-center gap-1 rounded uppercase tracking-wide hover:text-ink"
          title="Sort"
        >
          {label}
          <span
            aria-hidden="true"
            className={cx('no-print text-[10px]', sort ? 'text-brand-600' : 'text-ink-4')}
          >
            {sort === 'asc' ? '▲' : sort === 'desc' ? '▼' : '↕'}
          </span>
        </button>
        <button
          ref={buttonRef}
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-haspopup="true"
          aria-label={`Filter ${label}`}
          title={count ? `${count} selected` : 'Filter'}
          className={cx(
            'no-print inline-flex h-5 min-w-5 items-center justify-center rounded px-0.5',
            count ? 'bg-brand-600 text-white' : 'text-ink-4 hover:bg-hover hover:text-ink-2',
          )}
        >
          <svg viewBox="0 0 16 16" className="h-3 w-3" fill="currentColor" aria-hidden="true">
            <path d="M1.5 2h13l-5 6.2V13l-3 1.5V8.2z" />
          </svg>
          {count > 0 && <span className="ml-0.5 text-[10px] font-semibold">{count}</span>}
        </button>
      </span>

      {open && pos && (
        <div
          ref={popRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width }}
          className="no-print z-50 rounded-lg border border-line bg-panel p-2 text-left
                     font-normal normal-case tracking-normal shadow-lg"
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
                  <Checkbox checked={selected.has(o.value)} onChange={() => toggle(o.value)} />
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
            <div className="flex gap-1">
              {shown.length > 0 && (
                <button
                  type="button"
                  className="rounded px-2 py-1 text-xs font-medium text-brand-600 hover:bg-hover"
                  onClick={() => {
                    const next = new Set(selected)
                    shown.forEach((o) => next.add(o.value))
                    onChange(next)
                  }}
                >
                  Select all
                </button>
              )}
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
        </div>
      )}
    </Th>
  )
}
