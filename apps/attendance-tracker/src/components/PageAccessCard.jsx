import { useEffect, useMemo, useState } from 'react'
import { supabase, run } from '../lib/supabase'
import { FIXED_PAGES, PAGES, forgetPageAccess, readPageAccess } from '../lib/pageAccess'
import SaveBar from './SaveBar'
import { Alert, Badge, Card, CardHeader, Td, Th } from './ui'

/* The roles a super admin chooses for, as the Access card names them.
   A super admin opens every page and is shown ticked and locked; no
   access opens none and is not a column at all. */
const ROLES = [
  ['user', 'User'],
  ['admin', 'Admin'],
]

const key = (page, role) => `${page}|${role}`

// Every page the card lists; the fixed ones (Settings) cannot be ticked.
const ALL = [...PAGES, ...FIXED_PAGES.map((p) => ({ ...p, fixed: true }))]

/**
 * Page access: which portal pages each role may open.
 *
 * Every page asks the page_access table before it opens, and hides its
 * tile on the home page when the answer is no. Until a page has been
 * set here it keeps the rule written into it (the defaults below).
 *
 * This decides which pages open, not what is in them: row level security
 * still decides which rows each role can read or change. Opening HR
 * Documents to users, say, shows them the page, but only the employee
 * records their role could already read.
 *
 * Settings (with the Form Designer in it) stays open to super admins
 * only, so nobody can close the page that sets this.
 */
