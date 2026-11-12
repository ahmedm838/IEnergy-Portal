/* HR Documents
   - Admins and super admins only: ensureAuth turns everyone else away,
     and row level security on employee_profiles says the same thing from
     the database's side.
   - Each document is a Word template whose blanks are written as (1),
     (2), ... in the text. The template is rendered in the page as it
     looks in Word; every blank becomes a locked field, filled from the
     employee database, and the rest of the text can be edited in place.
   - Save PDF downloads the page as a PDF; Print sends that same PDF
     to the printer.
*/
import { renderAsync, JSZip, toCanvas, jsPDF } from '../vendor/hr-docs-libs-1.js'

const $ = (id) => document.getElementById(id)

/* ------------------------------------------------------------------ */
/* Arabic formatting                                                   */
/* ------------------------------------------------------------------ */

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩'
const AR_DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']

export const toArabicDigits = (s) => String(s ?? '').replace(/[0-9]/g, (d) => AR_DIGITS[d])

/* Dates are plain calendar days. They are built and read in UTC so a
   time zone can never move one across midnight. */
export function parseISO(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''))
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null
}
const todayUTC = () => {
  const n = new Date()
  return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()))
}
export const addDays = (d, n) => new Date(d.getTime() + n * 86400000)

/* One calendar year on, the day before: a year that starts on 11 Nov
   2026 ends on 10 Nov 2027. Worked out as the database works out
   contract_expiry -- the day before, then a year on, a 29 Feb that
   does not exist becoming 28 Feb -- so the two never disagree. */
export function oneYearFrom(start) {
  const less = addDays(start, -1)
  const y = less.getUTCFullYear() + 1
  const m = less.getUTCMonth()
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  return new Date(Date.UTC(y, m, Math.min(less.getUTCDate(), last)))
}

export const arDate = (d) => d
  ? toArabicDigits(`${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`)
  : ''
export const arDay = (d) => (d ? AR_DAYS[d.getUTCDay()] : '')

/* For searching Arabic names: the spellings people type interchangeably
   are folded together, and diacritics are dropped. */
export const foldArabic = (s) => String(s ?? '')
  .replace(/[ً-ْـ]/g, '')
  .replace(/[أإآٱ]/g, 'ا')
  .replace(/ى/g, 'ي')
  .replace(/ة/g, 'ه')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase()

/* ------------------------------------------------------------------ */
/* The documents                                                        */
/* ------------------------------------------------------------------ */

/* The contract renewal's blanks, by the number written in the template.
   Only the employee is chosen; everything else follows from the
   employee and today's date. */
export function renewalValues(emp, today = todayUTC()) {
  const lastExpiry = emp ? parseISO(emp.contract_expiry) : null
  const start = lastExpiry ? addDays(lastExpiry, 1) : null
  const end = start ? oneYearFrom(start) : null
  const name = emp?.arabic_name || ''
  return {
    1: arDay(today),
    2: arDate(today),
    3: name,
    4: toArabicDigits(emp?.national_id || ''),
    5: arDate(emp ? parseISO(emp.hired_on) : null),
    6: arDate(start),
    7: arDate(end),
    8: name,
    9: arDate(today),
    10: arDate(today),
  }
}

const RENEWAL_LABELS = {
  1: 'اليوم',
  2: 'تاريخ اليوم',
  4: 'الرقم القومي',
  5: 'تاريخ التعيين',
  6: 'بداية التجديد',
  7: 'نهاية التجديد',
}

const DOCUMENTS = [
  {
    id: 'hiring',
    title: 'عقد التعيين',
    subtitle: 'Hiring contract',
    template: null, // template not supplied yet
  },
  {
    id: 'renewal',
    title: 'اتفاق تجديد عقد عمل محدد المدة',
    subtitle: 'Contract renewal',
    template: 'templates/contract-renewal.docx?v=1',
    fileName: 'تجديد عقد',
    values: renewalValues,
    labels: RENEWAL_LABELS,
    // What has to be on the record before the document can be issued.
    required: [
      ['arabic_name', 'الاسم بالعربية'],
      ['national_id', 'الرقم القومي'],
      ['hired_on', 'تاريخ التعيين'],
      ['contract_expiry', 'تاريخ انتهاء العقد'],
    ],
  },
]

/* ------------------------------------------------------------------ */
/* Template preparation                                                 */
/* ------------------------------------------------------------------ */

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const XML_NS = 'http://www.w3.org/XML/1998/namespace'
/* A blank as typed in the template: a number in brackets. Word often
   stores "(", "3" and ")" as three separate runs, and one of the
   template's brackets is typed backwards, so either bracket is
   accepted on either side. */
