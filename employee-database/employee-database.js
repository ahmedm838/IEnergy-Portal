/* Employee Database
   - Real Supabase sign-in: the account is the Attendance Tracker one, and
     row level security decides what it may read and write. The portal's
     other pages use a password held in their own source, which would be
     meaningless on a page that edits the table controlling access.
   - Add and edit the full personnel record.
   - Birth date, gender, governorate, insurance title and file status come
     from the database view rather than being recomputed here, so this page
     and the reports cannot disagree about them.
*/
import { createClient } from '../vendor/supabase-js-2.45.4.js'
import { buildEmployeeWorkbook } from './export-workbook.mjs?v=1'

const SUPABASE_URL = 'https://ednaedkurjsgvjrvayys.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVkbmFlZGt1cmpzZ3ZqcnZheXlzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE5ODIzNzYsImV4cCI6MjEwNzU1ODM3Nn0.VvBg4YtwZsjmgmTxbf3vin3Oq_WyNTeioz6m-FRQLzA'

/* The tracker is on this same origin, so it shares this storage and
   therefore this session: signing in here signs you into the tracker too,
   and its ten minute idle timeout ends both. That is deliberate -- one
   account, one session, one place to revoke it. */
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
})

const $ = (id) => document.getElementById(id)
const MIN_CODE = 100000

let me = null
let lookups = {}
let current = null
let searchTimer = null
let searchSeq = 0

/* ------------------------------------------------------------------ */
/* Shared shapes                                                       */
/* ------------------------------------------------------------------ */

