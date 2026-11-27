/* Form Designer
   - Super admins only, opened from the tracker's Settings page.
   - Two panes in one tab. Right: the form's Word file, opened in an
     editor in the page (SuperDoc). Left: HR Documents or Employee
     Documents in a frame (?designer=1), so the form is drawn by the very
     engine the portal uses -- same layout, pages and blanks. Each edit
     on the right is saved to a Word file in memory and handed to the
     frame, which redraws the form a moment after typing stops.
   - "Replace on portal" sends that Word file to the server
     (api/form-template.php), which checks the user is a super admin,
     backs up the live template and writes the new one over it: live at
     once, no deploy, and no GitHub token in the browser. When the server
     has a GitHub token of its own it commits the file to the repository
     too.
*/

const REPLACE_API = '../api/form-template.php'
const PAGES = {
  hr: { dir: 'hr-documents', label: 'HR Documents' },
  employee: { dir: 'employee-documents', label: 'Employee Documents' },
}
const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const SUPERDOC = '../vendor/superdoc-2.35.0/superdoc.js'
// The same Word-file reader the preview loads (JSZip), for the page border.
const DOCX_LIBS = '../vendor/hr-docs-libs-1.js?v=2'
// How long typing has to pause before the preview is redrawn.
const QUIET_MS = 400

const $ = (id) => document.getElementById(id)

const state = {
  page: 'hr',
  forms: [],
  form: null, // the entry chosen in the list
  editor: null, // the SuperDoc in the right pane
  loadId: 0, // which load the editor is showing; older ones are dropped
  bytes: null, // the edited Word file, once there is one
  quiet: 0, // the timer that waits for typing to pause
  exporting: false,
  dirty: false, // edits not yet saved to state.bytes
  again: false, // an edit came in while a save was running
  fileName: '',
  replaced: false,
  livePages: {}, // template -> pages, as the live file draws
  liveOver: {}, // template -> { page: % past A4 }, as the live file draws
  report: null, // the frame's last report for the open form
}

/* ------------------------------------------------------------------ */
/* The frame                                                            */
/* ------------------------------------------------------------------ */

const frame = () => $('frame')
function tellFrame(msg) {
  frame().contentWindow?.postMessage({ source: 'ienergy-designer', ...msg }, location.origin)
}

function loadPage(page, wanted = '') {
  state.page = PAGES[page] ? page : 'hr'
  state.forms = []
  state.form = null
  state.report = null
  closeEditor()
  clearFile()
  for (const t of document.querySelectorAll('.fd-tab')) t.classList.toggle('is-on', t.dataset.page === state.page)
  const sel = $('formSelect')
  sel.innerHTML = '<option>Loading forms…</option>'
  sel.disabled = true
  state.wanted = wanted
  frame().src = `../${PAGES[state.page].dir}/?designer=1`
  setHash()
}

function setHash() {
  const t = state.form ? `/${state.form.template}` : ''
  history.replaceState(null, '', `#${state.page}${t}`)
}

window.addEventListener('message', (e) => {
  if (e.origin !== location.origin || e.source !== frame().contentWindow) return
  const msg = e.data || {}
  if (msg.source !== 'ienergy-documents') return
  if (msg.type === 'ready') fillForms(msg.forms || [])
  else if (msg.type === 'rendered') onRendered(msg)
})

function fillForms(forms) {
  state.forms = forms
  const sel = $('formSelect')
  sel.innerHTML = ''
  const blank = document.createElement('option')
  blank.value = ''
  blank.textContent = '— Choose a form —'
  sel.appendChild(blank)
  forms.forEach((f, i) => {
    const o = document.createElement('option')
    o.value = String(i)
    const part = f.inPack ? ` ← ${f.title}` : ''
    o.textContent = `${f.number}. ${f.docTitle}${part}  ·  ${f.template.replace(/^templates\//, '')}`
    sel.appendChild(o)
  })
  sel.disabled = false
  const at = state.wanted ? forms.findIndex((f) => f.template === state.wanted) : -1
  if (at >= 0) { sel.value = String(at); chooseForm(forms[at]) }
}

