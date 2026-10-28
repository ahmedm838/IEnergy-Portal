import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { transformSync } from 'esbuild'

// Exercise the Settings element tree and handlers without credentials or live writes.
const source = readFileSync(new URL('../src/pages/Settings.jsx', import.meta.url), 'utf8')
const code = transformSync(source.replace(/^import[\s\S]*?from ['"][^'"]+['"]\r?\n/gm, '')
  .replace('export default function Settings', 'function Settings'), { loader: 'jsx' }).code
function setup(superAdmin = true) {
  const state = [], writes = [], tables = []
  let cursor = 0, failure = null, pending = null, reloads = 0
  const sites = [{ id: 7, name: 'Admin', available: false, sort_order: 4 }]
  const allTypes = [
    { id: 1, code: 'paid_day', name_en: 'Attended', name_ar: 'حضور', meal_multiplier: 1,
      extra_hours: 0, added_hours: 0, overtime_hours: 0, effect: 'none',
      is_working_day: true, is_active: true, sort_order: 1 },
    { id: 2, code: 'study_leave', name_en: 'Study leave', name_ar: 'إجازة دراسية', meal_multiplier: 0,
      extra_hours: 0, added_hours: 0, overtime_hours: 0, effect: 'annual',
      is_working_day: false, is_active: false, sort_order: 4 },
  ]
  const lookups = { sites, allTypes, types: allTypes.filter(t => t.is_active),
    loading: false, reload: async () => { reloads++ } }
  const query = {
    update(values) { writes.push({ op: 'update', values }); return this },
    insert(values) { writes.push({ op: 'insert', values }); return this },
    eq(key, value) { writes.at(-1).filter = [key, value]; return this },
    select() { return this }, single() { return this },
  }
  const mocks = {
    React: { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) },
    // Matches React: a function initial value is a lazy initialiser, and a
    // function passed to the setter is an updater over the current value.
    useState: (initial) => { const i = cursor++; if (!(i in state)) state[i] = typeof initial === 'function' ? initial() : initial
      return [state[i], value => { state[i] = typeof value === 'function' ? value(state[i]) : value }] },
    useEffect: () => {}, useLookups: () => lookups, useAuth: () => ({ isSuperAdmin: superAdmin }),
    supabase: { from: table => { tables.push(table); return query } },
    run: async () => { if (pending) await pending; if (failure) throw Error(failure); return { id: 7 } },
  }
  for (const name of ['LockedPeriods', 'DepartmentsCard', 'AccessCard', 'BusRoutesCard', 'ChangeLogCard', 'Alert', 'Badge', 'Button', 'Card', 'CardHeader', 'Checkbox', 'Field', 'Input', 'Select', 'Spinner', 'Td', 'Th']) mocks[name] = name
  const Settings = new Function(...Object.keys(mocks), code + '\nreturn Settings')( ...Object.values(mocks))
  function render() { cursor = 0; return Settings() }
  function nodes(tree) {
    if (!tree || typeof tree !== 'object') return []
    if (Array.isArray(tree)) return tree.flatMap(nodes)
    return [tree, ...nodes(tree.props?.children ?? null)]
  }
  const find = (type, predicate = () => true) => nodes(render()).find(n => n.type === type && predicate(n.props))
  const button = text => find('Button', p => p.children.includes(text))
  const siteAvailability = () => find('Checkbox', p => p.label === 'Available' || p.label === 'Unavailable')
  const event = { preventDefault() {} }
  const add = async name => {
    find('Field', p => p.label === 'New site name').props.children[0].props.onChange({ target: { value: name } })
    return find('form', p => p.onSubmit.name === 'saveSite').props.onSubmit(event)
  }
  return { writes, tables, nodes, find, button, siteAvailability, event, add, sites, allTypes,
    typeForm: () => find('form', p => p.onSubmit.name === 'addType'),
    field: label => find('Field', p => p.label === label).props.children[0],
    reloads: () => reloads, fail: message => { failure = message }, wait: promise => { pending = promise } }
}