export default function PageAccessCard({ readOnly }) {
  // Ticks: { 'page|role': bool }. Order: the pages, main page order.
  const [saved, setSaved] = useState(null)
  const [draft, setDraft] = useState(null)
  const [savedOrder, setSavedOrder] = useState(null)
  const [order, setOrder] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)

  const fromTable = (access) => {
    const out = {}
    for (const { page, defaults } of PAGES) {
      for (const [role] of ROLES) {
        const v = access?.map?.[page]?.[role]
        out[key(page, role)] = typeof v === 'boolean' ? v : defaults.includes(role)
      }
    }
    return out
  }

  /* Every page, in the main page's order: those with a position first,
     lowest first, then any without one in the order listed here. */
  const orderFrom = (access) => {
    const pos = access?.order || {}
    return ALL.map((p, i) => ({ page: p.page, i, at: pos[p.page] ?? Infinity }))
      .sort((a, b) => a.at - b.at || a.i - b.i)
      .map((x) => x.page)
  }

  useEffect(() => {
    let live = true
    const take = (a) => {
      const v = fromTable(a)
      const o = orderFrom(a)
      setSaved(v); setDraft(v); setSavedOrder(o); setOrder(o)
    }
    readPageAccess({ force: true })
      .then((a) => { if (live) take(a) })
      .catch((err) => {
        if (!live) return
        setError(`Could not read page access: ${err.message || err}. Showing the built-in defaults.`)
        take(null)
      })
    return () => { live = false }
  }, [])

  const changed = useMemo(() => {
    if (!saved || !draft || !order || !savedOrder) return 0
    const ticks = Object.keys(draft).filter((k) => draft[k] !== saved[k]).length
    const moved = order.filter((p, i) => savedOrder[i] !== p).length
    return ticks + moved
  }, [saved, draft, order, savedOrder])

  const toggle = (page, role) => {
    if (readOnly) return
    setNotice(null)
    setDraft((d) => ({ ...d, [key(page, role)]: !d[key(page, role)] }))
  }

  // Swap a page with the one above (-1) or below (+1).
  const move = (page, by) => {
    if (readOnly) return
    setNotice(null)
    setOrder((o) => {
      const i = o.indexOf(page)
      const j = i + by
      if (i < 0 || j < 0 || j >= o.length) return o
      const next = [...o]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }

  async function save() {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      // Every pair is written, not only the changed ones: a page that has
      // never been set here gets its rows now, so it follows this table
      // from here on instead of the rule in its own code.
      const rows = PAGES.flatMap(({ page }) =>
        ROLES.map(([role]) => ({ page, role, allowed: !!draft[key(page, role)] })))
      await run(supabase.from('page_access').upsert(rows, { onConflict: 'page,role' }))
      await run(supabase.from('page_order').upsert(
        order.map((page, i) => ({ page, position: i + 1 })), { onConflict: 'page' }))
      forgetPageAccess()
      setSaved(draft)
      setSavedOrder(order)
      setNotice('Saved. Pages already open pick this up within two minutes; anyone signing in gets it at once.')
    } catch (err) {
      setError(`Not saved: ${err.message || err}`)
    } finally {
      setBusy(false)
    }
  }

  const tick = (on, props) => (
    <input type="checkbox" className="h-4 w-4 cursor-pointer accent-brand-600 disabled:cursor-not-allowed" checked={on} {...props} />
  )
  const arrow = 'inline-grid h-7 w-7 place-items-center rounded-md border border-line-strong bg-panel text-ink-2 hover:bg-hover disabled:cursor-not-allowed disabled:opacity-30'

  return (
    <Card>
      <CardHeader
        title="Page access"
        subtitle="Which portal pages each role may open, and the order of their tiles on the main page."
      />
      <div className="grid gap-4 p-5">
        {error && <Alert tone="error" onDismiss={() => setError(null)}>{error}</Alert>}
        {notice && <Alert tone="success" onDismiss={() => setNotice(null)}>{notice}</Alert>}
        {!draft || !order ? (
          <p className="text-sm text-ink-3">Loading…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-line">
                  <Th className="w-24" title="Place on the main page">Order</Th>
                  <Th>Page</Th>
                  {ROLES.map(([role, label]) => (
                    <Th key={role} className="text-center">{label}</Th>
                  ))}
                  <Th className="text-center">Super admin</Th>
                </tr>
              </thead>
              <tbody>
                {order.map((page, i) => {
                  const p = ALL.find((x) => x.page === page)
                  const moved = savedOrder[i] !== page
                  return (
                    <tr key={page} className="border-b border-line align-top last:border-0">
                      <Td>
                        <div className="flex items-center gap-1">
                          <span className={`w-5 text-right text-sm ${moved ? 'font-semibold text-ink' : 'text-ink-3'}`}>{i + 1}</span>
                          <button type="button" className={arrow} disabled={readOnly || busy || i === 0}
                            onClick={() => move(page, -1)} aria-label={`Move ${p.label} up`} title="Move up">↑</button>
                          <button type="button" className={arrow} disabled={readOnly || busy || i === order.length - 1}
                            onClick={() => move(page, 1)} aria-label={`Move ${p.label} down`} title="Move down">↓</button>
                        </div>
                      </Td>
                      <PageName label={p.label} page={page} fixed={p.fixed} />
                      {ROLES.map(([role, roleLabel]) => {
                        if (p.fixed) {
                          return <Td key={role} className="text-center">{tick(false, { disabled: true, 'aria-label': 'Not available' })}</Td>
                        }
                        const k = key(page, role)
                        const on = !!draft[k]
                        return (
                          <Td key={role} className="text-center">
                            {tick(on, {
                              disabled: readOnly || busy,
                              onChange: () => toggle(page, role),
                              'aria-label': `${roleLabel} may open ${p.label}`,
                            })}
                            {saved[k] !== on && <span className="ml-1 text-xs text-ink-4">•</span>}
                          </Td>
                        )
                      })}
                      <Td className="text-center">{tick(true, { disabled: true, 'aria-label': `Super admin may open ${p.label}` })}</Td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-ink-4">
          Order is the place of each tile on the main page; Change password always comes last. This
          decides which pages open, not what is in them: what each role can see or change inside a
          page is still set by the database, so opening a page to users shows them only the
          records their role can already read. Accounts with no access open nothing.
        </p>
      </div>
      {!readOnly && draft && order && (
        <SaveBar
          count={changed}
          busy={busy}
          onSave={save}
          onDiscard={() => { setDraft(saved); setOrder(savedOrder) }}
          hint="Tick the pages each role may open, set their order, then save."
        />
      )}
    </Card>
  )
}

/* The page's name, and under it its ID: the folder it lives in on the
   portal, which is also how the page_access table names it. */
function PageName({ label, page, fixed = false }) {
  return (
    <Td>
      <div className="font-medium text-ink">
        {label} {fixed && <Badge>super admin only</Badge>}
      </div>
      <div className="font-mono text-xs text-ink-4">{page}</div>
    </Td>
  )
}