const BLANK = /[()]\s*(\d{1,2})\s*[()]/g
const MARK = (n) => `⟦${n}⟧` // ⟦n⟧
const MARK_RE = /⟦(\d{1,2})⟧/g

/* Rewrite every blank in document.xml as a single ⟦n⟧ inside one run,
   keeping that run's formatting, so it can be found again once the
   document is drawn. */
export function markBlanks(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  for (const p of Array.from(doc.getElementsByTagNameNS(W_NS, 'p'))) {
    const nodes = Array.from(p.getElementsByTagNameNS(W_NS, 't'))
    if (!nodes.length) continue
    const text = nodes.map((t) => t.textContent).join('')
    const matches = Array.from(text.matchAll(BLANK))
    // Last first, so earlier offsets stay valid.
    for (const m of matches.reverse()) {
      const from = m.index
      const to = m.index + m[0].length
      let pos = 0
      let first = true
      for (const t of nodes) {
        const s = t.textContent
        const a = pos
        const b = pos + s.length
        pos = b
        if (b <= from || a >= to) continue
        const keepBefore = s.slice(0, Math.max(0, from - a))
        const keepAfter = s.slice(Math.max(0, to - a))
        t.textContent = first ? keepBefore + MARK(m[1]) + keepAfter : keepBefore + keepAfter
        t.setAttributeNS(XML_NS, 'xml:space', 'preserve')
        first = false
      }
    }
  }
  return new XMLSerializer().serializeToString(doc)
}

const templateCache = new Map()
async function loadTemplate(url) {
  if (!templateCache.has(url)) {
    templateCache.set(url, (async () => {
      const res = await fetch(url, { cache: 'no-cache' })
      if (!res.ok) throw new Error(`Template not found (${res.status})`)
      const zip = await JSZip.loadAsync(await res.arrayBuffer())
      const xml = await zip.file('word/document.xml').async('string')
      zip.file('word/document.xml', markBlanks(xml))
      return zip.generateAsync({ type: 'blob' })
    })())
  }
  return templateCache.get(url)
}

/* ------------------------------------------------------------------ */
/* Drawing the document                                                 */
/* ------------------------------------------------------------------ */

function textNodes(root) {
  const out = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) out.push(walker.currentNode)
  return out
}

/* Turn each ⟦n⟧ into a locked field, and write every other number in
   the document in Arabic digits. */
function lockBlanks(root) {
  for (const node of textNodes(root)) {
    const s = node.nodeValue
    MARK_RE.lastIndex = 0
    if (!MARK_RE.test(s)) {
      if (/[0-9]/.test(s)) node.nodeValue = toArabicDigits(s)
      continue
    }
    const frag = document.createDocumentFragment()
    let last = 0
    MARK_RE.lastIndex = 0
    for (const m of s.matchAll(MARK_RE)) {
      if (m.index > last) frag.appendChild(document.createTextNode(toArabicDigits(s.slice(last, m.index))))
      const span = document.createElement('span')
      span.className = 'hr-field is-empty'
      span.dataset.field = m[1]
      span.contentEditable = 'false'
      span.textContent = '……'
      frag.appendChild(span)
      last = m.index + m[0].length
    }
    if (last < s.length) frag.appendChild(document.createTextNode(toArabicDigits(s.slice(last))))
    node.parentNode.replaceChild(frag, node)
  }
}

/* The text around the fields is editable; the fields are not. A
   deletion that would take a field with it is refused. */
function protectFields(root) {
  root.addEventListener('beforeinput', (e) => {
    const ranges = e.getTargetRanges ? e.getTargetRanges() : []
    for (const sr of ranges) {
      const r = document.createRange()
      r.setStart(sr.startContainer, sr.startOffset)
      r.setEnd(sr.endContainer, sr.endOffset)
      for (const f of root.querySelectorAll('.hr-field')) {
        if (r.intersectsNode(f) && !(r.collapsed)) { e.preventDefault(); return }
        if (f.contains(sr.startContainer)) { e.preventDefault(); return }
      }
    }
  })
  // Pasting rich text from Word or a page would bring its styling along.
  root.addEventListener('paste', (e) => {
    e.preventDefault()
    const text = e.clipboardData.getData('text/plain')
    document.execCommand('insertText', false, toArabicDigits(text))
  })
}