test('absence scale is absent from Settings', () => {
  const h = setup()
  assert.ok(!h.find('CardHeader', p => p.title === 'Absence penalty scale'))
})
test('add trims name, appends available site, reloads and clears form', async () => {
  const h = setup()
  await h.add('  New Site  ')
  assert.deepEqual(h.writes, [{ op: 'insert', values: { name: 'New Site', available: true, sort_order: 5 } }])
  assert.equal(h.reloads(), 1)
  assert.ok(h.find('Input', p => p.value === ''))
})
test('rename updates only name against existing ID; cancel makes no write', async () => {
  const h = setup()
  h.button('Rename').props.onClick()
  h.button('Cancel').props.onClick()
  assert.equal(h.writes.length, 0)
  h.button('Rename').props.onClick()
  h.find('Input', p => p['aria-label'] === 'Site name').props.onChange({ target: { value: '  Cairo  ' } })
  await h.find('form', p => p.onSubmit.name === 'onSubmit').props.onSubmit(h.event)
  assert.deepEqual(h.writes, [{ op: 'update', values: { name: 'Cairo' }, filter: ['id', 7] }])
  assert.equal(h.reloads(), 1)
  assert.ok(!h.button('Cancel'))
})
test('blank and case-insensitive duplicate names make no write', async () => {
  for (const name of ['   ', ' ADMIN ']) {
    const h = setup()
    await h.add(name)
    assert.equal(h.writes.length, 0)
    assert.ok(h.find('Alert', p => p.tone === 'error'))
  }
})
test('failed saves preserve input and show error without reloading', async () => {
  const h = setup()
  h.fail('Network unavailable')
  await h.add('New Site')
  assert.equal(h.reloads(), 0)
  assert.ok(h.find('Input', p => p.value === 'New Site'))
  assert.ok(h.find('Alert', p => p.children.includes('Network unavailable')))
})
test('read-only users have no add/rename controls and availability stays disabled', () => {
  const h = setup(false)
  assert.ok(!h.button('Rename'))
  assert.ok(!h.button('Add site'))
  assert.equal(h.siteAvailability().props.disabled, true)
})
test('availability still updates the same site ID', async () => {
  const h = setup()
  await h.siteAvailability().props.onChange()
  assert.deepEqual(h.writes, [{ op: 'update', values: { available: true }, filter: ['id', 7] }])
})
test('pending saves disable site controls and prevent a second submission', async () => {
  const h = setup()
  let release
  h.wait(new Promise(resolve => { release = resolve }))
  const saving = h.add('New Site')
  assert.equal(h.button('Add site').props.disabled, true)
  assert.equal(h.button('Rename').props.disabled, true)
  await h.find('form', p => p.onSubmit.name === 'saveSite').props.onSubmit(h.event)
  assert.equal(h.writes.length, 1)
  release()
  await saving
})




// --- Attendance types -------------------------------------------------

test('a new type gets a code from its English name and goes last', async () => {
  const h = setup()
  h.field('English name').props.onChange({ target: { value: '  Study leave B  ' } })
  h.field('Arabic name').props.onChange({ target: { value: 'إجازة' } })
  await h.typeForm().props.onSubmit(h.event)
  assert.ok(h.tables.includes('attendance_types'))
  const [write] = h.writes
  assert.equal(write.op, 'insert')
  assert.equal(write.values.code, 'study_leave_b')
  assert.equal(write.values.name_en, 'Study leave B')   // trimmed
  // The fixture's highest sort_order is 4, and a blank Order means last.
  assert.equal(write.values.sort_order, 5)
  assert.equal(write.values.is_active, true)
})

test('a code already in use gets a suffix rather than colliding', async () => {
  const h = setup()
  // 'Study leave' slugifies to study_leave, which the fixture already holds.
  h.field('English name').props.onChange({ target: { value: 'Study Leave!' } })
  h.field('Arabic name').props.onChange({ target: { value: 'إجازة' } })
  await h.typeForm().props.onSubmit(h.event)
  assert.equal(h.writes[0].values.code, 'study_leave_2')
})

test('a duplicate English name is refused, and nothing is written', async () => {
  const h = setup()
  h.field('English name').props.onChange({ target: { value: 'attended' } })
  h.field('Arabic name').props.onChange({ target: { value: 'حضور' } })
  await h.typeForm().props.onSubmit(h.event)
  assert.deepEqual(h.writes, [])
  assert.ok(h.find('Alert', p => p.tone === 'error'))
})

test('a type needs both names before it is written', async () => {
  const h = setup()
  h.field('English name').props.onChange({ target: { value: 'Only English' } })
  await h.typeForm().props.onSubmit(h.event)
  assert.deepEqual(h.writes, [])
})

test('an explicit order is used instead of going last', async () => {
  const h = setup()
  h.field('English name').props.onChange({ target: { value: 'Pinned' } })
  h.field('Arabic name').props.onChange({ target: { value: 'مثبت' } })
  h.field('Order').props.onChange({ target: { value: '2' } })
  await h.typeForm().props.onSubmit(h.event)
  assert.equal(h.writes[0].values.sort_order, 2)
})

test('availability toggles is_active on that type, and nothing else', async () => {
  const h = setup()
  const retired = h.allTypes[1]                       // Study leave, is_active false
  const box = h.find('Checkbox', p => p['aria-label'] === 'Available when recording: Study leave')
  await box.props.onChange()
  assert.deepEqual(h.writes, [
    { op: 'update', values: { is_active: !retired.is_active }, filter: ['id', retired.id] },
  ])
})

test('the types table lists unavailable types, or they could never come back', () => {
  const h = setup()
  assert.ok(h.allTypes.some(t => !t.is_active), 'fixture has a retired type')
  // Rendered rows carry an availability checkbox each, one per type.
  const boxes = h.nodes(h.find('table')).filter(
    n => n.type === 'Checkbox' && String(n.props['aria-label'] ?? '').startsWith('Available when recording'))
  assert.equal(boxes.length, h.allTypes.length)
  assert.deepEqual(boxes.map(b => b.props.checked), h.allTypes.map(t => t.is_active))
})

test('read-only users get no add-type form', () => {
  const h = setup(false)
  assert.equal(h.typeForm(), undefined)
})