const mobileDigits = (v) => String(v ?? '').replace(/\D/g, '').slice(0, 11)
function formatMobile(v) {
  const d = mobileDigits(v)
  if (d.length <= 3) return d
  if (d.length <= 7) return `${d.slice(0, 3)}-${d.slice(3)}`
  return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`
}
const validMobile = (v) => /^0\d{2}-\d{4}-\d{4}$/.test(String(v ?? ''))
const filterValue = (q) => String(q).replace(/[\\"*%]/g, ' ').replace(/\s+/g, ' ').trim()

/* Wages are whole pounds. The column is numeric(10,2) because that is
   what money columns usually are, but a piastre in an insurance wage is
   always a typo, so nothing here offers a decimal point. */
const WAGE_LIMITS = { si_basic_wage: [5500, 55000], si_gross_wage: [7100, 71000] }

const onlyDigits = (v, max) => String(v ?? '').replace(/\D/g, '').slice(0, max)
/**
 * Digits as they are typed, grouped: 55000 reads as 55,000.
 *
 * Anything after a decimal point is dropped rather than run together with
 * the pounds, so a pasted 5500.75 becomes 5,500 and not 550,075.
 */
function formatMoney(v) {
  const d = onlyDigits(String(v ?? '').split('.')[0], 9).replace(/^0+(?=\d)/, '')
  return d ? Number(d).toLocaleString('en-US') : ''
}

/* Dates are written the way the forms they are copied onto write them --
   15-Jan-2026 -- because a date input shows whatever the browser's locale
   decides, and 03-04-2026 means two different days on two machines. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** 2026-01-15 -> 15-Jan-2026. Empty string for anything that is not a date. */
function isoToDMY(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? '').trim())
  if (!m) return ''
  const month = Number(m[2])
  if (month < 1 || month > 12) return ''
  return `${m[3]}-${MONTHS[month - 1]}-${m[1]}`
}

/**
 * What somebody typed into a date box, as YYYY-MM-DD.
 *
 * Accepts the form it is shown in and the forms people paste: 15-Jan-2026,
 * 15 jan 2026, 15/01/2026, 15-01-2026 and 2026-01-15. Returns null when it
 * is not a real day, so 31-Feb is refused rather than silently rolled into
 * March the way the Date constructor would.
 */
function parseDateInput(text) {
  const value = String(text ?? '').trim()
  if (!value) return ''
  let y, mo, d
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value)
  if (m) { [, y, mo, d] = m }
  if (!m && (m = /^(\d{1,2})[-/ ]([A-Za-z]{3,})[-/ ](\d{4})$/.exec(value))) {
    const i = MONTHS.findIndex((name) => name.toLowerCase() === m[2].slice(0, 3).toLowerCase())
    if (i < 0) return null
    ;[, d, , y] = m
    mo = i + 1
  }
  if (!m && (m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(value))) { [, d, mo, y] = m }
  if (!m) return null
  y = Number(y); mo = Number(mo); d = Number(d)
  const when = new Date(Date.UTC(y, mo - 1, d))
  if (when.getUTCFullYear() !== y || when.getUTCMonth() !== mo - 1 || when.getUTCDate() !== d) return null
  return when.toISOString().slice(0, 10)
}

/* ------------------------------------------------------------------ */
/* The record, described once and rendered from the description        */
/* ------------------------------------------------------------------ */

/**
 * What the monthly report pays this employee.
 *
 * These lost their editor when the tracker Employees page stopped
 * editing, so they live here now with the rest of the record. All five
 * start on for a new employee and HR turns off the ones that do not
 * apply, matching the column defaults in the database.
 */
const PAYROLL = [
  ['has_meal', 'Meal'],
  ['has_allowance', 'Allowance'],
  ['has_overtime', 'Overtime'],
  ['has_incentive', 'Incentive'],
  ['has_deductions', 'Deductions'],
]

const DOCUMENTS = [
  ['doc_graduation_certificate', 'Graduation certificate'],
  ['doc_military_certificate', 'Military service'],
  ['doc_birth_certificate', 'Birth certificate'],
  ['doc_criminal_clearance', 'Criminal clearance'],
  ['doc_id_copy', 'ID (copy)'],
  ['doc_personal_photos', '6 personal photos'],
  ['doc_medical_form_111', 'Medical form No. 111'],
  ['doc_si_record_copy', 'SI record (copy)'],
  ['doc_si_form_1', 'SI form 1 (copy)'],
  ['doc_contract', 'Contract'],
]

const GROUPS = [
  {
    title: 'Identity',
    fields: [
      { key: 'code', label: 'Code', type: 'digits', maxLength: 6, placeholder: 'enter 6 numbers' },
      { key: 'name', label: 'Name (English)', type: 'text', placeholder: '3 English names only' },
      { key: 'arabic_name', label: 'Arabic name as in ID', type: 'text', dir: 'rtl', placeholder: 'As in ID arabic only' },
      { key: 'national_id', label: 'ID No.', type: 'digits', maxLength: 14, placeholder: '14 numbers' },
      { key: 'id_expiry_date', label: 'ID expiry date', type: 'date' },
    ],
  },
  {
    title: 'Employment',
    columns: 7,
    fields: [
      { key: 'title', label: 'Job title', type: 'text' },
      { key: 'site_id', label: 'Site', type: 'select', source: 'sites' },
      { key: 'department_id', label: 'Department', type: 'select', source: 'departments' },
      { key: 'hired_on', label: 'Hiring date', type: 'date' },
      { key: 'weekend', label: 'Weekend', type: 'select', options: [['fri_sat', 'Friday + Saturday'], ['fri', 'Friday only']] },
      { key: 'bus_route_id', label: 'Bus route', type: 'select', source: 'busRoutes', noBlank: true },
      // Last in the row, on the right. Status is the field people read
      // off a record rather than fill in while creating one, and it is
      // the one that changes on its own afterwards.
      //
      // noBlank for the same reason the bus route carries it: every
      // employee is in one of these five states, so a blank would be a
      // sixth that means nothing. Nobody currently holds a null status,
      // and the first option is On Board -- the same value a new
      // employee already defaults to -- so nothing is reassigned by
      // this.
      { key: 'status_id', label: 'Status', type: 'select', source: 'statuses', noBlank: true },
    ],
  },
  {
    title: 'Leave balances',
    fields: [
      { key: 'annual_leave_balance', label: 'Annual leave (days)', type: 'number' },
      { key: 'unplanned_leave_balance', label: 'Un-planned leave (days)', type: 'number' },
    ],
  },
  {
    title: 'Social insurance',
    fields: [
      { key: 'si_no', label: 'S.I. No.', type: 'text' },
      { key: 'si_date', label: 'S.I. date', type: 'date' },
      { key: 'si_code', label: 'S.I. code', type: 'sicode' },
      { key: 'si_basic_wage', label: 'S.I. basic wage', type: 'money', placeholder: '5,500 to 55,000' },
      { key: 'si_gross_wage', label: 'S.I. gross wage', type: 'money', placeholder: '7,100 to 71,000' },
    ],
  },
  {
    title: 'Contact',
    fields: [
      { key: 'email', label: 'Email', type: 'text' },
      { key: 'company_mobile', label: 'Company mobile', type: 'mobile' },
      { key: 'personal_mobile', label: 'Personal mobile', type: 'mobile' },
      { key: 'secondary_mobile', label: 'Secondary mobile', type: 'mobile' },
      { key: 'secondary_mobile_name', label: 'Secondary number belongs to', type: 'text' },
      { key: 'office_number', label: 'Office number', type: 'text' },
    ],
  },
  {
    title: 'Personal',
    fields: [
      { key: 'military_service', label: 'Military service', type: 'select', options: [['Served', 'Served'], ['Postponed', 'Postponed'], ['Exempted', 'Exempted']] },
      { key: 'marital_status', label: 'Marital status', type: 'select', options: [['Single', 'Single'], ['Married', 'Married'], ['Divorced', 'Divorced']] },
      { key: 'religion', label: 'Religion', type: 'select', options: [['Muslim', 'Muslim'], ['Christian', 'Christian']] },
      { key: 'qualification_degree_id', label: 'Qualification degree', type: 'select', source: 'degrees' },
      { key: 'education_field', label: 'Education field', type: 'text' },
    ],
  },
  {
    title: 'Leaving',
    columns: 4,
    fields: [
      { key: 'notice_date', label: 'Notice date', type: 'date' },
      { key: 'resignation_date', label: 'Resignation date', type: 'date' },
      { key: 'resignation_reason', label: 'Resignation reason', type: 'text', half: true },
    ],
  },
]

/**
 * The fields a new employee may be saved without.
 *
 * Everything else in the groups above has to be filled in. The insurance
 * figures are excused because they are not known on the first day --
 * they arrive with the insurance office -- the office number because not
 * everybody has one, the email because not everybody gets an account,
 * and the leaving fields because an employee who is arriving has not
 * left.
 */
const OPTIONAL = new Set([
  'si_date', 'si_code', 'si_basic_wage', 'si_gross_wage',
  // A company line and a company email are issued, not collected: a new
  // starter has neither on their first day, and the personal mobile is
  // the number that actually reaches them.
  'email', 'office_number', 'company_mobile',
  'notice_date', 'resignation_date', 'resignation_reason',
])

const isRequired = (key) => !OPTIONAL.has(key)

/** Columns this page writes. Everything else on the row it leaves alone. */
const WRITABLE = [
  ...GROUPS.flatMap((g) => g.fields.map((f) => f.key)),
  ...DOCUMENTS.map(([key]) => key),
  ...PAYROLL.map(([key]) => key),
]

/* ------------------------------------------------------------------ */
/* Access                                                              */
/* ------------------------------------------------------------------ */

/**
 * Show the gate panel with something that explains itself.
 *
 * There is no sign-in on this page any more -- the portal has the only
 * one -- so everything that lands here is either "not signed in" or "not
 * allowed", and both have somewhere to go rather than a dead end.
 */
function showGate(message, error) {
  const note = $('gateMessage')
  if (note) note.textContent = message || ''
  const el = $('authError')
  if (el) {
    el.textContent = error || ''
    el.hidden = !error
  }
  $('gate').hidden = false
  $('app').hidden = true
}

function showAuthError(message) {
  // Anything that fails after the gate is hidden would otherwise write its
  // message into an element nobody can see, which is exactly what "I
  // opened it and nothing happened" looks like from the outside.
  showGate('Something went wrong opening this page.', message)
}

$('signOutBtn').addEventListener('click', async () => {
  // Same reasoning as the tracker: ask the server to revoke, but never
  // depend on it. What keeps someone signed in is the stored token.
  try {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  } catch {
    await supabase.auth.signOut({ scope: 'local' }).catch(() => {})
  }
  // One session for the whole site, so this ends all of it: the portal
  // and the tracker go with it. The portal is where signing back in
  // happens, so that is where this lands.
  location.replace('../index.html')
})

/* ------------------------------------------------------------------ */
/* Loading                                                             */
/* ------------------------------------------------------------------ */

async function loadLookups() {
  const q = (table, select, order) => supabase.from(table).select(select).order(order)
  const [sites, departments, statuses, degrees, busRoutes, govs] = await Promise.all([
    q('sites', 'id, name', 'sort_order'),
    q('departments', 'id, name', 'sort_order'),
    q('employee_statuses', 'id, name', 'sort_order'),
    q('qualification_degrees', 'id, name_en, name_ar', 'sort_order'),
    q('bus_routes', 'id, name', 'sort_order'),
    // Loaded here, with everything else that needs a session. It used to
    // sit in a block that ran once when the page opened -- before anyone
    // had signed in -- so in the normal flow of arriving signed out and
    // signing in, the governorate names were never fetched at all and
    // every ID resolved to "code not listed".
    q('governorates', 'code, name_ar', 'code'),
  ])
  const rows = (r) => (r.error ? [] : r.data ?? [])
  lookups = {
    ...lookups,
    sites: rows(sites).map((r) => [r.id, r.name]),
    departments: rows(departments).map((r) => [r.id, r.name]),
    statuses: rows(statuses).map((r) => [r.id, r.name]),
    degrees: rows(degrees).map((r) => [r.id, `${r.name_en} — ${r.name_ar}`]),
    busRoutes: rows(busRoutes).map((r) => [r.id, r.name]),
    governorates: Object.fromEntries(rows(govs).map((r) => [Number(r.code), r.name_ar])),
  }
}

/**
 * The same day n months from today, as YYYY-MM-DD.
 *
 * Clamped to the end of the target month, so asking for four months
 * from the 31st of October gives the 28th of February rather than
 * rolling into March.
 */
function monthsAhead(n) {
  const today = new Date()
  const y = today.getFullYear(), m = today.getMonth(), d = today.getDate()
  const lastOfTarget = new Date(Date.UTC(y, m + n + 1, 0)).getUTCDate()
  const when = new Date(Date.UTC(y, m + n, Math.min(d, lastOfTarget)))
  return when.toISOString().slice(0, 10)
}

// Share filters between the summary counts and their employee lists.
function filterStatus(q, name) {
  const status = (lookups.statuses ?? []).find(([, label]) => label === name)
  if (!status) throw new Error(`Employee status unavailable: ${name}`)
  return q.eq('status_id', status[0])
}

const totalLists = {
  absent: {
    title: 'Absent',
    apply: (q) => filterStatus(q, 'Absent'),
  },
  suspended: {
    title: 'Suspended',
    apply: (q) => filterStatus(q, 'Suspended'),
  },
  onLeave: {
    title: 'On leave',
    apply: (q) => filterStatus(q, 'On Leave'),
  },
  uninsured: {
    title: 'Non-insured',
    apply: (q) => q.eq('is_active', true).is('si_date', null),
  },
  contracts: {
    title: 'Contracts due/expired',
    apply: (q) => q.eq('is_active', true).not('contract_expiry', 'is', null).lte('contract_expiry', monthsAhead(4)),
  },
  incomplete: {
    title: 'Non completed files',
    apply: (q) => q.eq('file_complete', false),
  },
}

let totalListSequence = 0

async function showTotalList(key) {
  const list = totalLists[key]
  if (!list) return
  const sequence = ++totalListSequence
  const dialog = $('totalDialog')
  $('totalDialogTitle').textContent = list.title
  $('totalDialogStatus').textContent = 'Loading employees…'
  $('totalDialogTable').hidden = true
  $('totalDialogRows').replaceChildren()
  if (!dialog.open) dialog.showModal()
  try {
    // Fetch every page so large lists are not cut off by the API row limit.
    const employees = []
    const pageSize = 500
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await list.apply(
        supabase.from('employee_profiles').select('id, code, name'),
      ).order('code').order('id').range(offset, offset + pageSize - 1)
      if (sequence !== totalListSequence || !dialog.open) return
      if (error) throw error
      employees.push(...(data ?? []))
      if (!data || data.length < pageSize) break
    }
    const rows = document.createDocumentFragment()
    for (const employee of employees) {
      const row = document.createElement('tr')
      for (const value of [employee.code, employee.name]) {
        const cell = document.createElement('td')
        cell.textContent = value ?? '—'
        row.appendChild(cell)
      }
      rows.appendChild(row)
    }
    $('totalDialogRows').replaceChildren(rows)
    $('totalDialogTable').hidden = employees.length === 0
    $('totalDialogStatus').textContent = employees.length
      ? `${employees.length} employee${employees.length === 1 ? '' : 's'}`
      : 'No matching employees.'
  } catch {
    if (sequence !== totalListSequence || !dialog.open) return
    $('totalDialogStatus').textContent = 'Could not load employees. Close this window and try again.'
  }
}

document.querySelectorAll('[data-total-list]').forEach((button) => {
  button.addEventListener('click', () => showTotalList(button.dataset.totalList))
})
$('closeTotalDialog').addEventListener('click', () => $('totalDialog').close())
$('totalDialog').addEventListener('close', () => { totalListSequence++ })

async function loadTotals() {
  const count = async (apply) => {
    try {
      const { count: n, error } = await apply(
        supabase.from('employee_profiles').select('id', { count: 'exact', head: true }),
      )
      return error ? null : n
    } catch {
      return null
    }
  }
  const [listed, onBoard, uninsured, contracts, incomplete, absent, suspended, onLeave] = await Promise.all([
    count((q) => q),
    count((q) => q.eq('is_active', true)),
    // On board with no insurance date on file. "On board" is the same
    // test as the tile beside it, the Active flag, so the two numbers are
    // always read against each other rather than against two different
    // populations.
    count(totalLists.uninsured.apply),
    // Expired, or expiring within four months. Scoped to active
    // employees: nobody chases a renewal for somebody who has left.
    count(totalLists.contracts.apply),
    count(totalLists.incomplete.apply),
    count(totalLists.absent.apply),
    count(totalLists.suspended.apply),
    count(totalLists.onLeave.apply),
  ])
  $('totalListed').textContent = listed ?? '—'
  $('totalOnBoard').textContent = onBoard ?? '—'
  $('totalUninsured').textContent = uninsured ?? '—'
  $('totalContracts').textContent = contracts ?? '—'
  $('totalIncomplete').textContent = incomplete ?? '—'
  $('totalAbsent').textContent = absent ?? '—'
  $('totalSuspended').textContent = suspended ?? '—'
  $('totalOnLeave').textContent = onLeave ?? '—'
}

/**
 * Name, code and title on one line, with the role beside it.
 *
 * The same shape as the portal home page's bar, because it is the same
 * bar: this page draws it from the same stylesheet, and two bars that
 * look alike should say the same things in the same order.
 */
function fillPageBar(who) {
  const line = $('whoami')
  const badge = $('roleBadge')
  if (!line || !badge) return

  line.textContent = ''
  const name = document.createElement('span')
  name.className = 'who-name'
  name.textContent = who.name ?? ''
  line.appendChild(name)


  badge.textContent = who.role === 'super_admin' ? 'Super admin' : 'Admin'
  badge.className = `role-badge ${who.role === 'super_admin' ? 'is-super' : 'is-admin'}`
  badge.hidden = false
}


/* What the portal already knows.

   Opening this page from the main page is the ordinary case, and by
   then the portal has asked who you are and left the answer in
   sessionStorage -- same origin, same tab, no network. Reading it is
   the difference between the page appearing at once and showing
   "Checking your access" for as long as a round trip to Frankfurt
   takes. One sign-in, one session: a page inside it should not make a
   show of re-checking.

   A cache, not an authority. The real check still runs below and still
   corrects the page if the answer has moved on, and behind all of it
   row level security is what actually decides what can be read. */
const PORTAL_PROFILE_KEY = 'ienergy_portal_profile_v1'
const SESSION_KEY = 'sb-ednaedkurjsgvjrvayys-auth-token'

function storedSessionLooksValid() {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return false
    const expiresAt = Number(JSON.parse(raw)?.expires_at)
    // No expiry recorded: let the server judge rather than throw away a
    // session that may well be good.
    if (!Number.isFinite(expiresAt)) return true
    return expiresAt * 1000 > Date.now()
  } catch (_) {
    return false
  }
}

function cachedProfile() {
  try {
    const raw = JSON.parse(sessionStorage.getItem(PORTAL_PROFILE_KEY))
    // trackerRole is the one that says admin from super admin. The
    // portal collapses both into "admin" for its own purposes, which is
    // not the question this page asks.
    if (!raw || !raw.id || !raw.trackerRole) return null
    return { id: raw.id, code: raw.code, name: raw.name, title: raw.title, role: raw.trackerRole }
  } catch (_) {
    return null
  }
}

const mayEdit = (role) => role === 'admin' || role === 'super_admin'

/* Everything that happens once somebody is known to be allowed in.
   Pulled out of start() because it now runs from two places: once
   straight away from the cache, and once more if the confirmation
   disagrees about who you are. */
function openPage(who) {
  me = who
  fillPageBar(me)
  $('newBtn').hidden = false
  $('saveBtn').hidden = false

  $('gate').hidden = true
  $('app').hidden = false
  $('year').textContent = new Date().getFullYear()

  // Bring the theme switch into the page bar now that the bar is on
  // screen. It is left floating at the top right until then, so the
  // sign-in screen still has one -- a slot inside the hidden app would
  // have swallowed it.
  const slot = $('themeSlot')
  const toggle = document.querySelector('.theme-toggle')
  if (slot && toggle) slot.appendChild(toggle)
}
async function start() {
  /* Decide from what is on this machine first.

     Three states, and only one of them is a panel. Known and allowed:
     draw the page now. Nothing stored at all: the sign-in panel is the
     right answer immediately, no waiting. A token but nothing cached --
     the first page of a session, or this page opened in a new tab --
     shows neither, because a blank moment is honest where a panel would
     be a claim we are about to take back. */
  const hasToken = storedSessionLooksValid()
  const known = hasToken ? cachedProfile() : null
  let drawn = false

  if (known && mayEdit(known.role)) {
    openPage(known)
    drawn = true
    // The lists and the totals need no permission beyond the session,
    // so they can start loading while the check below runs.
    loadLookups().then(loadTotals).catch(() => {})
  } else if (!hasToken) {
    // No session: there is one sign-in and it is not here. Send them to
    // it rather than showing a second one.
    showGate('You are not signed in. Sign in at iEnergy Home and come back.')
    setTimeout(() => { location.replace('../index.html') }, 1200)
    return
  }

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    showGate('You are not signed in. Sign in at iEnergy Home and come back.')
    setTimeout(() => { location.replace('../index.html') }, 1200)
    return
  }

  const { data, error } = await supabase
    .from('employees')
    .select('id, code, name, title, role')
    .eq('auth_user_id', user.id)
    .maybeSingle()

  if (error || !data) {
    showAuthError(
      'That account is not linked to an employee record, so it cannot read the database.',
    )
    return
  }

  // Personnel records are an administrator's job. A user could only ever
  // read them, and the whole file -- national IDs, wages, documents -- is
  // not something to put in front of somebody who has no business editing
  // it. Row level security says the same thing from the other side.
  if (!mayEdit(data.role)) {
    showGate(
      `Signed in as ${data.name}, but the Employee Database is open to administrators only.`,
    )
    return
  }

  if (drawn) {
    /* The page was drawn from the cache and the server agrees somebody
       may edit. Refresh the identity in case a name or title changed,
       and stop -- the lists are already loading. Reloading here would
       throw away a page the person is probably already using. */
    me = data
    fillPageBar(me)
    return
  }

  openPage(data)
  await loadLookups()
  await loadTotals()
}

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

async function runSearch(term) {
  const safe = filterValue(term)
  if (!safe) {
    $('matches').hidden = true
    $('searchHint').textContent = 'Type to search.'
    return
  }
  const seq = ++searchSeq
  $('searchHint').textContent = 'Searching…'

  const pattern = `"*${safe}*"`
  const parts = [`name.ilike.${pattern}`, `arabic_name.ilike.${pattern}`]
  if (/^\d+$/.test(safe)) parts.push(`code.eq.${safe}`)

  const { data, error } = await supabase
    .from('employee_profiles')
    .select('id, code, name, arabic_name, title, is_active, file_complete')
    .or(parts.join(','))
    .order('code')
    .limit(25)

  if (seq !== searchSeq) return
  if (error) {
    $('searchHint').textContent = `Could not search: ${error.message}`
    $('matches').hidden = true
    return
  }
  renderMatches(data ?? [], safe)
}

function renderMatches(rows, term) {
  const list = $('matchesList')
  list.innerHTML = ''
  if (!rows.length) {
    $('matches').hidden = true
    $('searchHint').textContent = `No employee matches “${term}”.`
    return
  }
  $('searchHint').textContent = `${rows.length}${rows.length === 25 ? '+' : ''} match${rows.length === 1 ? '' : 'es'}.`
  for (const row of rows) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'match-item'
    btn.innerHTML =
      '<div class="match-top"><div class="match-name"></div><div class="match-code"></div></div>' +
      '<div class="match-sub"></div>'
    btn.querySelector('.match-name').textContent = row.name || row.arabic_name || '—'
    btn.querySelector('.match-code').textContent = row.code ?? '—'
    const bits = [row.title, row.is_active ? null : 'inactive', row.file_complete ? null : 'file incomplete']
    btn.querySelector('.match-sub').textContent = bits.filter(Boolean).join(' • ') || '—'
    btn.addEventListener('click', () => openEmployee(row.id))
    list.appendChild(btn)
  }
  $('matches').hidden = false
}

$('searchInput').addEventListener('input', (e) => {
  const term = e.target.value
  clearTimeout(searchTimer)
  if (!term.trim()) {
    searchSeq++
    $('matches').hidden = true
    $('searchHint').textContent = 'Type to search.'
    return
  }
  searchTimer = setTimeout(() => runSearch(term), 220)
})

/* There is no Clear button: emptying the box clears the search, which the
   handler above already does, and New employee empties it as well. */

/* ------------------------------------------------------------------ */
/* The form                                                            */
/* ------------------------------------------------------------------ */

function fieldControl(field, value) {
  // A date is a text box with a picker button beside it, and the button
  // inside a <label> would steal the click, so dates get a plain div.
  const wrap = document.createElement(field.type === 'date' ? 'div' : 'label')
  wrap.className = field.half ? 'db-field db-field-half' : 'db-field'
  const label = document.createElement('span')
  label.className = 'db-label'
  label.textContent = field.label + (isRequired(field.key) ? ' *' : '')
  wrap.appendChild(label)

  let input
  if (field.type === 'select') {
    input = document.createElement('select')
    input.className = 'input'
    const options = field.options ?? lookups[field.source] ?? []
    // Bus route offers no blank: None is one of the routes, so "does not
    // take the bus" is a choice somebody made rather than a field they
    // skipped. Every employee holds one, which the column now enforces.
    if (!field.noBlank) {
      const blank = document.createElement('option')
      blank.value = ''
      blank.textContent = '—'
      input.appendChild(blank)
    }
    for (const [val, text] of options) {
      const opt = document.createElement('option')
      opt.value = String(val)
      opt.textContent = text
      input.appendChild(opt)
    }
    input.value = value == null ? '' : String(value)
    // A value the list does not hold -- nothing chosen yet on a blankless
    // select -- would leave the box showing nothing at all. Fall to the
    // first option, which for the bus route is None.
    if (field.noBlank && !input.value && input.options.length) input.selectedIndex = 0
  } else if (field.type === 'checkbox') {
    input = document.createElement('input')
    input.type = 'checkbox'
    input.className = 'db-check'
    input.checked = !!value
  } else if (field.type === 'sicode') {
    input = document.createElement('input')
    input.className = 'input'
    input.type = 'text'
    input.setAttribute('list', 'siCodeList')
    input.placeholder = 'Code or title…'
    input.value = value ?? ''
    input.addEventListener('input', () => siCodeLookup(input.value))
  } else if (field.type === 'date') {
    input = dateControl(value)
  } else {
    input = document.createElement('input')
    input.className = 'input'
    input.type = field.type === 'number' ? 'number' : 'text'
    if (field.dir) input.dir = field.dir
    if (field.placeholder) input.placeholder = field.placeholder
    input.value = value ?? ''
    if (field.type === 'digits') {
      input.inputMode = 'numeric'
      input.maxLength = field.maxLength ?? 20
      input.addEventListener('input', () => {
        input.value = onlyDigits(input.value, field.maxLength ?? 20)
      })
    }
    if (field.type === 'money') {
      input.inputMode = 'numeric'
      input.value = value == null || value === '' ? '' : formatMoney(Math.round(Number(value)))
      input.addEventListener('input', () => { input.value = formatMoney(input.value) })
    }
    if (field.type === 'mobile') {
      input.type = 'tel'
      input.inputMode = 'numeric'
      input.maxLength = 13
      input.placeholder = '012-3456-7890'
      input.value = value ? formatMobile(value) : ''
      input.addEventListener('input', () => { input.value = formatMobile(input.value) })
    }
  }
  input.id = `f_${field.key}`
  input.dataset.key = field.key
  input.dataset.kind = field.type

  // The fields the calculated panel is built from, kept live as they are
  // typed rather than only refreshed on save.
  if (['national_id', 'hired_on', 'id_expiry_date'].includes(field.key)) {
    input.addEventListener('input', renderDerived)
  }
  if (field.key === 'si_code') {
    input.addEventListener('change', () => resolveSiTitle(input.value))
    input.addEventListener('input', () => { derivedSiTitle = null; renderDerived() })
  }

  // A date input lives inside its row, next to the picker button.
  wrap.appendChild(field.type === 'date' ? input.parentNode : input)

  if (field.hint) {
    const hint = document.createElement('span')
    hint.className = 'db-hint'
    hint.textContent = field.hint
    wrap.appendChild(hint)
  }
  return wrap
}

/**
 * A date box that reads 15-Jan-2026 whoever is looking at it.
 *
 * The browser's own date input is formatted by the machine's locale, so
 * the same record shows 03-04-2026 to one person and 04-03-2026 to
 * another, and the empty box reads dd-----yyyy. This is a text box that
 * always writes the month in letters, with the native picker kept beside
 * it -- hidden, but still doing the calendar work. The day it holds is on
 * the box as data-iso, which is what the form reads and the database
 * stores; the text is only how it is shown.
 */
function dateControl(value) {
  const row = document.createElement('span')
  row.className = 'db-date'

  const input = document.createElement('input')
  input.className = 'input db-date-text'
  input.type = 'text'
  input.autocomplete = 'off'
  input.placeholder = 'dd-mmm-yyyy'
  input.dataset.iso = isoToDMY(value) ? String(value).slice(0, 10) : ''
  input.value = isoToDMY(value)

  const native = document.createElement('input')
  native.type = 'date'
  native.className = 'db-date-native'
  native.tabIndex = -1
  native.setAttribute('aria-hidden', 'true')
  native.value = input.dataset.iso

  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'db-date-btn'
  button.title = 'Pick a date'
  button.setAttribute('aria-label', 'Pick a date')
  button.textContent = '▾'

  const settle = (iso) => {
    input.dataset.iso = iso || ''
    input.value = iso ? isoToDMY(iso) : ''
    native.value = iso || ''
    input.classList.remove('bad')
    renderDerived()
  }

  // Typed text is left exactly as typed while it is being typed -- a box
  // that rewrites itself under the cursor is unusable -- and tidied when
  // the field is left.
  input.addEventListener('blur', () => {
    const iso = parseDateInput(input.value)
    if (iso === null) {
      input.dataset.iso = ''
      input.classList.add('bad')
      renderDerived()
      return
    }
    settle(iso)
  })
  input.addEventListener('input', () => {
    const iso = parseDateInput(input.value)
    input.dataset.iso = iso || ''
    input.classList.toggle('bad', iso === null && input.value.trim() !== '')
    renderDerived()
  })

  native.addEventListener('change', () => settle(native.value))
  button.addEventListener('click', () => {
    native.value = input.dataset.iso || ''
    // showPicker is the only way to open the calendar without showing the
    // input; where it is missing the native box is focused instead, which
    // opens it in every browser that lacks it.
    if (typeof native.showPicker === 'function') {
      try { native.showPicker(); return } catch { /* refused outside a gesture */ }
    }
    native.focus()
    native.click()
  })

  row.appendChild(input)
  row.appendChild(native)
  row.appendChild(button)
  return input
}

/* ------------------------------------------------------------------ */
/* Values the system works out for itself                              */
/* ------------------------------------------------------------------ */

const pad2 = (n) => String(n).padStart(2, '0')
// Same shape as the date boxes: the month in letters, so a day never
// reads as a different day depending on who opens the file.
const asDMY = (d) => `${pad2(d.getUTCDate())}-${MONTHS[d.getUTCMonth()]}-${d.getUTCFullYear()}`

/** The parts of an Egyptian national ID, or null when it is not one. */
function readNationalId(id) {
  const value = String(id ?? '').trim()
  if (!/^[23]\d{13}$/.test(value)) return null
  const year = (value[0] === '2' ? 1900 : 2000) + Number(value.slice(1, 3))
  const month = Number(value.slice(3, 5))
  const day = Number(value.slice(5, 7))
  const date = new Date(Date.UTC(year, month - 1, day))
  const real = date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  return {
    birthDate: real ? date : null,
    gender: Number(value[12]) % 2 === 1 ? 'Male' : 'Female',
    governorate: lookups.governorates?.[Number(value.slice(7, 9))] ?? null,
  }
}

/** Whole years and months between two dates, as "3y 2m". */
function spanFrom(fromISO) {
  const from = new Date(`${fromISO}T00:00:00Z`)
  if (Number.isNaN(from.getTime())) return null
  const now = new Date()
  let months =
    (now.getUTCFullYear() - from.getUTCFullYear()) * 12 + (now.getUTCMonth() - from.getUTCMonth())
  if (now.getUTCDate() < from.getUTCDate()) months -= 1
  if (months < 0) return null
  return `${Math.floor(months / 12)}y ${months % 12}m`
}

/**
 * The last day of a one-year contract: the day before the anniversary.
 *
 * Hired 11 Nov 2025, expires 10 Nov 2026.
 *
 * This has to give the same answer as contract_expiry on the view, which
 * is what the totals and the export read -- and the two languages do not
 * agree about a date that overshoots its month. Postgres clamps 29 Feb
 * plus a year to 28 Feb; JavaScript rolls it forward to 1 March. So the
 * clamp is done here by hand rather than left to setUTCFullYear, which
 * for a hire on 1 Mar 2024 is the difference between ending on 28 Feb
 * 2025 and claiming another year.
 */
function contractExpiry(hiredISO) {
  const from = new Date(`${hiredISO}T00:00:00Z`)
  if (Number.isNaN(from.getTime())) return null
  const less = new Date(from.getTime() - 86400000)
  const year = less.getUTCFullYear() + 1
  const month = less.getUTCMonth()
  const lastOfMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return new Date(Date.UTC(year, month, Math.min(less.getUTCDate(), lastOfMonth)))
}

function daysUntil(iso) {
  const when = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(when.getTime())) return null
  const today = new Date()
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  return Math.round((when.getTime() - start) / 86400000)
}

/**
 * The calculated half of the record, refreshed from whatever is currently
 * in the form. Shown as soon as an employee is selected rather than only
 * after a save, because the whole point of deriving them is that nobody
 * has to work them out or wait.
 */
function renderDerived() {
  const panel = $('derivedPanel')
  if (!panel) return
  // A date box shows 15-Jan-2026 and carries the day it means as data-iso;
  // everything downstream here wants the ISO day.
  const val = (key) => {
    const el = $(`f_${key}`)
    if (!el) return ''
    return String((el.dataset.kind === 'date' ? el.dataset.iso : el.value) ?? '').trim()
  }
  const items = []

  const id = readNationalId(val('national_id'))
  if (val('national_id')) {
    items.push(['Birth date', id?.birthDate ? asDMY(id.birthDate) : 'not a real date', id?.birthDate ? '' : 'bad'])
    items.push(['Gender', id?.gender ?? '—', id ? '' : 'bad'])
    items.push(['Governorate', id?.governorate ?? (id ? 'code not listed' : '—'), id?.governorate ? '' : 'muted'])
  } else {
    items.push(['Birth date', 'needs the ID No.', 'muted'])
    items.push(['Gender', 'needs the ID No.', 'muted'])
    items.push(['Governorate', 'needs the ID No.', 'muted'])
  }

  // The insurance title belongs to the code; it comes back with the row
  // and is refreshed when the code changes.
  items.push(['S.I. title', derivedSiTitle ?? (val('si_code') ? 'looking up…' : '—'),
    derivedSiTitle ? '' : 'muted'])

  const hired = val('hired_on')
  if (hired) {
    items.push(['Working period', spanFrom(hired) ?? 'starts in the future', 'muted'])
    const contract = contractExpiry(hired)
    if (contract) {
      const left = daysUntil(contract.toISOString().slice(0, 10))
      items.push([
        'Contract expiry',
        `${asDMY(contract)} · ${expiryStatus(contract.toISOString().slice(0, 10))}`,
        left != null && left < 0 ? 'bad' : left != null && left <= 30 ? 'warn' : '',
      ])
    }
  } else {
    items.push(['Working period', 'needs the hiring date', 'muted'])
    items.push(['Contract expiry', 'needs the hiring date', 'muted'])
  }

  // The workbook asks for a warning a month before the ID runs out.
  const expiry = val('id_expiry_date')
  if (expiry) {
    const left = daysUntil(expiry)
    items.push([
      'ID expiry',
      expiryStatus(expiry),
      left == null ? '' : left < 0 ? 'bad' : left <= 30 ? 'warn' : '',
    ])
  } else {
    items.push(['ID expiry', 'not recorded', 'muted'])
  }

  // Just the count. The checklist is immediately below and already shows
  // which ones are unticked, so naming them here only made the line long.
  const missing = DOCUMENTS.filter(([key]) => !$(`f_${key}`)?.checked).length
  items.push([
    'File status',
    missing ? `Missing (${missing})` : 'Complete',
    missing ? 'warn' : 'good',
  ])

  panel.innerHTML = ''
  for (const [key, value, tone] of items) {
    const cell = document.createElement('div')
    cell.className = 'derived-item'
    const k = document.createElement('div')
    k.className = 'derived-key'
    k.textContent = key
    const v = document.createElement('div')
    v.className = `derived-val${tone ? ` ${tone}` : ''}`
    v.textContent = value
    cell.appendChild(k)
    cell.appendChild(v)
    panel.appendChild(cell)
  }
  panel.hidden = false
}

let derivedSiTitle = null

/* What used to sit under the ID box -- birth date, gender, governorate --
   is in the calculated panel above the form, which is where every other
   derived value already was. Saying it twice only made the ID field tall. */

/** The official title for a code, for the calculated panel. */
async function resolveSiTitle(code) {
  const value = String(code ?? '').trim()
  if (!value) { derivedSiTitle = null; renderDerived(); return }
  const { data } = await supabase.from('si_codes').select('title').eq('code', value).maybeSingle()
  derivedSiTitle = data?.title ?? 'not in the official list'
  renderDerived()
}

async function siCodeLookup(term) {
  const safe = filterValue(term)
  if (safe.length < 2) return
  const { data } = await supabase
    .from('si_codes')
    .select('code, title')
    .or(`code.ilike."*${safe}*",title.ilike."*${safe}*"`)
    .limit(20)
  const list = $('siCodeList')
  if (!list) return
  list.innerHTML = ''
  for (const row of data ?? []) {
    const opt = document.createElement('option')
    opt.value = row.code
    opt.textContent = `${row.code} — ${row.title}`
    list.appendChild(opt)
  }
}

function renderForm(employee) {
  current = employee
  const form = $('employeeForm')
  form.innerHTML = ''

  const datalist = document.createElement('datalist')
  datalist.id = 'siCodeList'
  form.appendChild(datalist)

  for (const group of GROUPS) {
    const section = document.createElement('fieldset')
    section.className = 'db-group'
    const legend = document.createElement('legend')
    legend.textContent = group.title
    section.appendChild(legend)
    const grid = document.createElement('div')
    grid.className = 'db-grid'
    if (group.columns) grid.dataset.cols = String(group.columns)
    for (const field of group.fields) grid.appendChild(fieldControl(field, employee[field.key]))
    section.appendChild(grid)
    form.appendChild(section)
  }

  // Payroll switches: one row of five, in their own section. What the
  // monthly report pays is a different question from what is in the
  // personnel file, so they do not share a block with the documents.
  const pay = document.createElement('fieldset')
  pay.className = 'db-group db-group-wide'
  const payLegend = document.createElement('legend')
  payLegend.textContent = 'Payroll'
  pay.appendChild(payLegend)
  const payGrid = document.createElement('div')
  payGrid.className = 'db-switches'
  for (const [key, label] of PAYROLL) {
    const wrap = document.createElement('label')
    wrap.className = 'db-doc'
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.id = `f_${key}`
    box.dataset.key = key
    box.checked = !!employee[key]
    const text = document.createElement('span')
    text.textContent = label
    wrap.appendChild(box)
    wrap.appendChild(text)
    payGrid.appendChild(wrap)
  }
  pay.appendChild(payGrid)
  form.appendChild(pay)

  // The eleven tick boxes decide whether the file counts as complete, so
  // they read better as one block than scattered through the rest.
  const docs = document.createElement('fieldset')
  docs.className = 'db-group db-group-wide'
  const legend = document.createElement('legend')
  legend.textContent = 'Personnel file'
  docs.appendChild(legend)
  const docGrid = document.createElement('div')
  docGrid.className = 'db-docs'
  for (const [key, label] of DOCUMENTS) {
    const wrap = document.createElement('label')
    wrap.className = 'db-doc'
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.id = `f_${key}`
    box.dataset.key = key
    box.checked = !!employee[key]
    box.addEventListener('change', updateFileStatus)
    const text = document.createElement('span')
    text.textContent = key === 'doc_military_certificate' ? `${label} (males only)` : label
    wrap.appendChild(box)
    wrap.appendChild(text)
    docGrid.appendChild(wrap)
  }
  docs.appendChild(docGrid)
  form.appendChild(docs)

  if (!(me?.role === 'admin' || me?.role === 'super_admin')) {
    form.querySelectorAll('input, select').forEach((el) => { el.disabled = true })
  }

  updateFileStatus()
  renderDerived()
  $('editorTitle').textContent = employee.id
    ? `Edit ${employee.name || employee.arabic_name || 'employee'}`
    : 'New employee'
  $('editor').hidden = false
  $('editor').scrollIntoView({ behavior: 'smooth', block: 'start' })
}

/**
 * The file status is reported once, in the calculated panel, alongside
 * the other things the system works out. It was repeated beside the
 * employee name as well, which said the same thing twice and put it
 * furthest from the checklist it describes.
 */
function updateFileStatus() {
  renderDerived()
}

async function openEmployee(id) {
  const { data, error } = await supabase.from('employee_profiles').select('*').eq('id', id).single()
  if (error) {
    $('searchHint').textContent = `Could not open that record: ${error.message}`
    return
  }
  // The view already resolved the insurance title for this code, so the
  // calculated panel can show it without another round trip.
  derivedSiTitle = data.si_title ?? null
  if (data.si_code) siCodeLookup(data.si_code)
  $('formError').hidden = true
  renderForm(data)
  settleSearchOn(data)
}

/**
 * After a choice, the search box holds the chosen name and the list of
 * matches goes away -- the same way the contacts page behaves. Leaving
 * the list open underneath invites a second click on the record that is
 * already open, and leaving the typed fragment in the box makes it hard
 * to tell which employee is being edited.
 */
function settleSearchOn(employee) {
  // A search still in flight would otherwise reopen the list behind us.
  searchSeq++
  clearTimeout(searchTimer)

  const input = $('searchInput')
  if (input) input.value = employee.name || employee.arabic_name || String(employee.code ?? '')

  $('matchesList').innerHTML = ''
  $('matches').hidden = true
  $('searchHint').textContent = 'Editing #' + employee.code + (employee.name ? ' - ' + employee.name : '')
}

$('newBtn').addEventListener('click', () => {
  $('formNotice').hidden = true
  $('formError').hidden = true
  derivedSiTitle = null
  // A blank record is not the employee that was searched for, so the box
  // should not still be naming them.
  searchSeq++
  clearTimeout(searchTimer)
  $('searchInput').value = ''
  $('matches').hidden = true
  $('searchHint').textContent = 'Type to search.'
  renderForm({
    // What almost every new record is: somebody starting work, off on
    // Fridays. Anything else is a correction, and correcting a wrong
    // default is quicker than filling an empty one every time.
    status_id: (lookups.statuses ?? []).find(([, name]) => name === 'On Board')?.[0] ?? null,
    weekend: 'fri',
    // Most people do not take the bus, and the field has no blank to
    // leave it on. Seeded explicitly so the form and the database agree
    // about what an untouched new record holds.
    bus_route_id:
      (lookups.busRoutes ?? []).find(([, name]) => String(name).toLowerCase() === 'none')?.[0] ??
      (lookups.busRoutes ?? [])[0]?.[0] ??
      null,
    // Every payroll component starts on; HR turns off the ones that do
    // not apply. Same as the column defaults in the database.
    ...Object.fromEntries(PAYROLL.map(([key]) => [key, true])),
    // Both start at zero, which is also what the columns default to, so
    // a record created any other way reads the same. An entitlement
    // nobody typed is a number nobody checked, and days get consumed
    // against it from the first leave recorded.
    annual_leave_balance: 0,
    unplanned_leave_balance: 0,
  })
})

$('cancelBtn').addEventListener('click', () => {
  $('editor').hidden = true
  current = null
})

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

/** Everything, in pages, because a select with no range stops at 1,000. */
async function fetchAllProfiles() {
  const size = 500
  const all = []
  for (let from = 0; ; from += size) {
    const { data, error } = await supabase
      .from('employee_profiles')
      .select('*')
      .order('code')
      .range(from, from + size - 1)
    if (error) throw error
    all.push(...(data ?? []))
    if ((data?.length ?? 0) < size) return all
  }
}

const nameFrom = (pairs, id) => (pairs ?? []).find(([value]) => value === id)?.[1] ?? ''

/**
 * A number Excel can add up, or a blank cell. Never the string "16700.00",
 * which Excel treats as text and refuses to total. Blank is null rather
 * than an empty string, so the cell is genuinely empty in a column that is
 * meant to be summed.
 */
const asNumber = (v) => (v == null || v === '' ? null : Number(v))

/** Whole years since a day, for an age or a length of service. */
function yearsSince(iso) {
  const from = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(from.getTime())) return ''
  const now = new Date()
  let years = now.getUTCFullYear() - from.getUTCFullYear()
  const before =
    now.getUTCMonth() < from.getUTCMonth() ||
    (now.getUTCMonth() === from.getUTCMonth() && now.getUTCDate() < from.getUTCDate())
  if (before) years -= 1
  return years < 0 ? '' : years
}

/** Completed calendar months; partial months never display as zero days. */
function expiryStatus(iso, today = new Date()) {
  if (!iso) return ''
  const target = new Date(iso + 'T00:00:00Z')
  if (Number.isNaN(target.getTime())) return ''
  const now = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
  if (+target === +now) return 'Expires today'
  const expired = target < now
  const start = expired ? target : now
  const end = expired ? now : target
  let months = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth()
  const month = start.getUTCMonth() + months
  const lastDay = new Date(Date.UTC(start.getUTCFullYear(), month + 1, 0)).getUTCDate()
  const anniversary = new Date(Date.UTC(start.getUTCFullYear(), month, Math.min(start.getUTCDate(), lastDay)))
  if (anniversary > end) months--
  const years = Math.floor(months / 12)
  const remainder = months % 12
  const parts = []
  if (years) parts.push(years + (years === 1 ? ' year' : ' years'))
  if (remainder) parts.push(remainder + (remainder === 1 ? ' month' : ' months'))
  const period = parts.join(' ') || 'less than 1 month'
  return expired ? 'Expired ' + period + ' ago' : period + ' left'
}

/**
 * One row per employee: every column of the record, with the values the
 * system works out beside the ones they are worked out from.
 *
 * Every derived value is taken from the view rather than recomputed here.
 * The page used to read the birth date and gender out of the national ID
 * itself, which meant two pieces of code deciding the same thing and a
 * file that could disagree with the screen that produced it.
 */
function exportRow(e) {
  const missing = e.missing_documents ?? []
  const yn = (v) => (v ? 'Yes' : 'No')

  return {
    /* Identity, and what the ID says */
    'Code': e.code,
    'Name': e.name,
    'Arabic name': e.arabic_name ?? '',
    'ID No.': e.national_id ?? '',
    'Birth date': isoToDMY(e.birth_date),
    'Age': e.birth_date ? yearsSince(e.birth_date) : '',
    'Gender': e.gender ?? '',
    'Governorate code': e.governorate_code ?? '',
    'Governorate': e.governorate ?? '',
    'ID expiry': isoToDMY(e.id_expiry_date),
    'ID expiry status': expiryStatus(e.id_expiry_date),

    /* Employment */
    'Job title': e.title ?? '',
    'Site': nameFrom(lookups.sites, e.site_id),
    'Department': nameFrom(lookups.departments, e.department_id),
    'Status': nameFrom(lookups.statuses, e.status_id),
    // Active is not stored any more: it follows the status.
    'Active': yn(e.is_active),
    'Hiring date': isoToDMY(e.hired_on),
    'Working period': e.hired_on ? spanFrom(e.hired_on) ?? '' : '',
    'Contract expiry': isoToDMY(e.contract_expiry),
    'Contract status': expiryStatus(e.contract_expiry),
    'Weekend': e.weekend === 'fri' ? 'Friday only' : 'Friday + Saturday',
    'Bus route': e.bus_route ?? '',

    /* Leave balances */
    'Annual leave (days)': asNumber(e.annual_leave_balance),
    'Un-planned leave (days)': asNumber(e.unplanned_leave_balance),

    /* Social insurance */
    'S.I. No.': e.si_no ?? '',
    'S.I. date': isoToDMY(e.si_date),
    // The same test as the Non insured tile on the page.
    'Insured': yn(e.si_date),
    'S.I. code': e.si_code ?? '',
    'S.I. title': e.si_title ?? '',
    'S.I. basic wage': asNumber(e.si_basic_wage),
    'S.I. gross wage': asNumber(e.si_gross_wage),

    /* What the monthly report pays */
    ...Object.fromEntries(PAYROLL.map(([key, label]) => [label, yn(e[key])])),

    /* Contact */
    'Email': e.email ?? '',
    'Company mobile': e.company_mobile ?? '',
    'Personal mobile': e.personal_mobile ?? '',
    'Secondary mobile': e.secondary_mobile ?? '',
    'Secondary number belongs to': e.secondary_mobile_name ?? '',
    'Office number': e.office_number ?? '',

    /* Personal */
    'Military service status': e.military_service ?? '',
    'Marital status': e.marital_status ?? '',
    'Religion': e.religion ?? '',
    'Qualification degree': e.qualification_degree ?? '',
    'Qualification degree (Arabic)': e.qualification_degree_ar ?? '',
    'Education field': e.education_field ?? '',

    /* Personnel file */
    ...Object.fromEntries(DOCUMENTS.map(([key, label]) => [label, yn(e[key])])),
    'File status': e.file_complete ? 'Complete' : `Missing (${missing.length})`,
    'Missing documents': missing.join(', '),

    /* Leaving */
    'Notice date': isoToDMY(e.notice_date),
    'Resignation date': isoToDMY(e.resignation_date),
    'Resignation reason': e.resignation_reason ?? '',

    /* The account, which is a different question from the person */
    'Username': e.username ?? '',
    'Role': { super_admin: 'Super admin', admin: 'Admin', user: 'User', no_access: 'No access' }[e.role] ?? e.role ?? '',
    'Can sign in': yn(e.auth_user_id),

    /* When the record itself was touched */
    'Added on': isoToDMY(String(e.created_at ?? '').slice(0, 10)),
    'Last changed': isoToDMY(String(e.updated_at ?? '').slice(0, 10)),
  }
}


// Use the browser print dialog, just like the employee report.
$('employeePrintBtn').addEventListener('click', () => window.print())

// Printed values wrap instead of being clipped inside single-line controls.
window.addEventListener('beforeprint', () => {
  document.querySelectorAll('.db-print-value').forEach(el => el.remove())
  $('employeeForm').querySelectorAll('[id^="f_"]').forEach(input => {
    const value = document.createElement('span')
    value.className = 'db-print-value'
    value.dir = input.dir || 'auto'
    value.textContent = input.type === 'checkbox' ? (input.checked ? 'Yes' : 'No')
      : input.tagName === 'SELECT' ? (input.selectedOptions[0]?.textContent || '—')
      : input.value || '—'
    input.after(value)
  })
})
window.addEventListener('afterprint', () => {
  document.querySelectorAll('.db-print-value').forEach(el => el.remove())
})

$('exportBtn').addEventListener('click', async () => {
  const btn = $('exportBtn')
  btn.disabled = true
  btn.textContent = 'Preparing…'
  try {
    // Loaded on demand: most visits never export, and the library is far
    // bigger than this page.
    const module = await import('https://cdn.jsdelivr.net/npm/exceljs@4.4.0/+esm')
    const ExcelJS = module.default ?? module
    const rows = (await fetchAllProfiles()).map(exportRow)
    if (!rows.length) throw new Error('There is nothing to export.')

    const book = buildEmployeeWorkbook(ExcelJS, rows)
    const buffer = await book.xlsx.writeBuffer()
    const url = URL.createObjectURL(new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }))
    const link = document.createElement('a')
    link.href = url
    link.download = `employee-database-${new Date().toISOString().slice(0, 10)}.xlsx`
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch (err) {
    const el = $('searchHint')
    el.textContent = `Could not export: ${err.message}`
  } finally {
    btn.disabled = false
    btn.textContent = 'Export Database'
  }
})

/* ------------------------------------------------------------------ */
/* Saving                                                              */
/* ------------------------------------------------------------------ */

function readForm() {
  const out = {}
  for (const key of WRITABLE) {
    const el = $(`f_${key}`)
    if (!el) continue
    if (el.type === 'checkbox') { out[key] = el.checked; continue }
    // A date box carries the day it means separately from the text that
    // shows it; text that is not a date carries nothing, which validate
    // reports against the box rather than saving a blank over it.
    if (el.dataset.kind === 'date') {
      const typed = String(el.value ?? '').trim()
      out[key] = typed === '' ? null : (el.dataset.iso || BAD_DATE)
      continue
    }
    let raw = String(el.value ?? '').trim()
    if (el.dataset.kind === 'money') raw = onlyDigits(raw.split('.')[0], 9)
    // One space between names, whatever was pasted in -- a no-break space
    // between two names is invisible and makes the name fail every test
    // that counts words.
    if (key === 'name' || key === 'arabic_name') raw = raw.replace(/\s+/g, ' ')
    out[key] = raw === '' ? null : raw
  }
  // Numbers and foreign keys must not cross as strings.
  for (const key of ['code', 'site_id', 'department_id', 'status_id', 'bus_route_id',
                     'qualification_degree_id', 'si_basic_wage', 'si_gross_wage',
                     'annual_leave_balance', 'unplanned_leave_balance']) {
    if (out[key] != null) out[key] = Number(out[key])
  }
  return out
}

const BAD_DATE = 'not-a-date'

/**
 * Is this value new, or the one that was loaded?
 *
 * The rules below are tightenings: six digits from 2, three names, the
 * wage caps. Applying them to every save would make the records that
 * predate them unsavable -- somebody correcting a phone number would be
 * told to renumber the employee first -- so a value that nobody touched
 * is left as it was found, and anything typed must meet the rule.
 */
function touched(key, value) {
  if (!current?.id) return true
  const was = current[key]
  if (was == null && value == null) return false
  if (was == null || value == null) return true
  if (typeof value === 'number') return Number(was) !== value
  return String(was) !== String(value)
}

/** Mirrors the database's rules so the page can name the field at fault. */
function validate(v) {
  const problems = []
  const blank = (x) => x == null || x === ''

  /* Everything but the handful of optional fields has to be filled in.
     On a new employee that means filled in now. On an existing one it
     means a field that already has a value cannot be emptied -- the
     rule arrived after these records did, and refusing to save somebody
     because a field nobody ever filled is still blank would make the
     page useless for the records it is meant to complete. */
  for (const field of GROUPS.flatMap((g) => g.fields)) {
    if (!isRequired(field.key) || !blank(v[field.key])) continue
    if (!current?.id) {
      problems.push(`${field.label} is required.`)
    } else if (!blank(current[field.key])) {
      problems.push(`${field.label} cannot be emptied.`)
    }
  }

  if (v.code == null || !Number.isInteger(v.code)) {
    if (v.code != null) problems.push('Code must be a whole number.')
  } else if (touched('code', v.code) && (v.code < 200000 || v.code > 299999)) {
    problems.push('Code must be exactly 6 numbers starting with 2 (200000 to 299999).')
  }

  // Missing is already reported by the loop above; this is about shape.
  if (v.name && touched('name', v.name)) {
    if (!/^[A-Za-z][A-Za-z'.-]*( [A-Za-z'.-]+)*$/.test(v.name)) {
      problems.push('Name (English) must be English letters only.')
    } else if (v.name.split(' ').length < 3) {
      problems.push('Name (English) must be three names, as written in the ID.')
    }
  }

  if (v.arabic_name && touched('arabic_name', v.arabic_name) &&
      !/^[ء-ْ]+( [ء-ْ]+)*$/.test(v.arabic_name)) {
    problems.push('Arabic name must be Arabic letters only.')
  }

  if (v.national_id && !/^[23]\d{13}$/.test(v.national_id)) {
    problems.push('ID No. must be 14 numbers, starting with 2 or 3.')
  }

  for (const [key, label] of [['company_mobile', 'Company mobile'],
                              ['personal_mobile', 'Personal mobile'],
                              ['secondary_mobile', 'Secondary mobile']]) {
    if (v[key] && !validMobile(v[key])) {
      problems.push(`${label} must be 11 digits starting with 0, as 000-0000-0000.`)
    }
  }

  for (const [key, [low, high]] of Object.entries(WAGE_LIMITS)) {
    const label = key === 'si_basic_wage' ? 'S.I. basic wage' : 'S.I. gross wage'
    if (v[key] == null || !touched(key, v[key])) continue
    if (v[key] < low || v[key] > high) {
      problems.push(`${label} must be between ${low.toLocaleString('en-US')} and ${high.toLocaleString('en-US')}.`)
    }
  }

  for (const field of GROUPS.flatMap((g) => g.fields)) {
    if (field.type === 'date' && v[field.key] === BAD_DATE) {
      problems.push(`${field.label} is not a real date. Write it as dd-mmm-yyyy, for example 15-Jan-2026.`)
    }
  }

  return problems
}

$('saveBtn').addEventListener('click', async () => {
  $('formError').hidden = true
  $('formNotice').hidden = true

  const values = readForm()
  const problems = validate(values)
  if (problems.length) {
    const el = $('formError')
    el.textContent = problems.join(' ')
    el.hidden = false
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    return
  }

  const btn = $('saveBtn')
  btn.disabled = true
  btn.textContent = 'Saving…'
  try {
    // The foreign key would refuse an invented code anyway, but it would
    // do so after the save, naming a constraint. Checking first means the
    // message arrives before the work is lost and says what is wrong.
    if (values.si_code) {
      const { data: known, error: lookupError } = await supabase
        .from('si_codes').select('code').eq('code', values.si_code).maybeSingle()
      if (lookupError) throw lookupError
      if (!known) {
        throw new Error(
          `S.I. code ${values.si_code} is not in the official list. Pick one from the suggestions — typing the title searches it.`,
        )
      }
    }

    /* The session is the thing most likely to have gone stale by now.
       A new employee is thirty-odd mandatory fields, and the access
       token behind every request has a life of its own. If it lapsed
       while the form was being filled, PostgREST runs the insert as
       anon -- a role this database grants nothing -- and Postgres
       answers "permission denied for table employees": a message about
       privileges for what is really an expired sign-in, shown to
       somebody who has every right to be here.

       getSession renews the token when it can, so asking now either
       fixes it quietly or proves there is nobody signed in. Either way
       it happens before the write, with everything typed still on
       screen. */
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      throw new Error(
        'Your sign-in expired while this form was open, so the database refused the save. ' +
        'Nothing you have typed is lost — open iEnergy Home in another tab, sign in, ' +
        'then come back and press Save again.',
      )
    }

    let saved
    if (current?.id) {
      const { data, error } = await supabase
        .from('employees').update(values).eq('id', current.id).select('id').single()
      if (error) throw error
      saved = data
    } else {
      // Role is left at its default of no_access on purpose: creating a
      // personnel record is not the same as granting somebody access, and
      // the database refuses an elevated role from anyone but a super
      // admin in any case.
      const { data, error } = await supabase
        .from('employees').insert(values).select('id').single()
      if (error) throw error
      saved = data
    }
    const notice = $('formNotice')
    notice.textContent = current?.id ? 'Saved.' : 'Employee created.'
    notice.hidden = false
    await loadTotals()
    await openEmployee(saved.id)
  } catch (err) {
    const el = $('formError')
    el.textContent = friendlyError(err)
    el.hidden = false
  } finally {
    btn.disabled = false
    btn.textContent = 'Save'
  }
})

/** Constraint names mean nothing to the person reading them. */
function friendlyError(err) {
  const message = err?.message ?? String(err)
  const named = {
    employees_code_key: 'That employee code is already used by someone else.',
    employees_national_id_uq: 'That ID number is already on another employee.',
    employees_code_min_six_digits: `Code must be at least 6 digits (${MIN_CODE} or above).`,
    employees_code_band: 'Code must be exactly 6 numbers starting with 2 (200000 to 299999).',
    employees_national_id_format: 'ID No. must be 14 numbers, starting with 2 or 3.',
    employees_arabic_name_script: 'Arabic name must not contain Latin letters or digits.',
    employees_weekend_valid: 'Weekend must be Friday + Saturday, or Friday only.',
    employees_company_mobile_format: 'Company mobile must look like 000-0000-0000.',
    employees_personal_mobile_format: 'Personal mobile must look like 000-0000-0000.',
    employees_secondary_mobile_format: 'Secondary mobile must look like 000-0000-0000.',
    employees_si_basic_wage_range: 'S.I. basic wage must be between 5,500 and 99,999.',
    employees_si_gross_wage_range: 'S.I. gross wage must be between 7,100 and 99,999.',
    employees_si_code_fkey: 'That S.I. code is not in the official list.',
    employees_military_service_valid: 'Military service must be Served, Postponed or Exempted.',
    employees_marital_status_valid: 'Marital status must be Single, Married or Divorced.',
    employees_religion_valid: 'Religion must be Muslim or Christian.',
    employees_name_unique_idx: 'Another employee already has that name.',
    employees_email_lower_idx: 'Another employee already has that email.',
    employees_si_no_unique_idx: 'Another employee already has that S.I. number.',
  }
  for (const [key, text] of Object.entries(named)) if (message.includes(key)) return text
  if (message.includes('row-level security')) {
    return 'Your account is not allowed to change employee records.'
  }
  /* Postgres says "permission denied for table employees" when the role
     making the request holds no privilege on it. A signed-in admin
     always does, so in practice this is a request that arrived without
     a usable token and ran as anon. Saying so beats repeating a
     sentence about table privileges at somebody who has them. */
  if (message.includes('permission denied')) {
    return 'The database refused that. Your sign-in has most likely expired — open iEnergy Home ' +
      'in another tab, sign in, then press Save again. Nothing you have typed is lost.'
  }
  return message
}

/* ------------------------------------------------------------------ */

start().catch((err) => showAuthError(err.message))