function chooseForm(form) {
  if (state.bytes && !state.replaced && !confirm('Your edits have not been replaced on the portal. Switch forms anyway?')) {
    $('formSelect').value = String(state.forms.indexOf(state.form))
    return
  }
  if (state.form) tellFrame({ type: 'template', template: state.form.template, data: null })
  closeEditor()
  clearFile()
  state.form = form
  state.report = null
  setHash()
  showCheck()
  if (!form) { status('Pick a form: it opens on the right for editing, and the left shows it as the portal will.'); return }
  tellFrame({ type: 'open', doc: form.doc })
  loadLive().catch(fail)
}

function onRendered(msg) {
  if (!state.form || msg.doc !== state.form.doc) return
  for (const p of msg.parts || []) {
    const edited = state.bytes && p.template === state.form.template
    if (!edited && state.livePages[p.template] == null) {
      state.livePages[p.template] = p.pages
      state.liveOver[p.template] = Object.fromEntries((p.over || []).map((o) => [o.page, o.by]))
    }
  }
  state.report = msg
  showCheck()
}

/* What the edited file came to: its pages against the live file's, and
   any blank the form fills that the file no longer has. */
function checkResult() {
  const f = state.form
  const part = state.report?.parts?.find((p) => p.template === f?.template)
  if (!f || !part) return null
  const live = state.livePages[f.template]
  // Pages that run longer than the same page of the live file: some live
  // forms already run past A4 on screen and print right, so only an edit
  // that makes a page longer is worth a word.
  const was = state.liveOver[f.template] || {}
  const longer = state.bytes ? (part.over || []).filter((o) => o.by > (was[o.page] || 0) + 3) : []
  return { part, live, longer, missing: part.missing || [], pagesChanged: live != null && state.bytes && part.pages !== live }
}

function showCheck() {
  const bar = $('checkBar')
  const r = checkResult()
  if (!r) { bar.hidden = true; return }
  const lines = []
  const which = state.bytes ? 'Your edits' : 'Live form'
  lines.push(`${which}: ${r.part.pages} page${r.part.pages === 1 ? '' : 's'}${state.bytes && r.live != null ? ` (live: ${r.live})` : ''}.`)
  if (r.missing.length) lines.push(`Blanks not found: ${r.missing.map((n) => `(${n})`).join(' ')} — the portal fills these, so keep them in the text as (number).`)
  else lines.push('All blanks found.')
  if (r.pagesChanged) lines.push('The page count changed — print will follow the new count.')
  if (r.longer.length) lines.push(`Page ${r.longer.map((o) => o.page).join(', ')} is now longer than in the live file — check the printout still fits as before, or trim it in Word.`)
  if (state.report?.error) lines.push(`Could not draw the last save: ${state.report.error}. Showing the one before.`)
  bar.textContent = lines.join('  ')
  bar.classList.toggle('is-warn', !!(r.missing.length || r.pagesChanged || r.longer.length || state.report?.error))
  bar.hidden = false
}

/* ------------------------------------------------------------------ */
/* The editor                                                           */
/* ------------------------------------------------------------------ */

function status(text, busy = false) {
  const s = $('editStatus')
  s.textContent = text
  s.classList.toggle('is-live', busy)
}

function fail(err) {
  console.error(err)
  status(`Something went wrong: ${err.message || err}`)
}

const clock = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
const templateName = () => state.form?.template.split('/').pop() || 'form.docx'

function clearFile() {
  clearTimeout(state.quiet)
  state.dirty = false
  state.bytes = null
  state.fileName = ''
  state.replaced = false
  $('replaceBtn').disabled = true
  $('revertBtn').disabled = true
}

function closeEditor() {
  state.loadId++
  clearTimeout(state.quiet)
  try { state.editor?.destroy() } catch (_) {}
  state.editor = null
  state.unwatchRtl?.()
  state.unwatchRtl = null
  $('downloadBtn').disabled = true
  $('toolbar').innerHTML = ''
  $('editorHost').innerHTML = '<p class="fd-empty">Choose a form above to start editing.</p>'
}

const isDocx = (buf) => {
  const b = new Uint8Array(buf, 0, Math.min(4, buf.byteLength))
  return b.length === 4 && b[0] === 0x50 && b[1] === 0x4b
}

let SuperDocClass = null
async function superDoc() {
  if (!SuperDocClass) {
    status('Loading the editor…', true)
    SuperDocClass = (await import(SUPERDOC)).SuperDoc
  }
  return SuperDocClass
}

