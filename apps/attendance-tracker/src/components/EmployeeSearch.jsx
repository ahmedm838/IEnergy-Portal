import { useEffect, useMemo, useRef, useState } from 'react'
import { cx } from './ui'

/**
 * Pick an employee by typing, the way the portal's Database page does.
 *
 * A dropdown list of three hundred people is a scroll, not a choice. This
 * takes a code or a name -- English or Arabic -- narrows as it is typed,
 * and settles the chosen name into the box with the list gone, so what is
 * on screen is always the employee being worked on.
 *
 * It replaces a native <select>, which means the keyboard has to be put
 * back by hand: arrows move, Enter picks, Escape abandons and restores
 * whatever was chosen before. Losing that would be a worse page than the
 * long dropdown it replaces.
 */
export default function EmployeeSearch({
  employees,
  value,
  onChange,
  label = 'Employee',
  placeholder = 'Code or name…',
  // The text for "no particular employee", where that is a real choice --
  // the adjustments filter, where it means all of them. Without it, an
  // empty box simply means nothing is chosen yet.
  emptyLabel,
  note,
  suffix,
  disabled,
  required,
  className,
  inputClassName,
}) {
  const selected = useMemo(
    () => employees.find((e) => String(e.id) === String(value)) ?? null,
    [employees, value],
  )
  const labelFor = (e) => (e ? `#${e.code} — ${e.name}` : '')

  const [text, setText] = useState(() => labelFor(selected))
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const boxRef = useRef(null)
  const listId = useRef(`emp-search-${Math.random().toString(36).slice(2, 8)}`)

  // Follow a selection made elsewhere -- a page clearing the filter, or
  // the single-employee shortcut on the report page.
  useEffect(() => {
    setText(labelFor(employees.find((e) => String(e.id) === String(value)) ?? null))
    setOpen(false)
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps

  // While the box still shows the chosen employee, typing starts a new
  // search rather than filtering on "#100001 — Ahmed Moustafa".
  const searching = open && text !== labelFor(selected)

  const matches = useMemo(() => {
    if (!searching) return employees.slice(0, 50)
    const needle = text.trim().toLowerCase()
    if (!needle) return employees.slice(0, 50)
    const digits = needle.replace(/\D/g, '')
    return employees
      .filter(
        (e) =>
          e.name?.toLowerCase().includes(needle) ||
          e.arabic_name?.includes(text.trim()) ||
          (digits && String(e.code).includes(digits)),
      )
      .slice(0, 50)
  }, [employees, text, searching])

  // Close when the click lands anywhere else on the page.
  useEffect(() => {
    if (!open) return
    const away = (event) => {
      if (!boxRef.current?.contains(event.target)) {
        setOpen(false)
        setText(labelFor(selected))
      }
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open, selected]) // eslint-disable-line react-hooks/exhaustive-deps

  function choose(employee) {
    onChange(employee ? employee.id : '')
    setText(labelFor(employee))
    setOpen(false)
  }

  function onKeyDown(event) {
    if (event.key === 'Escape') {
      setOpen(false)
      setText(labelFor(selected))
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) { setOpen(true); setActive(0); return }
      const last = matches.length - 1 + (emptyLabel ? 1 : 0)
      setActive((i) => (event.key === 'ArrowDown' ? Math.min(i + 1, last) : Math.max(i - 1, 0)))
      return
    }
    if (event.key === 'Enter' && open) {
      event.preventDefault()
      if (emptyLabel && active === 0) { choose(null); return }
      const employee = matches[active - (emptyLabel ? 1 : 0)]
      if (employee) choose(employee)
    }
  }

  const rows = emptyLabel ? [null, ...matches] : matches

  return (
    <div className={cx('block', className)} ref={boxRef}>
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-ink-3">
        {label}
      </span>
      <div className="relative">
        <input
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId.current}
          aria-autocomplete="list"
          autoComplete="off"
          disabled={disabled}
          required={required && !value}
          className={cx(
            'w-full rounded-lg border border-line-strong bg-panel px-3 py-2 text-sm text-ink',
            'shadow-sm transition placeholder:text-ink-4',
            'focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500',
            'disabled:bg-subtle disabled:text-ink-3',
            inputClassName,
          )}
          placeholder={emptyLabel && !selected ? emptyLabel : placeholder}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setOpen(true)
            setActive(0)
            // An emptied box is no longer naming anybody.
            if (!e.target.value.trim() && value) onChange('')
          }}
          onFocus={() => { setOpen(true); setActive(0) }}
          // Picking an employee leaves the focus in the box, and clicking
          // an already-focused input fires no focus event -- without this,
          // the only way back to the list would be to type something.
          onClick={() => { setOpen(true); setActive(0) }}
          onKeyDown={onKeyDown}
        />

        {open && (
          <div
            id={listId.current}
            role="listbox"
            // Taking the mousedown keeps the focus in the box, so the list
            // is still open when the click lands.
            onMouseDown={(e) => e.preventDefault()}
            className="absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-auto rounded-lg
                       border border-line-strong bg-panel shadow-lg"
          >
            {rows.length === 0 ? (
              <div className="px-3 py-2 text-sm text-ink-4">No employee matches that.</div>
            ) : (
              rows.map((employee, i) => (
                <button
                  key={employee?.id ?? 'none'}
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(employee)}
                  className={cx(
                    'flex w-full items-baseline gap-2 px-3 py-2 text-left text-sm',
                    i === active ? 'bg-hover' : '',
                    employee ? 'text-ink' : 'text-ink-3 italic',
                  )}
                >
                  {employee ? (
                    <>
                      <span className="tabular shrink-0 text-ink-3">#{employee.code}</span>
                      <span className="truncate font-medium">{employee.name}</span>
                      {employee.arabic_name && (
                        <span className="truncate text-ink-4" dir="rtl">{employee.arabic_name}</span>
                      )}
                      {suffix?.(employee) && (
                        <span className="ml-auto shrink-0 text-xs text-ink-4">{suffix(employee)}</span>
                      )}
                    </>
                  ) : (
                    emptyLabel
                  )}
                </button>
              ))
            )}
          </div>
        )}
      </div>
      {note && <span className="mt-1 block text-xs text-ink-4">{note}</span>}
    </div>
  )
}
