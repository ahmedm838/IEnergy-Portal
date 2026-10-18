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
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm'

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
  ['doc_military_certificate', 'Military certificate'],
  ['doc_birth_certificate', 'Birth certificate'],
  ['doc_fingerprint_record', 'Finger print record'],
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
      { key: 'code', label: 'Code', type: 'number', required: true, hint: 'At least 6 digits.' },
      { key: 'name', label: 'Name (English)', type: 'text', required: true },
      { key: 'arabic_name', label: 'Arabic name as in ID', type: 'text', dir: 'rtl', hint: 'Arabic letters only.' },
      { key: 'national_id', label: 'ID No.', type: 'text', derives: true },
      { key: 'id_expiry_date', label: 'ID expiry date', type: 'date' },
      { key: 'si_no', label: 'S.I. No.', type: 'text' },
    ],
  },
  {
    title: 'Employment',
    fields: [
      { key: 'title', label: 'Job title', type: 'text' },
      { key: 'site_id', label: 'Site', type: 'select', source: 'sites' },
      { key: 'department_id', label: 'Department', type: 'select', source: 'departments' },
      { key: 'status_id', label: 'Status', type: 'select', source: 'statuses' },
      { key: 'hired_on', label: 'Hiring date', type: 'date' },
      { key: 'weekend', label: 'Weekend', type: 'select', options: [['fri_sat', 'Friday + Saturday'], ['fri', 'Friday only']] },
      { key: 'bus_route_id', label: 'Bus route', type: 'select', source: 'busRoutes' },
      { key: 'is_active', label: 'Active', type: 'checkbox' },
    ],
  },
  {
    title: 'Social insurance',
    fields: [
      { key: 'si_date', label: 'S.I. date', type: 'date' },
      { key: 'si_code', label: 'S.I. code', type: 'sicode' },
      { key: 'si_basic_wage', label: 'S.I. basic wage', type: 'number', hint: '5,500 to 99,999.' },
      { key: 'si_gross_wage', label: 'S.I. gross wage', type: 'number', hint: '7,100 to 99,999.' },
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
    fields: [
      { key: 'notice_date', label: 'Notice date', type: 'date' },
      { key: 'resignation_date', label: 'Resignation date', type: 'date' },
      { key: 'resignation_reason', label: 'Resignation reason', type: 'text' },
    ],
  },
]

/** Columns this page writes. Everything else on the row it leaves alone. */
const WRITABLE = [
  ...GROUPS.flatMap((g) => g.fields.map((f) => f.key)),
  ...DOCUMENTS.map(([key]) => key),
  ...PAYROLL.map(([key]) => key),
]

/* ------------------------------------------------------------------ */
/* Sign in                                                             */
/* ------------------------------------------------------------------ */

function showAuthError(message) {
  const el = $('authError')
  el.textContent = message || ''
  el.hidden = !message
  // Anything that fails after the gate is hidden would otherwise write its
  // message into an element nobody can see, which is exactly what "I
  // signed in and nothing happened" looks like from the outside.
  if (message) {
    $('gate').hidden = false
    $('app').hidden = true
  }
}

async function resolveEmail(identifier) {
  const value = String(identifier ?? '').trim()
  if (!value || value.includes('@')) return value
  // Usernames are the part before @ on the company domain. If that domain
  // cannot be read before signing in, say so rather than guessing one and
  // failing with "invalid credentials", which blames the password.
  const { data, error } = await supabase.rpc('default_email_domain')
  if (error || !data) throw new Error('Enter your full email address.')
  return `${value}@${data}`
}

$('signInForm').addEventListener('submit', async (e) => {
  e.preventDefault()
  showAuthError('')
  const btn = $('signInBtn')
  btn.disabled = true
  btn.textContent = 'Signing in…'
  try {
    const email = await resolveEmail($('emailInput').value)
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password: $('passwordInput').value,
    })
    if (error) throw error
    $('passwordInput').value = ''
    await start()
  } catch (err) {
    showAuthError(
      err.message === 'Invalid login credentials'
        ? 'That email and password do not match an account.'
        : err.message,
    )
  } finally {
    btn.disabled = false
    btn.textContent = 'Sign in'
  }
})