/* Open a Word file in the right pane. changed: it differs from the live
   form (a file from the computer), so the preview takes it at once. */
async function openInEditor(buf, name, { changed = false } = {}) {
  if (!isDocx(buf)) throw new Error(`${name} is not a Word (.docx) file`)
  const SuperDoc = await superDoc()
  const border = await readPageBorder(buf)
  closeEditor()
  const id = state.loadId
  $('editorHost').innerHTML = ''
  const host = document.createElement('div')
  host.id = `doc${id}`
  $('editorHost').appendChild(host)
  state.unwatchRtl = watchRtl(host, border)
  status(`Opening ${name}…`, true)
  const file = new File([buf], name, { type: DOCX_TYPE })
  await new Promise((resolve, reject) => {
    try {
      state.editor = new SuperDoc({
        selector: `#${host.id}`,
        toolbar: '#toolbar',
        document: file,
        documentMode: 'editing',
        // Never reports to SuperDoc's servers what is opened here.
        telemetry: { enabled: false },
        zoom: { mode: 'fit-width' },
        onReady: () => resolve(),
        onEditorUpdate: () => { if (state.loadId === id) edited() },
        onException: (e) => console.error(e?.error || e),
      })
    } catch (err) { reject(err) }
  })
  if (state.loadId !== id) return
  state.fileName = name
  $('downloadBtn').disabled = false
  if (changed) {
    useFile(buf, name)
    status(`Editing ${name}. The preview shows your file.`)
  } else {
    status(`Editing ${name}. Type on the right; the preview on the left follows.`)
  }
}