async function drawDocument(def) {
  const preview = $('preview')
  const status = $('previewStatus')
  preview.innerHTML = ''
  status.hidden = false
  status.textContent = 'Loading document…'
  const blob = await loadTemplate(def.template)
  await renderAsync(blob, preview, null, {
    className: 'docx',
    inWrapper: true,
    ignoreWidth: false,
    ignoreHeight: false,
    breakPages: true,
    experimental: true,
    renderHeaders: true,
    renderFooters: true,
  })
  lockBlanks(preview)
  for (const page of preview.querySelectorAll('section.docx')) {
    page.contentEditable = 'true'
    page.spellcheck = false
  }
  protectFields(preview)
  status.hidden = true
  fitPreview()
}

function fillFields(values) {
  for (const span of $('preview').querySelectorAll('.hr-field')) {
    const v = values[span.dataset.field]
    span.textContent = v || '……'
    span.classList.toggle('is-empty', !v)
  }
}

/* ------------------------------------------------------------------ */
/* PDF                                                                  */
/* ------------------------------------------------------------------ */

function isBlank(ctx, w, h) {
  if (h < 4) return true
  const data = ctx.getImageData(0, 0, w, h).data
  for (let i = 0; i < data.length; i += 4 * 7) {
    if (data[i] < 200 || data[i + 1] < 200 || data[i + 2] < 200) return false
  }
  return true
}

/* The page is A4 at full size; it is shrunk to fit the column it sits
   in, and drawn at full size again for the PDF. */
function fitPreview() {
  const preview = $('preview')
  const page = preview.querySelector('section.docx')
  const wrap = preview.parentElement
  if (!page || !wrap) return
  preview.style.zoom = ''
  const needed = page.offsetWidth + 40
  const room = wrap.clientWidth
  preview.style.zoom = needed > room ? String(Math.max(0.4, room / needed)) : ''
}
new ResizeObserver(() => fitPreview()).observe(document.documentElement)

async function buildPdf() {
  const preview = $('preview')
  const pages = Array.from(preview.querySelectorAll('section.docx'))
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true })
  const W = 210
  const H = 297
  const zoom = preview.style.zoom
  preview.style.zoom = ''
  preview.classList.add('is-capturing')
  if (document.activeElement && preview.contains(document.activeElement)) document.activeElement.blur()
  try {
    let firstPage = true
    for (const page of pages) {
      /* The page is copied into an SVG image with its styles and drawn
         by the browser itself, so Arabic is shaped and laid out exactly
         as it is on screen. Drawing it text run by text run, as
         html2canvas does, breaks letters apart wherever Word split a
         word across runs. */
      const canvas = await toCanvas(page, {
        pixelRatio: 2,
        backgroundColor: '#ffffff',
        cacheBust: false,
        style: { margin: '0', boxShadow: 'none' },
      })
      const sliceHeight = Math.floor(canvas.width * (H / W))
      /* A page a little taller than A4 -- usually a font that is wider
         than the one Word used -- is shrunk onto one sheet rather than
         spilling a line or two onto a second. */
      if (canvas.height <= sliceHeight * 1.2) {
        const w = W * Math.min(1, sliceHeight / canvas.height)
        if (!firstPage) pdf.addPage()
        firstPage = false
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', (W - w) / 2, 0, w, (canvas.height / canvas.width) * w)
        continue
      }
      // Anything longer is cut into A4 slices; a slice with nothing on
      // it is left out.
      for (let y = 0; y < canvas.height; y += sliceHeight) {
        const h = Math.min(sliceHeight, canvas.height - y)
        const slice = document.createElement('canvas')
        slice.width = canvas.width
        slice.height = sliceHeight
        const ctx = slice.getContext('2d', { willReadFrequently: true })
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, slice.width, slice.height)
        ctx.drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h)
        if (!firstPage && isBlank(ctx, slice.width, h)) continue
        if (!firstPage) pdf.addPage()
        firstPage = false
        pdf.addImage(slice.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, W, H)
      }
    }
  } finally {
    preview.classList.remove('is-capturing')
    preview.style.zoom = zoom
  }
  return pdf.output('blob')
}

