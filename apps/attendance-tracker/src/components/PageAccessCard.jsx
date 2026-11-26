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
  const [saved, setSaved] = useState(null) // { 'page|role': bool }
  const [draft, setDraft] = useState(null)
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

  useEffect(() => {
    let live = true
    readPageAccess({ force: true })
      .then((a) => { if (live) { const v = fromTable(a); setSaved(v); setDraft(v) } })
      .catch((err) => {
        if (!live) return
        setError(`Could not read page access: ${err.message || err}. Showing the built-in defaults.`)
        const v = fromTable(null)
        setSaved(v)
        setDraft(v)
      })
    return () => { live = false }
  }, [])

  const changed = useMemo(() => {
    if (!saved || !draft) return []
    return Object.keys(draft).filter((k) => draft[k] !== saved[k])
  }, [saved, draft])

  const toggle = (page, role) => {
    if (readOnly) return
    setNotice(null)
    setDraft((d) => ({ ...d, [key(page, role)]: !d[key(page, role)] }))
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
      forgetPageAccess()
      setSaved(draft)
      setNotice('Saved. Pages already open pick this up within two minutes; anyone signing in gets it at once.')
    } catch (err) {
      setError(`Not saved: ${err.message || err}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader
        title="Page access"
        subtitle="Which portal pages each role may open. Their tiles on the home page follow."
      />
      <div className="grid gap-4 p-5">
        {error && <Alert tone="error" onDismiss={() => setError(null)}>{error}</Alert>}
        {notice && <Alert tone="success" onDismiss={() => setNotice(null)}>{notice}</Alert>}
        {!draft ? (
          <p className="text-sm text-ink-3">Loading…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-line">
                  <Th className="w-10">#</Th>
                  <Th>Page</Th>
                  <Th>What it shows</Th>
                  {ROLES.map(([role, label]) => (
                    <Th key={role} className="text-center">{label}</Th>
                  ))}
                  <Th className="text-center">Super admin</Th>
                </tr>
              </thead>
              <tbody>
                {PAGES.map(({ page, label, about }, i) => (
                  <tr key={page} className="border-b border-line align-top last:border-0">
                    <Td className="text-ink-3">{i + 1}</Td>
                    <PageName label={label} page={page} />
                    <About text={about} />
                    {ROLES.map(([role, roleLabel]) => {
                      const k = key(page, role)
                      const on = !!draft[k]
                      return (
                        <Td key={role} className="text-center">
                          <input
                            type="checkbox"
                            className="h-4 w-4 cursor-pointer accent-brand-600 disabled:cursor-not-allowed"
                            checked={on}
                            disabled={readOnly || busy}
                            onChange={() => toggle(page, role)}
                            aria-label={`${roleLabel} may open ${label}`}
                          />
                          {k in saved && saved[k] !== on && <span className="ml-1 text-xs text-ink-4">•</span>}
                        </Td>
                      )
                    })}
                    <Td className="text-center">
                      <input type="checkbox" className="h-4 w-4" checked disabled aria-label={`Super admin may open ${label}`} />
                    </Td>
                  </tr>
                ))}
                {FIXED_PAGES.map(({ page, label, about }, i) => (
                  <tr key={page} className="border-b border-line align-top last:border-0">
                    <Td className="text-ink-3">{PAGES.length + i + 1}</Td>
                    <PageName label={label} page={page} fixed />
                    <About text={about} />
                    {ROLES.map(([role]) => (
                      <Td key={role} className="text-center">
                        <input type="checkbox" className="h-4 w-4" checked={false} disabled aria-label="Not available" />
                      </Td>
                    ))}
                    <Td className="text-center">
                      <input type="checkbox" className="h-4 w-4" checked disabled aria-label={`Super admin may open ${label}`} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-ink-4">
          This decides which pages open. What each role can see or change inside a page is still
          set by the database: opening a page to users shows them only the records their role can
          already read. Accounts with no access open nothing.
        </p>
      </div>
      {!readOnly && draft && (
        <SaveBar
          count={changed.length}
          busy={busy}
          onSave={save}
          onDiscard={() => setDraft(saved)}
          hint="Tick the pages each role may open, then save."
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

function About({ text }) {
  return (
    <Td className="min-w-[16rem] whitespace-normal text-xs leading-relaxed text-ink-3">{text}</Td>
  )
}