async function loadLive() {
  const f = state.form
  // A new address each time: a template just replaced must not come
  // back from a cache in front of the site.
  const sep = f.template.includes('?') ? '&' : '?'
  const res = await fetch(`../${PAGES[state.page].dir}/${f.template}${sep}t=${Date.now()}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`Could not get the live file (${res.status})`)
  const buf = await res.arrayBuffer()
  if (state.form !== f) return
  await openInEditor(buf, templateName())
}

/* An edit in the editor: once typing pauses, save the document to a Word
   file in memory and hand it to the preview. Only one save runs at a
   time; edits made during it are caught by one more save after it. */
function edited() {
  state.dirty = true
  state.replaced = false
  $('revertBtn').disabled = false
  status('Editing… the preview updates when you pause.', true)
  clearTimeout(state.quiet)
  state.quiet = setTimeout(pushEdits, QUIET_MS)
}

async function exportDocx() {
  const blob = await state.editor.export({ triggerDownload: false, isFinalDoc: false, commentsType: 'clean' })
  return blob.arrayBuffer()
}

async function pushEdits() {
  if (!state.editor) return
  if (state.exporting) { state.again = true; return }
  state.exporting = true
  state.dirty = false
  const id = state.loadId
  try {
    const buf = await exportDocx()
    if (state.loadId === id) {
      useFile(buf, state.fileName || templateName())
      status(`Preview updated ${clock()}.`)
    }
  } catch (err) {
    fail(err)
  } finally {
    state.exporting = false
    if (state.again) { state.again = false; pushEdits() }
  }
}

/* Every edit waiting for its save is saved now (before Replace or a
   download). */
async function flushEdits() {
  clearTimeout(state.quiet)
  while (state.exporting) await new Promise((r) => setTimeout(r, 50))
  if (state.editor && state.dirty) {
    state.dirty = false
    const buf = await exportDocx()
    useFile(buf, state.fileName || templateName())
  }
}

function useFile(buf, name) {
  if (!state.form) return
  state.bytes = buf
  state.fileName = name
  $('replaceBtn').disabled = false
  $('revertBtn').disabled = false
  tellFrame({ type: 'template', template: state.form.template, data: buf.slice(0), stamp: `${Date.now()}` })
}

async function downloadDocx() {
  if (!state.editor) return
  await flushEdits()
  const buf = state.bytes || await exportDocx()
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([buf], { type: DOCX_TYPE }))
  a.download = templateName()
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
}

async function startOver() {
  if (!state.form) return
  if (state.bytes && !state.replaced && !confirm('Throw away your edits and start again from the live form?')) return
  tellFrame({ type: 'template', template: state.form.template, data: null })
  clearFile()
  await loadLive()
}

/* The two panes share the width; the bar between them is dragged to
   change the share, and remembered. */
function wireResizer() {
  const split = $('split')
  const bar = $('resizer')
  const set = (pct) => {
    pct = Math.min(80, Math.max(20, pct))
    split.style.setProperty('--fd-left', `${pct}%`)
    try { localStorage.setItem('ienergy.formDesigner.split', String(pct)) } catch (_) {}
  }
  try { const saved = +localStorage.getItem('ienergy.formDesigner.split'); if (saved) set(saved) } catch (_) {}
  bar.addEventListener('pointerdown', (e) => {
    if (matchMedia('(max-width: 800px)').matches) return
    e.preventDefault()
    bar.setPointerCapture(e.pointerId)
    bar.classList.add('is-dragging')
    // The frame would swallow the pointer while it is dragged over.
    $('frame').style.pointerEvents = 'none'
    const move = (ev) => {
      const r = split.getBoundingClientRect()
      set(((ev.clientX - r.left) / r.width) * 100)
    }
    const up = () => {
      bar.classList.remove('is-dragging')
      $('frame').style.pointerEvents = ''
      bar.removeEventListener('pointermove', move)
      bar.removeEventListener('pointerup', up)
    }
    bar.addEventListener('pointermove', move)
    bar.addEventListener('pointerup', up)
  })
  bar.addEventListener('keydown', (e) => {
    const now = parseFloat(getComputedStyle(split).getPropertyValue('--fd-left')) || 50
    if (e.key === 'ArrowLeft') set(now - 5)
    if (e.key === 'ArrowRight') set(now + 5)
  })
}

/* ------------------------------------------------------------------ */
/* Right-to-left lines in the editor                                    */
/* ------------------------------------------------------------------ */

/* SuperDoc 2.35 draws a right-to-left line as a flex row with
   dir="rtl" AND flex-direction: row-reverse. The two cancel out, so the
   runs of an Arabic line -- each bold word, each colon, each "(3)" is
   its own run -- come out left to right: the words of a sentence in the
   wrong order, and nothing like the preview or Word. form-designer.css
   puts the row the right way round (.fd-editor rules) and drops the
   left-to-right spacing SuperDoc gives the runs; the rest is here:

   - A right-to-left paragraph's indent is on its right in Word (w:ind
     left is the start side), but SuperDoc puts it on the left, so a
     numbered item has its number on the left of the text. The line is
     mirrored inside its paragraph.
   - The list number hangs out past the indent and the text keeps a gap
     after it; SuperDoc gives both as left margins, which belong on the
     right.

   Lines are fixed as SuperDoc draws them (it redraws while typing), and
   each line is fixed once per drawing: its style is remembered, and a
   line drawn again has a new one. Only the drawing changes; the Word
   file the editor saves is untouched. */
const RTL_DONE = 'fdRtl'

function fixRtlLine(line) {
  if (line.dataset[RTL_DONE] === (line.getAttribute('style') || '')) return
  const left = parseFloat(line.style.left) || 0
  const width = parseFloat(line.style.width) || 0
  const box = line.parentElement?.offsetWidth || 0
  if (box && width && left > 0.5) line.style.left = `${Math.max(0, box - left - width)}px`
  const marker = line.querySelector(':scope > .superdoc-list-marker')
  if (marker) {
    marker.style.setProperty('margin-right', marker.style.marginLeft || '0px', 'important')
    let next = marker.nextElementSibling
    while (next?.classList.contains('superdoc-marker-suffix-tab')) next = next.nextElementSibling
    if (next?.style.marginLeft) next.style.setProperty('margin-right', next.style.marginLeft, 'important')
  }
  keepLatinOrder(line)
  line.dataset[RTL_DONE] = line.getAttribute('style') || ''
}

/* English inside an Arabic line reads left to right, as Word shows it:
   the line runs right to left, but "Job Application" made of runs
   "Job", " ", "Application" must not come out "Application Job". Runs
   of English, with only spaces or punctuation between them, are put
   back in their own order with CSS order. A tab ends such a stretch, as
   it does in Word. */
const ARABIC_CHAR = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/
const LATIN_CHAR = /[A-Za-z\u00C0-\u024F]/
function keepLatinOrder(line) {
  const kids = [...line.children]
  const kind = (el) => {
    if (!el.classList.contains('superdoc-text-run')) return 'X'
    const t = el.textContent
    return ARABIC_CHAR.test(t) ? 'R' : LATIN_CHAR.test(t) ? 'L' : 'N'
  }
  const kinds = kids.map(kind)
  let set = false
  for (let i = 0; i < kids.length; i++) {
    if (kinds[i] !== 'L') continue
    let end = i
    for (let k = i + 1; k < kids.length && (kinds[k] === 'N' || kinds[k] === 'L'); k++) if (kinds[k] === 'L') end = k
    if (end > i) {
      if (!set) { kids.forEach((el, n) => { el.style.order = String(n) }); set = true }
      for (let t = 0; t <= end - i; t++) kids[i + t].style.order = String(end - t)
    }
    i = end
  }
}

/* The page border. SuperDoc reads a section's page border but does not
   draw it; the preview does (frame() in hr-documents.js), so the editor
   draws the same line: from the Word file's own settings, on every page,
   behind the text and out of the way of the mouse. */
async function readPageBorder(buf) {
  try {
    const { JSZip } = await import(DOCX_LIBS)
    const xml = await (await JSZip.loadAsync(buf)).file('word/document.xml').async('string')
    const sect = xml.slice(xml.lastIndexOf('<w:sectPr'))
    const b = /<w:pgBorders\b([^>]*)>([\s\S]*?)<\/w:pgBorders>/.exec(sect)
    if (!b) return null
    const twipsPx = (v) => (+v || 0) / 15
    const pageW = twipsPx(/<w:pgSz\b[^>]*w:w="(\d+)"/.exec(sect)?.[1] || 11906)
    const fromText = /w:offsetFrom="text"/.test(b[1])
    const margin = (side) => twipsPx(new RegExp(`<w:pgMar\\b[^>]*w:${side}="(-?\\d+)"`).exec(sect)?.[1] || 1440)
    const sides = {}
    for (const side of ['top', 'left', 'bottom', 'right']) {
      const tag = new RegExp(`<w:${side}\\b[^>]*>`).exec(b[2])?.[0]
      if (!tag || /w:val="(none|nil)"/.test(tag)) continue
      const num = (re, d) => { const m = re.exec(tag); return m ? +m[1] : d }
      const space = (num(/w:space="(\d+)"/, 24) * 4) / 3
      const color = /w:color="([0-9A-Fa-f]{6})"/.exec(tag)?.[1]
      sides[side] = {
        width: Math.max(1, ((num(/w:sz="(\d+)"/, 4) / 8) * 4) / 3),
        inset: fromText ? Math.max(0, margin(side) - space) : space,
        color: color ? `#${color}` : '#000',
        style: /w:val="double"/.test(tag) ? 'double' : /w:val="dashed"/.test(tag) ? 'dashed' : /w:val="dotted"/.test(tag) ? 'dotted' : 'solid',
      }
    }
    return Object.keys(sides).length ? { pageW, sides } : null
  } catch (_) {
    return null
  }
}