function pdfName(def, emp) {
  const d = new Date()
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const safe = (s) => String(s || '').replace(/[\\/:*?"<>|]+/g, ' ').trim()
  return `${safe(def.fileName)} - ${safe(emp?.arabic_name)} - ${stamp}.pdf`
}

async function savePdf() {
  const blob = await buildPdf()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = pdfName(state.def, state.employee)
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}

/* The PDF is loaded into a hidden frame and printed from there, so what
   comes out of the printer is exactly the file Save PDF writes. Where a
   browser will not print a PDF from a frame, it opens in a new tab with
   its own print button. */
async function printPdf() {
  const blob = await buildPdf()
  const url = URL.createObjectURL(blob)
  const frame = $('printFrame')
  const done = () => setTimeout(() => URL.revokeObjectURL(url), 120000)
  frame.onload = () => {
    try {
      frame.contentWindow.focus()
      frame.contentWindow.print()
    } catch (_) {
      window.open(url, '_blank')
    }
    done()
  }
  frame.src = url
}

/* ------------------------------------------------------------------ */
/* Employees                                                            */
/* ------------------------------------------------------------------ */

const state = { def: null, employee: null, employees: [], busy: false }

async function loadEmployees() {
  const supabase = await IEnergyAuth.getClient()
  const { data, error } = await supabase
    .from('employee_profiles')
    .select('id, code, arabic_name, national_id, hired_on, contract_expiry, is_active')
    .eq('is_active', true)
    .not('arabic_name', 'is', null)
    .order('arabic_name')
  if (error) throw error
  state.employees = (data || []).map((e) => ({ ...e, _key: foldArabic(e.arabic_name) }))
  return state.employees
}

function showOptions(list) {
  const ul = $('employeeOptions')
  const input = $('employeeSearch')
  ul.innerHTML = ''
  for (const e of list.slice(0, 50)) {
    const li = document.createElement('li')
    li.className = 'hr-option'
    li.setAttribute('role', 'option')
    li.dataset.id = e.id
    const n = document.createElement('span')
    n.textContent = e.arabic_name
    const c = document.createElement('small')
    c.textContent = toArabicDigits(e.code ?? '')
    li.append(n, c)
    li.addEventListener('mousedown', (ev) => { ev.preventDefault(); pickEmployee(e) })
    ul.appendChild(li)
  }
  if (!list.length) {
    const li = document.createElement('li')
    li.className = 'hr-option is-none'
    li.textContent = 'لا توجد نتائج'
    ul.appendChild(li)
  }
  ul.hidden = false
  input.setAttribute('aria-expanded', 'true')
}

function hideOptions() {
  $('employeeOptions').hidden = true
  $('employeeSearch').setAttribute('aria-expanded', 'false')
}

function search(term) {
  const q = foldArabic(term)
  const digits = String(term).replace(/[٠-٩]/g, (d) => AR_DIGITS.indexOf(d)).replace(/\D/g, '')
  if (!q) return state.employees
  return state.employees.filter((e) =>
    e._key.includes(q) || (digits && String(e.code ?? '').includes(digits)))
}

function wirePicker() {
  const input = $('employeeSearch')
  input.addEventListener('input', () => {
    if (state.employee) setEmployee(null)
    showOptions(search(input.value))
  })
  input.addEventListener('focus', () => showOptions(search(state.employee ? '' : input.value)))
  input.addEventListener('blur', () => setTimeout(hideOptions, 100))
  input.addEventListener('keydown', (e) => {
    const ul = $('employeeOptions')
    const items = Array.from(ul.querySelectorAll('.hr-option:not(.is-none)'))
    if (!items.length) return
    let i = items.findIndex((li) => li.classList.contains('is-active'))
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (ul.hidden) showOptions(search(input.value))
      i = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length
      items.forEach((li, k) => li.classList.toggle('is-active', k === i))
      items[i].scrollIntoView({ block: 'nearest' })
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const li = items[Math.max(0, i)]
      const emp = state.employees.find((x) => String(x.id) === li.dataset.id)
      if (emp) pickEmployee(emp)
    } else if (e.key === 'Escape') {
      hideOptions()
    }
  })
}

function pickEmployee(emp) {
  $('employeeSearch').value = emp.arabic_name
  hideOptions()
  setEmployee(emp)
}

function setEmployee(emp) {
  state.employee = emp
  refresh()
}

/* Fill the document and the read-only list beside it, and decide whether
   the document is complete enough to be issued. */
function refresh() {
  const def = state.def
  if (!def) return
  const emp = state.employee
  const values = def.values(emp)
  fillFields(values)

  const box = $('autoFields')
  box.innerHTML = ''
  for (const [n, label] of Object.entries(def.labels)) {
    const row = document.createElement('div')
    row.className = 'hr-auto-row'
    const l = document.createElement('span')
    l.textContent = label
    const v = document.createElement('output')
    v.textContent = values[n] || '—'
    row.append(l, v)
    box.appendChild(row)
  }

  const missing = emp ? def.required.filter(([k]) => !emp[k]).map(([, label]) => label) : []
  const warn = $('fieldWarning')
  warn.hidden = !missing.length
  warn.textContent = missing.length
    ? `بيانات ناقصة في قاعدة بيانات الموظفين: ${missing.join('، ')}. أكملها أولاً ثم أعد الاختيار.`
    : ''

  const ready = !!emp && !missing.length && !state.busy
  $('savePdfBtn').disabled = !ready
  $('printBtn').disabled = !ready
}

/* ------------------------------------------------------------------ */
/* Views                                                                */
/* ------------------------------------------------------------------ */

function drawList() {
  const list = $('docList')
  list.innerHTML = ''
  DOCUMENTS.forEach((def, i) => {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'hr-doc'
    btn.disabled = !def.template
    const num = document.createElement('span')
    num.className = 'hr-doc-num'
    num.textContent = String(i + 1)
    const text = document.createElement('span')
    text.className = 'hr-doc-text'
    const t = document.createElement('span')
    t.className = 'hr-doc-title'
    t.dir = 'rtl'
    t.textContent = def.title
    const s = document.createElement('span')
    s.className = 'hr-doc-sub'
    s.textContent = def.template ? def.subtitle : `${def.subtitle} · coming soon`
    text.append(t, s)
    const icon = document.createElement('span')
    icon.className = 'hr-doc-icon'
    icon.textContent = 'W'
    btn.append(icon, text, num)
    if (def.template) btn.addEventListener('click', () => openDocument(def))
    list.appendChild(btn)
  })
}

async function openDocument(def) {
  state.def = def
  state.employee = null
  $('employeeSearch').value = ''
  $('editorTitle').textContent = def.title
  $('listView').hidden = true
  $('editorView').hidden = false
  history.replaceState(null, '', `#${def.id}`)
  try {
    await drawDocument(def)
  } catch (err) {
    $('previewStatus').textContent = `Could not load the document: ${err.message || err}`
    return
  }
  refresh()
}

function closeDocument() {
  state.def = null
  state.employee = null
  $('editorView').hidden = true
  $('listView').hidden = false
  $('preview').innerHTML = ''
  history.replaceState(null, '', location.pathname)
}

function busy(btn, label, work) {
  return async () => {
    if (state.busy) return
    state.busy = true
    const text = btn.textContent
    btn.textContent = label
    refresh()
    try {
      await work()
    } catch (err) {
      console.error(err)
      alertError(err)
    } finally {
      state.busy = false
      btn.textContent = text
      refresh()
    }
  }
}

function alertError(err) {
  const warn = $('fieldWarning')
  warn.hidden = false
  warn.textContent = `تعذر إنشاء ملف PDF: ${err.message || err}`
}

/* ------------------------------------------------------------------ */
/* Start                                                                */
/* ------------------------------------------------------------------ */

function fillPageBar() {
  const me = IEnergyAuth.getProfile && IEnergyAuth.getProfile()
  const who = $('whoami')
  const badge = $('roleBadge')
  if (!me || !who || !badge) return
  who.textContent = ''
  const name = document.createElement('span')
  name.className = 'who-name'
  name.textContent = me.name || ''
  who.appendChild(name)
  const LABEL = { super_admin: 'Super admin', admin: 'Admin' }
  badge.textContent = LABEL[me.trackerRole] || me.trackerRole || ''
  badge.className = 'role-badge' + (me.trackerRole === 'super_admin' ? ' is-super' : ' is-admin')
  badge.hidden = false
  const slot = $('themeSlot')
  const toggle = document.querySelector('.theme-toggle')
  if (slot && toggle) slot.appendChild(toggle)
}

async function onAuthed() {
  fillPageBar()
  drawList()
  wirePicker()
  $('backBtn').addEventListener('click', closeDocument)
  $('savePdfBtn').addEventListener('click', busy($('savePdfBtn'), 'Saving…', savePdf))
  $('printBtn').addEventListener('click', busy($('printBtn'), 'Preparing…', printPdf))

  const hint = $('employeeHint')
  loadEmployees()
    .then((list) => { hint.textContent = `${toArabicDigits(list.length)} موظف — ابحث بالاسم أو الكود.` })
    .catch((err) => { hint.textContent = `تعذر تحميل الموظفين: ${err.message || err}` })

  const wanted = DOCUMENTS.find((d) => d.template && `#${d.id}` === location.hash)
  if (wanted) openDocument(wanted)
}

function start() {
  $('year').textContent = String(new Date().getFullYear())
  const out = $('logoutBtn')
  out.addEventListener('click', () => {
    out.disabled = true
    out.textContent = 'Signing out…'
    IEnergyAuth.signOutAndLeave('../index.html')
  })
  IEnergyAuth.ensureAuth({ allowedRoles: ['admin'], homeHref: '../index.html', onAuthed })
}

if (window.IEnergyAuth) start()
