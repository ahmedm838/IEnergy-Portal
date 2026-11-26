/* Form Designer
   - Admins and super admins. Opens HR Documents or Employee Documents in
     a frame below (?designer=1), so a form is drawn by the very engine
     the portal uses: same layout, same pages, same blanks.
   - "Get live Word file" saves the form's live template to the computer
     and watches that file; "open my Word file" watches one already
     there. Each time the file is saved in Word the frame is handed the
     new file and redraws the form from it. Chrome and Edge can watch a
     file; other browsers pick the file again after each save.
   - "Replace on portal" writes the file over the template in the GitHub
     repository (one commit, so GitHub's history can undo it) and can
     start the "Deploy to cPanel" workflow. It uses a fine-grained token
     the admin pastes in once, kept in this browser only.
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
const CAN_WATCH = typeof window.showOpenFilePicker === 'function'

const $ = (id) => document.getElementById(id)

const state = {
  page: 'hr',
  forms: [],
  form: null, // the entry chosen in the list
  handle: null, // the file being watched
  seen: null, // { lastModified, size } of the file last read
  pending: null, // a change seen once, read when it holds still
  bytes: null, // the edited Word file, once there is one
  fileName: '',
  replaced: false,
  livePages: {}, // template -> pages, as the live file draws
  liveOver: {}, // template -> { page: % past A4 }, as the live file draws
  report: null, // the frame's last report for the open form
  timer: 0,
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
  stopWatching()
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
  if (state.bytes && !state.replaced && !confirm('Your edited file has not been replaced on the portal. Switch forms anyway?')) {
    $('formSelect').value = String(state.forms.indexOf(state.form))
    return
  }
  stopWatching()
  if (state.form) tellFrame({ type: 'template', template: state.form.template, data: null })
  clearFile()
  state.form = form
  state.report = null
  setHash()
  showCheck()
  if (!form) { status('Pick a form, then get its Word file and open it in Word.'); return }
  status(CAN_WATCH
    ? 'Get the live Word file (or open your own), edit it in Word and press Save — the preview updates on its own.'
    : 'Get the live Word file, edit it in Word, then open it here. Pick it again after each save (this browser cannot watch files; Chrome can).')
  tellFrame({ type: 'open', doc: form.doc })
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
  const which = state.bytes ? 'Your file' : 'Live file'
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
/* The Word file                                                        */
/* ------------------------------------------------------------------ */

function status(text, live = false) {
  const s = $('watchStatus')
  s.textContent = text
  s.classList.toggle('is-live', live)
}

function clearFile() {
  state.bytes = null
  state.fileName = ''
  state.replaced = false
  $('replaceBtn').disabled = true
  $('revertBtn').hidden = true
}

const isDocx = (buf) => {
  const b = new Uint8Array(buf, 0, Math.min(4, buf.byteLength))
  return b.length === 4 && b[0] === 0x50 && b[1] === 0x4b
}

function useFile(buf, name) {
  if (!state.form) return
  if (!isDocx(buf)) { status(`${name} is not a Word (.docx) file.`); return }
  state.bytes = buf
  state.fileName = name
  state.replaced = false
  $('replaceBtn').disabled = false
  $('revertBtn').hidden = false
  tellFrame({ type: 'template', template: state.form.template, data: buf.slice(0), stamp: `${Date.now()}` })
}

function stopWatching() {
  clearInterval(state.timer)
  state.timer = 0
  state.handle = null
  state.seen = null
  state.pending = null
}

const clock = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })

function watch(handle, { loadNow }) {
  stopWatching()
  state.handle = handle
  const tick = async () => {
    if (state.handle !== handle) return
    let file
    try {
      file = await handle.getFile()
    } catch (err) {
      // Word holds the file for a moment while it saves.
      status(`Watching ${handle.name} — waiting for Word to finish saving…`, true)
      return
    }
    const now = { lastModified: file.lastModified, size: file.size }
    const same = (a, b) => a && b && a.lastModified === b.lastModified && a.size === b.size
    if (same(now, state.seen)) return
    // Read a change only once it has held still for one tick, so a file
    // caught half-written is never drawn.
    if (!same(now, state.pending)) { state.pending = now; return }
    state.pending = null
    state.seen = now
    try {
      const buf = await file.arrayBuffer()
      useFile(buf, handle.name)
      status(`Watching ${handle.name} — updated ${clock()}. Keep editing in Word and press Save.`, true)
    } catch (err) {
      state.seen = null
    }
  }
  if (!loadNow) {
    handle.getFile().then((f) => { state.seen = { lastModified: f.lastModified, size: f.size } }).catch(() => {})
  }
  state.timer = setInterval(tick, 700)
  status(`Watching ${handle.name} — open it in Word, edit, and press Save (Ctrl+S). The preview follows.`, true)
  if (loadNow) tick()
}