$('signOutBtn').addEventListener('click', async () => {
  // Same reasoning as the tracker: ask the server to revoke, but never
  // depend on it. What keeps someone signed in is the stored token.
  try {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  } catch {
    await supabase.auth.signOut({ scope: 'local' }).catch(() => {})
  }
  location.reload()
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

async function loadTotals() {
  const count = async (apply) => {
    const { count: n, error } = await apply(
      supabase.from('employee_profiles').select('id', { count: 'exact', head: true }),
    )
    return error ? null : n
  }
  const [listed, onBoard, uninsured, complete] = await Promise.all([
    count((q) => q),
    count((q) => q.eq('is_active', true)),
    // On board with no insurance date on file. "On board" is the same
    // test as the tile beside it, the Active flag, so the two numbers are
    // always read against each other rather than against two different
    // populations.
    count((q) => q.eq('is_active', true).is('si_date', null)),
    count((q) => q.eq('file_complete', true)),
  ])
  $('totalListed').textContent = listed ?? '—'
  $('totalOnBoard').textContent = onBoard ?? '—'
  $('totalUninsured').textContent = uninsured ?? '—'
  $('totalComplete').textContent = complete ?? '—'
}

async function start() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    $('gate').hidden = false
    $('app').hidden = true
    return
  }

  const { data, error } = await supabase
    .from('employees')
    .select('id, code, name, role')
    .eq('auth_user_id', user.id)
    .maybeSingle()

  if (error || !data) {
    showAuthError(
      'That account signed in but is not linked to an employee record, so it cannot read the database.',
    )
    await supabase.auth.signOut({ scope: 'local' }).catch(() => {})
    $('gate').hidden = false
    $('app').hidden = true
    return
  }

  me = data
  const canEdit = me.role === 'admin' || me.role === 'super_admin'
  $('whoami').textContent = canEdit
    ? `Signed in as ${me.name} (${me.role === 'super_admin' ? 'super admin' : 'administrator'}).`
    : `Signed in as ${me.name}. Your role is read-only here — the database refuses changes.`
  $('newBtn').hidden = !canEdit
  $('saveBtn').hidden = !canEdit

  $('gate').hidden = true
  $('app').hidden = false
  $('year').textContent = new Date().getFullYear()

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

$('clearBtn').addEventListener('click', () => {
  clearTimeout(searchTimer)
  searchSeq++
  $('searchInput').value = ''
  $('matches').hidden = true
  $('searchHint').textContent = 'Type to search.'
  $('searchInput').focus()
})

/* ------------------------------------------------------------------ */
/* The form                                                            */
/* ------------------------------------------------------------------ */

function fieldControl(field, value) {
  const wrap = document.createElement('label')
  wrap.className = 'db-field'
  const label = document.createElement('span')
  label.className = 'db-label'
  label.textContent = field.label + (field.required ? ' *' : '')
  wrap.appendChild(label)

  let input
  if (field.type === 'select') {
    input = document.createElement('select')
    input.className = 'input'
    const options = field.options ?? lookups[field.source] ?? []
    const blank = document.createElement('option')
    blank.value = ''
    blank.textContent = '—'
    input.appendChild(blank)
    for (const [val, text] of options) {
      const opt = document.createElement('option')
      opt.value = String(val)
      opt.textContent = text
      input.appendChild(opt)
    }
    input.value = value == null ? '' : String(value)
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
  } else {
    input = document.createElement('input')
    input.className = 'input'
    input.type = field.type === 'date' ? 'date' : field.type === 'number' ? 'number' : 'text'
    if (field.dir) input.dir = field.dir
    input.value = value ?? ''
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

  // The fields the calculated panel is built from, kept live as they are
  // typed rather than only refreshed on save.
  if (['national_id', 'hired_on', 'id_expiry_date'].includes(field.key)) {
    input.addEventListener('input', renderDerived)
  }
  if (field.key === 'si_code') {
    input.addEventListener('change', () => resolveSiTitle(input.value))
    input.addEventListener('input', () => { derivedSiTitle = null; renderDerived() })
  }

  wrap.appendChild(input)

  if (field.derives) {
    const derived = document.createElement('span')
    derived.className = 'db-derived'
    derived.id = 'derivedFromId'
    wrap.appendChild(derived)
    input.addEventListener('input', showDerived)
  } else if (field.hint) {
    const hint = document.createElement('span')
    hint.className = 'db-hint'
    hint.textContent = field.hint
    wrap.appendChild(hint)
  }
  return wrap
}

/* ------------------------------------------------------------------ */
/* Values the system works out for itself                              */
/* ------------------------------------------------------------------ */

const pad2 = (n) => String(n).padStart(2, '0')
const asDMY = (d) => `${pad2(d.getUTCDate())}-${pad2(d.getUTCMonth() + 1)}-${d.getUTCFullYear()}`

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
  const val = (key) => $(`f_${key}`)?.value?.trim() || ''
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
    const contract = new Date(`${hired}T00:00:00Z`)
    if (!Number.isNaN(contract.getTime())) {
      contract.setUTCFullYear(contract.getUTCFullYear() + 1)
      const left = daysUntil(contract.toISOString().slice(0, 10))
      items.push([
        'Contract expiry',
        `${asDMY(contract)}${left != null && left <= 30 ? ` · ${left < 0 ? 'passed' : `${left}d left`}` : ''}`,
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
      left == null ? expiry : left < 0 ? `expired ${Math.abs(left)}d ago` : `${left}d left`,
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

/** Birth date, gender and governorate, shown as the ID is typed. */
function showDerived() {
  const el = $('derivedFromId')
  if (!el) return
  const id = String($('f_national_id')?.value ?? '').trim()
  if (!/^[23]\d{13}$/.test(id)) {
    el.textContent = id ? '14 digits starting with 2 or 3.' : 'Birth date, gender and governorate are read from this.'
    el.classList.toggle('bad', !!id)
    return
  }
  el.classList.remove('bad')
  const year = (id[0] === '2' ? 1900 : 2000) + Number(id.slice(1, 3))
  const month = Number(id.slice(3, 5))
  const day = Number(id.slice(5, 7))
  const gov = lookups.governorates?.[Number(id.slice(7, 9))]
  const gender = Number(id[12]) % 2 === 1 ? 'Male' : 'Female'
  const date = new Date(Date.UTC(year, month - 1, day))
  const real = date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  const shown = real
    ? `${String(day).padStart(2, '0')}-${String(month).padStart(2, '0')}-${year}`
    : 'birth date not a real day'
  el.textContent = `${shown} · ${gender}${gov ? ` · ${gov}` : ''}`
}

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
    text.textContent = label
    wrap.appendChild(box)
    wrap.appendChild(text)
    docGrid.appendChild(wrap)
  }
  docs.appendChild(docGrid)
  form.appendChild(docs)

  if (!(me?.role === 'admin' || me?.role === 'super_admin')) {
    form.querySelectorAll('input, select').forEach((el) => { el.disabled = true })
  }

  showDerived()
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
}

$('newBtn').addEventListener('click', () => {
  $('formNotice').hidden = true
  $('formError').hidden = true
  derivedSiTitle = null
  renderForm({
    weekend: 'fri_sat',
    is_active: true,
    // Every payroll component starts on; HR turns off the ones that do
    // not apply. Same as the column defaults in the database.
    ...Object.fromEntries(PAYROLL.map(([key]) => [key, true])),
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

/** One row per employee, stored and calculated columns side by side. */
function exportRow(e) {
  const id = readNationalId(e.national_id)
  const contract = e.hired_on ? new Date(`${e.hired_on}T00:00:00Z`) : null
  if (contract && !Number.isNaN(contract.getTime())) contract.setUTCFullYear(contract.getUTCFullYear() + 1)
  const idLeft = e.id_expiry_date ? daysUntil(e.id_expiry_date) : null
  const missing = e.missing_documents ?? []

  return {
    'Code': e.code,
    'Name': e.name,
    'Arabic name': e.arabic_name ?? '',
    'ID No.': e.national_id ?? '',
    'Birth date': id?.birthDate ? asDMY(id.birthDate) : '',
    'Gender': id?.gender ?? '',
    'Governorate': e.governorate ?? '',
    'ID expiry': e.id_expiry_date ?? '',
    'ID expiry status': idLeft == null ? '' : idLeft < 0 ? `Expired ${Math.abs(idLeft)}d ago` : `${idLeft}d left`,
    'S.I. No.': e.si_no ?? '',
    'Job title': e.title ?? '',
    'Site': nameFrom(lookups.sites, e.site_id),
    'Department': nameFrom(lookups.departments, e.department_id),
    'Status': nameFrom(lookups.statuses, e.status_id),
    'Active': e.is_active ? 'Yes' : 'No',
    'Hiring date': e.hired_on ?? '',
    'Working period': e.hired_on ? spanFrom(e.hired_on) ?? '' : '',
    'Contract expiry': contract && !Number.isNaN(contract.getTime()) ? asDMY(contract) : '',
    'Weekend': e.weekend === 'fri' ? 'Friday only' : 'Friday + Saturday',
    'Bus route': e.bus_route ?? '',
    'S.I. date': e.si_date ?? '',
    'S.I. code': e.si_code ?? '',
    'S.I. title': e.si_title ?? '',
    'S.I. basic wage': e.si_basic_wage ?? '',
    'S.I. gross wage': e.si_gross_wage ?? '',
    'Email': e.email ?? '',
    'Company mobile': e.company_mobile ?? '',
    'Personal mobile': e.personal_mobile ?? '',
    'Secondary mobile': e.secondary_mobile ?? '',
    'Secondary number belongs to': e.secondary_mobile_name ?? '',
    'Office number': e.office_number ?? '',
    'Military service': e.military_service ?? '',
    'Marital status': e.marital_status ?? '',
    'Religion': e.religion ?? '',
    'Qualification degree': e.qualification_degree ?? '',
    'Education field': e.education_field ?? '',
    ...Object.fromEntries(DOCUMENTS.map(([key, label]) => [label, e[key] ? 'Yes' : 'No'])),
    'File status': e.file_complete ? 'Complete' : `Missing (${missing.length})`,
    'Missing documents': missing.join(', '),
    'Notice date': e.notice_date ?? '',
    'Resignation date': e.resignation_date ?? '',
    'Resignation reason': e.resignation_reason ?? '',
  }
}

$('exportBtn').addEventListener('click', async () => {
  const btn = $('exportBtn')
  btn.disabled = true
  btn.textContent = 'Preparing…'
  try {
    // Loaded on demand: most visits never export, and the library is far
    // bigger than this page.
    const XLSX = await import('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm')
    const rows = (await fetchAllProfiles()).map(exportRow)
    if (!rows.length) throw new Error('There is nothing to export.')

    const sheet = XLSX.utils.json_to_sheet(rows)
    // Width by the longest value in each column, so nothing reads as ####.
    sheet['!cols'] = Object.keys(rows[0]).map((key) => ({
      wch: Math.min(42, Math.max(key.length + 2, ...rows.map((r) => String(r[key] ?? '').length + 2))),
    }))
    // No frozen panes anywhere, as agreed for the other exports.
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, sheet, 'Employees')
    XLSX.writeFile(book, `employee-database-${new Date().toISOString().slice(0, 10)}.xlsx`)
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
    const raw = String(el.value ?? '').trim()
    out[key] = raw === '' ? null : raw
  }
  // Numbers and foreign keys must not cross as strings.
  for (const key of ['code', 'site_id', 'department_id', 'status_id', 'bus_route_id',
                     'qualification_degree_id', 'si_basic_wage', 'si_gross_wage']) {
    if (out[key] != null) out[key] = Number(out[key])
  }
  return out
}

/** Mirrors the database's rules so the page can name the field at fault. */
function validate(v) {
  const problems = []
  if (!v.code || !Number.isInteger(v.code) || v.code < MIN_CODE) {
    problems.push(`Code must be a whole number of at least 6 digits (${MIN_CODE} or above).`)
  }
  if (!v.name) problems.push('Name is required.')
  if (v.arabic_name && /[A-Za-z0-9]/.test(v.arabic_name)) {
    problems.push('Arabic name must not contain Latin letters or digits.')
  }
  if (v.national_id && !/^[23]\d{13}$/.test(v.national_id)) {
    problems.push('ID No. must be 14 digits starting with 2 or 3.')
  }
  for (const [key, label] of [['company_mobile', 'Company mobile'],
                              ['personal_mobile', 'Personal mobile'],
                              ['secondary_mobile', 'Secondary mobile']]) {
    if (v[key] && !validMobile(v[key])) {
      problems.push(`${label} must be 11 digits starting with 0, as 000-0000-0000.`)
    }
  }
  if (v.si_basic_wage != null && (v.si_basic_wage < 5500 || v.si_basic_wage > 99999)) {
    problems.push('S.I. basic wage must be between 5,500 and 99,999.')
  }
  if (v.si_gross_wage != null && (v.si_gross_wage < 7100 || v.si_gross_wage > 99999)) {
    problems.push('S.I. gross wage must be between 7,100 and 99,999.')
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
    employees_national_id_format: 'ID No. must be 14 digits starting with 2 or 3.',
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
  return message
}

/* ------------------------------------------------------------------ */

start().catch((err) => showAuthError(err.message))
