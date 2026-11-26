import { useEffect, useState } from 'react'
import { supabase } from './supabase'

/* Settings > Page access: which portal pages each role may open, from
   the page_access table. Shared with the portal's own pages through the
   same tab storage auth.js keeps it in, so the tracker and the portal
   read it once between them.

   A super admin opens everything and no_access nothing. For user and
   admin the table decides; where it has no answer (not read, not
   reachable, a page it does not list) the caller's own rule stands. */

export const PAGE_ACCESS_KEY = 'ienergy_page_access_v1'
const FRESH_MS = 2 * 60 * 1000

/* The pages a super admin can open or close per role, in the order the
   Settings card lists them, each with who may open it until it is set.
   Settings and the Form Designer are not here: they stay super admin
   only, so nobody can lock themselves out of the page that sets this. */
export const PAGES = [
  { page: 'attendance-tracker', label: 'Attendance Tracker', defaults: ['user', 'admin'] },
  { page: 'employee-database', label: 'Employees Database', defaults: ['admin'] },
  { page: 'hr-documents', label: 'HR Documents', defaults: ['admin'] },
  { page: 'employee-documents', label: 'Employee Documents', defaults: ['user', 'admin'] },
  { page: 'company-structure', label: 'Company structure', defaults: ['user', 'admin'] },
  { page: 'contacts-list', label: 'Contacts List', defaults: ['user', 'admin'] },
  { page: 'salary-calculator', label: 'Salary Calculator', defaults: ['admin'] },
  { page: 'company-policy', label: 'Company policy', defaults: ['user', 'admin'] },
  { page: 'purchasing-request', label: 'Purchasing Request', defaults: ['user', 'admin'] },
]
export const FIXED_PAGES = [
  { page: 'settings', label: 'Settings' },
  { page: 'form-designer', label: 'Form Designer' },
]

export function cachedPageAccess() {
  try {
    const raw = JSON.parse(sessionStorage.getItem(PAGE_ACCESS_KEY))
    return raw && raw.map && raw.at ? raw : null
  } catch (_) {
    return null
  }
}

export function forgetPageAccess() {
  try { sessionStorage.removeItem(PAGE_ACCESS_KEY) } catch (_) {}
}

export async function readPageAccess({ force = false } = {}) {
  const cached = cachedPageAccess()
  if (!force && cached && Date.now() - cached.at < FRESH_MS) return cached
  const { data, error } = await supabase.from('page_access').select('page, role, allowed')
  if (error) {
    if (force) throw error
    return cached
  }
  const map = {}
  for (const row of data || []) {
    if (!map[row.page]) map[row.page] = {}
    map[row.page][row.role] = !!row.allowed
  }
  const out = { map, at: Date.now() }
  try { sessionStorage.setItem(PAGE_ACCESS_KEY, JSON.stringify(out)) } catch (_) {}
  return out
}

/* true / false from the table, or null when it has no answer. */
export function canOpenPage(access, page, role) {
  if (role === 'super_admin') return true
  if (!role || role === 'no_access') return false
  const row = access?.map?.[page]
  return row && typeof row[role] === 'boolean' ? row[role] : null
}

/* The table, read once per tab (and again when it is two minutes old):
   undefined until the first answer, then the table or null. */
export function usePageAccess(enabled = true) {
  const [access, setAccess] = useState(() => cachedPageAccess() ?? undefined)
  useEffect(() => {
    if (!enabled) return
    let live = true
    readPageAccess().then((a) => { if (live) setAccess(a ?? null) }).catch(() => { if (live) setAccess(null) })
    return () => { live = false }
  }, [enabled])
  return access
}