function framePage(page, border) {
  if (page.querySelector(':scope > .fd-page-frame')) return
  const scale = page.offsetWidth / border.pageW || 1
  const f = document.createElement('div')
  f.className = 'fd-page-frame'
  f.setAttribute('aria-hidden', 'true')
  for (const side of ['top', 'left', 'bottom', 'right']) {
    const s = border.sides[side]
    const cap = side[0].toUpperCase() + side.slice(1)
    f.style[side] = s ? `${s.inset * scale}px` : '0px'
    f.style[`border${cap}`] = s ? `${Math.max(1, s.width * scale)}px ${s.style} ${s.color}` : 'none'
  }
  page.prepend(f)
}

function watchRtl(host, border = null) {
  let queued = false
  const run = () => {
    queued = false
    for (const line of host.querySelectorAll('.ts-line.ts-line-box[dir=rtl]')) fixRtlLine(line)
    if (border) for (const page of host.querySelectorAll('.superdoc-page')) framePage(page, border)
  }
  const watcher = new MutationObserver(() => {
    if (!queued) { queued = true; requestAnimationFrame(run) }
  })
  watcher.observe(host, { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'dir'] })
  const stopArrows = watchArrows(host)
  return () => { watcher.disconnect(); stopArrows() }
}

/* Left and Right on an Arabic line. SuperDoc moves the cursor by the
   order of the text: Right goes to the next letter, which in Arabic is
   the one on the LEFT. (It has a right-to-left mode, but only for Arabic
   inside a left-to-right paragraph, never for a right-to-left paragraph,
   which is every paragraph of these forms.) So on a right-to-left line
   the two keys are swapped before SuperDoc sees them: Left moves left,
   Right moves right, with Shift (selecting), Ctrl/Alt (a word) and Cmd
   (the line) the same way. Whether the cursor is on such a line is read
   from the line under the cursor; while a selection hides the cursor,
   the last line it was on counts. */
