/* Company structure
   - Every active employee, by sector, then department, then level from
     the top down, as set in the tracker's Settings (sectors, departments,
     levels) and the Employee Database (each person's department and
     level).
   - Open to whoever Settings > Page access lets in (users and admins to
     start with). The names come from employee_directory(), which gives
     everyone's name, title, department and level and nothing more, so
     the page shows the whole company without opening anybody's record.
*/

const $ = (id) => document.getElementById(id)

const state = { sectors: [], departments: [], levels: [], people: [], me: null }

/* Arabic letters folded so a search finds أحمد as احمد, and so on. */
const fold = (s) => String(s ?? '').toLowerCase()
  .replace(/[ً-ْـ]/g, '')
  .replace(/[أإآٱ]/g, 'ا')
  .replace(/ى/g, 'ي')
  .replace(/ة/g, 'ه')

async function load() {
  const supabase = await IEnergyAuth.getClient()
  const [sectors, departments, levels, people] = await Promise.all([
    supabase.from('sectors').select('id, name, name_ar, sort_order').order('sort_order').order('id'),
    supabase.from('departments').select('id, name, name_ar, sector_id, sort_order').order('sort_order').order('id'),
    supabase.from('employee_levels').select('id, code, name, rank').order('rank', { ascending: false }),
    supabase.rpc('employee_directory'),
  ])
  for (const r of [sectors, departments, levels, people]) if (r.error) throw r.error
  state.sectors = sectors.data || []
  state.departments = departments.data || []
  state.levels = levels.data || []
  state.people = people.data || []
}

const levelOf = (id) => state.levels.find((l) => l.id === id) || null
const rankOf = (p) => levelOf(p.level_id)?.rank ?? -1

function el(tag, cls, text) {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text != null) e.textContent = text
  return e
}

function personRow(p) {
  const row = el('div', 'cs-person')
  if (state.me && p.id === state.me) row.classList.add('is-me')
  const lvl = levelOf(p.level_id)
  const badge = el('span', `cs-level cs-l${lvl?.rank ?? 0}`, lvl?.code || '—')
  badge.title = lvl?.name || 'No level'
  const names = el('div', 'cs-names')
  names.append(el('span', 'cs-name', p.name || ''))
  if (p.arabic_name) {
    const ar = el('span', 'cs-name-ar', p.arabic_name)
    ar.dir = 'rtl'
    names.append(ar)
  }
  const title = el('div', 'cs-title', p.title || p.si_title || '')
  row.append(badge, names, title)
  return row
}

function draw() {
  const q = fold($('search').value.trim())
  const tree = $('tree')
  tree.innerHTML = ''
  const matches = (p, dept, sector) => !q || [p.name, p.arabic_name, p.title, p.si_title, String(p.code),
    dept?.name, dept?.name_ar, sector?.name, sector?.name_ar].some((v) => fold(v).includes(q))

  let shown = 0
  const sectorBlocks = [...state.sectors, { id: null, name: 'No sector', name_ar: '' }]
  for (const sector of sectorBlocks) {
    const depts = state.departments.filter((d) => (d.sector_id ?? null) === sector.id)
    if (sector.id === null) depts.push({ id: null, name: 'No department', name_ar: '' })
    const block = el('section', 'cs-sector')
    const head = el('header', 'cs-sector-head')
    head.append(el('h3', '', sector.name))
    if (sector.name_ar) { const ar = el('span', 'cs-ar', sector.name_ar); ar.dir = 'rtl'; head.append(ar) }
    const count = el('span', 'cs-count')
    head.append(count)
    block.append(head)
    let inSector = 0
    const grid = el('div', 'cs-depts')
    for (const dept of depts) {
      const people = state.people
        .filter((p) => (p.department_id ?? null) === dept.id)
        .filter((p) => matches(p, dept, sector))
        .sort((a, b) => rankOf(b) - rankOf(a) || String(a.name).localeCompare(String(b.name)))
      if (!people.length) continue
      inSector += people.length
      const card = el('div', 'cs-dept')
      const dh = el('div', 'cs-dept-head')
      dh.append(el('h4', '', dept.name))
      if (dept.name_ar) { const ar = el('span', 'cs-ar', dept.name_ar); ar.dir = 'rtl'; dh.append(ar) }
      dh.append(el('span', 'cs-count', String(people.length)))
      card.append(dh)
      for (const p of people) card.append(personRow(p))
      grid.append(card)
    }
    if (!inSector) continue
    count.textContent = `${inSector} ${inSector === 1 ? 'person' : 'people'}`
    block.append(grid)
    tree.append(block)
    shown += inSector
  }

  const total = state.people.length
  $('summary').textContent = q
    ? `${shown} of ${total} people match.`
    : `${total} people in ${state.departments.length} departments across ${state.sectors.length} sectors.`
  $('status').hidden = !!shown
  $('status').textContent = q ? 'Nobody matches that search.' : 'No employees to show yet.'
}

function drawLevels() {
  const box = $('levels')
  box.innerHTML = ''
  for (const l of state.levels) {
    const item = el('span', 'cs-legend')
    item.append(el('span', `cs-level cs-l${l.rank}`, l.code), el('span', '', l.name))
    box.append(item)
  }
}

function fillPageBar() {
  const me = IEnergyAuth.getProfile && IEnergyAuth.getProfile()
  if (!me) return
  state.me = me.id
  const who = $('whoami')
  who.textContent = ''
  who.append(el('span', 'who-name', me.name || ''))
  const LABEL = { super_admin: 'Super admin', admin: 'Admin', user: 'User' }
  const badge = $('roleBadge')
  badge.textContent = LABEL[me.trackerRole] || me.trackerRole || ''
  badge.className = 'role-badge' + (me.trackerRole === 'super_admin' ? ' is-super' : me.trackerRole === 'admin' ? ' is-admin' : '')
  badge.hidden = false
  const slot = $('themeSlot')
  const toggle = document.querySelector('.theme-toggle')
  if (slot && toggle) slot.appendChild(toggle)
}

async function onAuthed() {
  fillPageBar()
  try {
    await load()
    drawLevels()
    draw()
  } catch (err) {
    $('summary').textContent = ''
    $('status').hidden = false
    $('status').textContent = `Could not load the company structure: ${err.message || err}`
  }
  $('search').addEventListener('input', draw)
}

$('year').textContent = String(new Date().getFullYear())
const out = $('logoutBtn')
out.addEventListener('click', () => {
  out.disabled = true
  out.textContent = 'Signing out…'
  IEnergyAuth.signOutAndLeave('../index.html')
})
IEnergyAuth.ensureAuth({ allowedRoles: ['admin', 'user'], page: 'company-structure', homeHref: '../index.html', onAuthed })
