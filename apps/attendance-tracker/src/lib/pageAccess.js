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
   Settings card lists them, each with who may open it until it is set
   and what it shows, so the choice is made knowing what it opens.
   Settings is not here: it stays super admin only, so nobody can lock
   themselves out of the page that sets this. */
export const PAGES = [
  {
    page: 'attendance-tracker', label: 'Attendance Tracker', defaults: ['user', 'admin'],
    about: 'Attendance, adjustments, leave balances and payroll reports. Users get the Employee report only, for themselves and people below them in their sector.',
  },
  {
    page: 'employee-database', label: 'Employees Database', defaults: ['admin'],
    about: 'Full personnel records: national ID, address, wages, social insurance, contacts and scanned documents. Only admins can edit.',
  },
  {
    page: 'hr-documents', label: 'HR Documents', defaults: ['admin'],
    about: 'Contracts, renewals, hiring and leaving papers, certificates, warnings and investigations, filled from full records (national ID, wages).',
  },
  {
    page: 'employee-documents', label: 'Employee Documents', defaults: ['user', 'admin'],
    about: 'Requests: salary advance, financial grant, custody, penalty notice, hiring and purchase requests, performance evaluation. Any employee can be picked by name.',
  },
  {
    page: 'company-structure', label: 'Company structure', defaults: ['user', 'admin'],
    about: 'Sectors and departments, with every employee\'s name, title and level.',
  },
  {
    page: 'contacts-list', label: 'Contacts List', defaults: ['user', 'admin'],
    about: 'Work mobile, office number and email of every employee.',
  },
  {
    page: 'salary-calculator', label: 'Salary Calculator', defaults: ['admin'],
    about: 'Gross, tax, social insurance and net salary calculations. Shows no employee data.',
  },
  {
    page: 'company-policy', label: 'Company policy', defaults: ['user', 'admin'],
    about: 'Company policies to read and download.',
  },
]
export const FIXED_PAGES = [
  {
    page: 'settings', label: 'Settings',
    about: 'Roles, passwords, page access and the company\'s reference data. Includes the Form Designer.',
  },
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
  if (!force && cached?.order && Date.now() - cached.at < FRESH_MS) return cached
  const [access, ordered] = await Promise.all([
    supabase.from('page_access').select('page, role, allowed'),
    supabase.from('page_order').select('page, position'),
  ])
  if (access.error) {
    if (force) throw access.error
    return cached
  }
  const map = {}
  for (const row of access.data || []) {
    if (!map[row.page]) map[row.page] = {}
    map[row.page][row.role] = !!row.allowed
  }
  // The main page's tile order (page_order): page -> position.
  const order = {}
  for (const row of (ordered.error ? [] : ordered.data) || []) order[row.page] = row.position
  const out = { map, order, at: Date.now() }
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