async function getLiveFile() {
  const f = state.form
  if (!f) { status('Choose a form first.'); return }
  const name = f.template.split('/').pop()
  const res = await fetch(`../${PAGES[state.page].dir}/${f.template}`, { cache: 'no-cache' })
  if (!res.ok) throw new Error(`Could not get the live file (${res.status})`)
  const blob = await res.blob()
  if (typeof window.showSaveFilePicker === 'function') {
    let handle
    try {
      handle = await window.showSaveFilePicker({
        suggestedName: name,
        types: [{ description: 'Word document', accept: { [DOCX_TYPE]: ['.docx'] } }],
      })
    } catch (err) {
      if (err.name === 'AbortError') return
      throw err
    }
    const w = await handle.createWritable()
    await w.write(blob)
    await w.close()
    watch(handle, { loadNow: false })
    status(`Saved ${handle.name}. Open it in Word, edit, and press Save (Ctrl+S) — the preview follows.`, true)
    return
  }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
  status(`Downloaded ${name}. Edit it in Word, save, then press “open my Word file” to see it.`)
}

async function openOwnFile() {
  if (!state.form) { status('Choose a form first.'); return }
  if (!CAN_WATCH) { $('fileInput').click(); return }
  let handle
  try {
    ;[handle] = await window.showOpenFilePicker({
      types: [{ description: 'Word document', accept: { [DOCX_TYPE]: ['.docx'] } }],
    })
  } catch (err) {
    if (err.name === 'AbortError') return
    throw err
  }
  watch(handle, { loadNow: true })
}

function showLive() {
  if (!state.form) return
  if (state.bytes && !state.replaced && !confirm('Show the live version and stop using your edited file?')) return
  stopWatching()
  clearFile()
  tellFrame({ type: 'template', template: state.form.template, data: null })
  status('Showing the live version.')
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

function openReplaceDialog() {
  const f = state.form
  if (!f || !state.bytes) return
  if (!getToken()) { openTokenDialog('Add GitHub access first, then press Replace again.'); return }
  const path = `${PAGES[state.page].dir}/${f.template}`
  $('replaceWhat').textContent = `${state.fileName} will replace ${path} — ${f.inPack ? `${f.docTitle} ← ${f.title}` : f.docTitle}.`
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
    status(`${state.fileName} replaced on the portal at ${clock()}.${state.handle ? ' Still watching for more saves.' : ''}`, !!state.handle)
  } catch (err) {
    msg.textContent = `Not replaced: ${err.message}.`
    msg.classList.add('is-error')
    go.disabled = false
  }
}

/* ------------------------------------------------------------------ */
/* Start                                                                */
/* ------------------------------------------------------------------ */

function wrap(fn) {
  return async () => {
    try { await fn() } catch (err) { console.error(err); status(`Something went wrong: ${err.message || err}`) }
  }
}

function onAuthed() {
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
  $('downloadBtn').addEventListener('click', wrap(getLiveFile))
  $('openBtn').addEventListener('click', wrap(openOwnFile))
  $('fileInput').addEventListener('change', wrap(async () => {
    const file = $('fileInput').files[0]
    $('fileInput').value = ''
    if (!file) return
    useFile(await file.arrayBuffer(), file.name)
    status(`Showing ${file.name} (read ${clock()}). After saving again in Word, open it again here.`)
  }))
  $('revertBtn').addEventListener('click', showLive)
  $('replaceBtn').addEventListener('click', openReplaceDialog)
  $('replaceGo').addEventListener('click', replaceOnPortal)
  $('tokenBtn').addEventListener('click', () => openTokenDialog())
  $('tokenSave').addEventListener('click', saveToken)
  $('tokenForget').addEventListener('click', () => { setToken(''); $('tokenMsg').textContent = 'Token removed from this browser.' })

  // A Word file dropped anywhere on the bar is used once.
  const bar = document.querySelector('.fd-bar')
  bar.addEventListener('dragover', (e) => { e.preventDefault() })
  bar.addEventListener('drop', async (e) => {
    e.preventDefault()
    const file = e.dataTransfer?.files?.[0]
    if (!file || !state.form) return
    stopWatching()
    useFile(await file.arrayBuffer(), file.name)
    status(`Showing ${file.name} (dropped ${clock()}).`)
  })

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