const SWAP_KEYS = { ArrowLeft: 'ArrowRight', ArrowRight: 'ArrowLeft' }

function cursorDirection(host) {
  const caret = host.querySelector('.ts-caret')
  const c = caret?.getBoundingClientRect()
  if (!c?.height) return null
  const y = c.top + c.height / 2
  let best = null
  let bestGap = Infinity
  for (const line of host.querySelectorAll('.ts-line[dir]')) {
    const r = line.getBoundingClientRect()
    if (y < r.top - 1 || y > r.bottom + 1) continue
    const gap = c.left < r.left ? r.left - c.left : c.left > r.right ? c.left - r.right : 0
    if (gap < bestGap) { bestGap = gap; best = line }
  }
  return best && bestGap < 40 ? best.getAttribute('dir') : null
}

function watchArrows(host) {
  let lastDir = null
  const onKey = (e) => {
    const to = SWAP_KEYS[e.key]
    if (!to || !e.isTrusted || !host.contains(e.target)) return
    const dir = cursorDirection(host) ?? lastDir
    lastDir = dir
    if (dir !== 'rtl') return
    e.preventDefault()
    e.stopImmediatePropagation()
    e.target.dispatchEvent(new KeyboardEvent('keydown', {
      key: to, code: to, bubbles: true, cancelable: true, composed: true,
      shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey, repeat: e.repeat,
    }))
  }
  // On the window, capturing: ahead of SuperDoc's own key handling.
  window.addEventListener('keydown', onKey, true)
  return () => window.removeEventListener('keydown', onKey, true)
}

/* ------------------------------------------------------------------ */
/* Replace on the portal                                                */
/* ------------------------------------------------------------------ */

async function sessionToken() {
  const supabase = await window.IEnergyAuth.getClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('your sign-in has expired. Sign in again on iEnergy Home')
  return session.access_token
}

async function openReplaceDialog() {
  const f = state.form
  if (!f) return
  await flushEdits()
  if (!state.bytes) return
  const path = `${PAGES[state.page].dir}/${f.template}`
  $('replaceWhat').textContent = `Your edited ${state.fileName} will replace ${path} — ${f.inPack ? `${f.docTitle} ← ${f.title}` : f.docTitle}.`
  const warn = []
  const r = checkResult()
  if (r?.missing.length) warn.push(`Blanks not found in your file: ${r.missing.map((n) => `(${n})`).join(' ')}. Those details will not be filled on the form.`)
  if (r?.pagesChanged) warn.push(`Your file draws ${r.part.pages} pages; the live one ${r.live}.`)
  if (r?.longer.length) warn.push(`Page ${r.longer.map((o) => o.page).join(', ')} is longer than in the live file.`)
  const base = f.template.split('/').pop()
  if (state.fileName && state.fileName !== base) warn.push(`Your file is named ${state.fileName}, not ${base} — make sure it is the right form.`)
  $('replaceWarn').hidden = !warn.length
  $('replaceWarn').textContent = warn.join(' ')
  $('replaceMsg').textContent = ''
  $('replaceMsg').classList.remove('is-error')
  $('replaceGo').disabled = false
  $('replaceDialog').showModal()
}

