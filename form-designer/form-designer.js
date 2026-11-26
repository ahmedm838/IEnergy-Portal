/* Form Designer
   - Super admins only, opened from the tracker's Settings page.
   - Two panes in one tab. Left: the form's Word file, opened in an
     editor in the page (SuperDoc). Right: HR Documents or Employee
     Documents in a frame (?designer=1), so the form is drawn by the very
     engine the portal uses -- same layout, pages and blanks. Each edit
     on the left is saved to a Word file in memory and handed to the
     frame, which redraws the form a moment after typing stops.
   - "Replace on portal" writes that Word file over the template in the
     GitHub repository (one commit, so GitHub's history can undo it) and
     can start the "Deploy to cPanel" workflow. It uses a fine-grained
     token the super admin pastes in once, kept in this browser only.
*/

const REPO = 'ahmedm838/ienergy-portal'
const BRANCH = 'main'
const DEPLOY_WORKFLOW = 'deploy-cpanel.yml'
const TOKEN_KEY = 'ienergy.formDesigner.githubToken'
const PAGES = {
  hr: { dir: 'hr-documents', label: 'HR Documents' },
  employee: { dir: 'employee-documents', label: 'Employee Documents' },
}
const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const SUPERDOC = '../vendor/superdoc-2.35.0/superdoc.js'
// How long typing has to pause before the preview is redrawn.
const QUIET_MS = 400

const $ = (id) => document.getElementById(id)

const state = {
  page: 'hr',
  forms: [],
  form: null, // the entry chosen in the list
  editor: null, // the SuperDoc in the left pane
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
  if (!form) { status('Pick a form: it opens on the left for editing, and the right shows it as the portal will.'); return }
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

/* Open a Word file in the left pane. changed: it differs from the live
   form (a file from the computer), so the preview takes it at once. */
async function openInEditor(buf, name, { changed = false } = {}) {
  if (!isDocx(buf)) throw new Error(`${name} is not a Word (.docx) file`)
  const SuperDoc = await superDoc()
  closeEditor()
  const id = state.loadId
  $('editorHost').innerHTML = ''
  const host = document.createElement('div')
  host.id = `doc${id}`
  $('editorHost').appendChild(host)
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
    status(`Editing ${name}. Type on the left; the preview on the right follows.`)
  }
}

async function loadLive() {
  const f = state.form
  const res = await fetch(`../${PAGES[state.page].dir}/${f.template}`, { cache: 'no-cache' })
  if (!res.ok) throw new Error(`Could not get the live file (${res.status})`)
  const buf = await res.arrayBuffer()
  if (state.form !== f) return
  await openInEditor(buf, templateName())
}

/* An edit on the left: once typing pauses, save the document to a Word
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
/* GitHub                                                               */
/* ------------------------------------------------------------------ */

function getToken() {
  try { return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY) || '' } catch (_) { return '' }
}
function setToken(token, remember) {
  try {
    localStorage.removeItem(TOKEN_KEY)
    sessionStorage.removeItem(TOKEN_KEY)
    if (token) (remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, token)
  } catch (_) {}
}

async function gh(path, { method = 'GET', body, token = getToken() } = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (res.status === 204) return null
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const why = res.status === 401 ? 'the token is not valid or has expired'
      : res.status === 403 || res.status === 404 ? 'the token has no access to this (check its repository and permissions)'
      : data.message || `GitHub answered ${res.status}`
    const err = new Error(why)
    err.status = res.status
    throw err
  }
  return data
}

function toBase64(buf) {
  const bytes = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

function openTokenDialog(msg = '') {
  $('tokenInput').value = ''
  $('tokenInput').placeholder = getToken() ? 'A token is saved — paste a new one to change it' : 'github_pat_…'
  $('tokenMsg').textContent = msg
  $('tokenMsg').classList.remove('is-error')
  $('tokenDialog').showModal()
}

async function saveToken() {
  const token = $('tokenInput').value.trim()
  const msg = $('tokenMsg')
  if (!token) { msg.textContent = 'Paste a token first.'; msg.classList.add('is-error'); return }
  msg.textContent = 'Checking…'
  msg.classList.remove('is-error')
  try {
    const repo = await gh(`/repos/${REPO}`, { token })
    if (repo.permissions && !repo.permissions.push) throw new Error('the token can read the repository but not write to it')
    setToken(token, $('tokenRemember').checked)
    msg.textContent = 'Saved.'
    setTimeout(() => $('tokenDialog').close(), 600)
  } catch (err) {
    msg.textContent = `Not saved: ${err.message}.`
    msg.classList.add('is-error')
  }
}

async function openReplaceDialog() {
  const f = state.form
  if (!f) return
  await flushEdits()
  if (!state.bytes) return
  if (!getToken()) { openTokenDialog('Add GitHub access first, then press Replace again.'); return }
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
  const path = `${PAGES[state.page].dir}/${f.template}`
  const url = `/repos/${REPO}/contents/${path.split('/').map(encodeURIComponent).join('/')}`
  try {
    msg.textContent = 'Reading the current file…'
    let sha
    try { sha = (await gh(`${url}?ref=${BRANCH}`)).sha } catch (err) { if (err.status !== 404) throw err }
    msg.textContent = 'Replacing…'
    const me = window.IEnergyAuth?.getProfile?.()
    const done = await gh(url, {
      method: 'PUT',
      body: {
        message: `Replace ${f.subtitle || f.title} form template (${f.template.split('/').pop()})${me?.name ? ` — by ${me.name}` : ''}\n\nReplaced from the Form Designer.`,
        content: toBase64(state.bytes),
        branch: BRANCH,
        ...(sha ? { sha } : {}),
      },
    })
    state.replaced = true
    state.livePages[f.template] = checkResult()?.part.pages ?? state.livePages[f.template]
    let text = `Replaced. Commit ${done.commit.sha.slice(0, 7)} is on GitHub.`
    if ($('deployNow').checked) {
      msg.textContent = `${text} Starting the deploy…`
      try {
        await gh(`/repos/${REPO}/actions/workflows/${DEPLOY_WORKFLOW}/dispatches`, {
          method: 'POST', body: { ref: BRANCH, inputs: { dry_run: 'false' } },
        })
        text += ' Deploy to cPanel started — the live site has it in about a minute.'
      } catch (err) {
        text += ` The deploy did not start (${err.message}); run “Deploy to cPanel” in GitHub Actions.`
      }
    } else {
      text += ' It reaches the live site with the next “Deploy to cPanel”.'
    }
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
  $('tokenBtn').addEventListener('click', () => openTokenDialog())
  $('tokenSave').addEventListener('click', saveToken)
  $('tokenForget').addEventListener('click', () => { setToken(''); $('tokenMsg').textContent = 'Token removed from this browser.' })
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