async function replaceOnPortal() {
  const f = state.form
  const msg = $('replaceMsg')
  const go = $('replaceGo')
  if (!f || !state.bytes) return
  go.disabled = true
  msg.classList.remove('is-error')
  msg.textContent = 'Replacing…'
  try {
    const token = await sessionToken()
    const q = new URLSearchParams({ page: state.page, template: f.template.split('?')[0] })
    const res = await fetch(`${REPLACE_API}?${q}`, {
      method: 'POST',
      // Both: some Apache setups drop Authorization before PHP sees it.
      headers: { Authorization: `Bearer ${token}`, 'X-Supabase-Token': token, 'Content-Type': DOCX_TYPE },
      body: state.bytes,
    })
    let data = null
    try { data = await res.json() } catch (_) { /* not JSON: the PHP never ran */ }
    if (!res.ok || !data?.ok) {
      throw new Error(data?.error || (res.status === 404 ? 'the replace service is not on this server yet (it runs on the cPanel site)' : `the server answered ${res.status}`))
    }
    state.replaced = true
    state.livePages[f.template] = checkResult()?.part.pages ?? state.livePages[f.template]
    const gh = data.github || {}
    let text = 'Replaced. The live portal uses your file from now on; the old one is kept in a backup on the server.'
    if (gh.updated) text += gh.commit ? ` Saved to GitHub too (commit ${gh.commit}).` : ' GitHub already had this file.'
    else if (gh.reason === 'no-token') text += ' GitHub was not updated: the server has no GitHub token yet.'
    else if (gh.reason) text += ` GitHub was not updated (${gh.reason}).`
    msg.textContent = text
    status(`Replaced on the portal at ${clock()}. Keep editing to make more changes.`)
  } catch (err) {
    msg.textContent = `Not replaced: ${err.message}.`
    msg.classList.add('is-error')
    go.disabled = false
  }
}

/* ------------------------------------------------------------------ */
/* Start                                                                */
/* ------------------------------------------------------------------ */

/* Super admins only. The portal's sign-in knows admins and users; a
   super admin is an admin whose tracker role says so. */
function onAuthed() {
  const me = window.IEnergyAuth?.getProfile?.()
  if (me?.trackerRole !== 'super_admin') {
    $('app').hidden = true
    const denied = $('accessDenied')
    denied.hidden = false
    denied.style.display = 'grid'
    return
  }
  // Replace once used a GitHub token kept in the browser. The server does
  // that work now, so a token left behind is removed.
  try {
    localStorage.removeItem('ienergy.formDesigner.githubToken')
    sessionStorage.removeItem('ienergy.formDesigner.githubToken')
  } catch (_) {}
  const toggle = document.querySelector('.theme-toggle')
  if (toggle && $('themeSlot')) $('themeSlot').appendChild(toggle)
  for (const t of document.querySelectorAll('.fd-tab')) {
    t.addEventListener('click', () => {
      if (t.dataset.page === state.page) return
      if (state.bytes && !state.replaced && !confirm('Your edited file has not been replaced on the portal. Switch anyway?')) return
      state.bytes = null
      loadPage(t.dataset.page)
    })
  }
  $('formSelect').addEventListener('change', (e) => chooseForm(state.forms[+e.target.value] || null))
  $('openBtn').addEventListener('click', () => {
    if (!state.form) { status('Choose a form first.'); return }
    $('fileInput').click()
  })
  $('fileInput').addEventListener('change', async () => {
    const file = $('fileInput').files[0]
    $('fileInput').value = ''
    if (!file) return
    if (state.bytes && !state.replaced && !confirm('Open this file in place of your current edits?')) return
    try { await openInEditor(await file.arrayBuffer(), file.name, { changed: true }) } catch (err) { fail(err) }
  })
  $('downloadBtn').addEventListener('click', () => downloadDocx().catch(fail))
  $('revertBtn').addEventListener('click', () => startOver().catch(fail))
  $('replaceBtn').addEventListener('click', () => openReplaceDialog().catch(fail))
  $('replaceGo').addEventListener('click', replaceOnPortal)
  wireResizer()

  window.addEventListener('beforeunload', (e) => {
    if (state.bytes && !state.replaced) { e.preventDefault(); e.returnValue = '' }
  })

  const [page, ...rest] = location.hash.replace(/^#/, '').split('/')
  loadPage(page || 'hr', rest.join('/'))
}

const out = $('logoutBtn')
out.addEventListener('click', () => {
  out.disabled = true
  out.textContent = 'Signing out…'
  IEnergyAuth.signOutAndLeave('../index.html')
})
IEnergyAuth.ensureAuth({ allowedRoles: ['admin'], homeHref: '../index.html', onAuthed })
