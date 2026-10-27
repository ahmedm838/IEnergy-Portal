import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { transformSync } from 'esbuild'

// Exercise the Settings element tree and handlers without credentials or live writes.
const source = readFileSync(new URL('../src/pages/Settings.jsx', import.meta.url), 'utf8')
const code = transformSync(source.replace(/^import[\s\S]*?from ['"][^'"]+['"]\r?\n/gm, '')
  .replace('export default function Settings', 'function Settings'), { loader: 'jsx' }).code
function setup(superAdmin = true) {
  const state = [], writes = []
  let cursor = 0, failure = null, pending = null, reloads = 0
  const sites = [{ id: 7, name: 'Admin', available: false, sort_order: 4 }]
  const lookups = { sites, loading: false, reload: async () => { reloads++ } }
  const query = {
    update(values) { writes.push({ op: 'update', values }); return this },
    insert(values) { writes.push({ op: 'insert', values }); return this },
    eq(key, value) { writes.at(-1).filter = [key, value]; return this },
    select() { return this }, single() { return this },
  }
  const mocks = {
    React: { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) },
    useState: (initial) => { const i = cursor++; if (!(i in state)) state[i] = initial; return [state[i], value => { state[i] = value }] },
    useEffect: () => {}, useLookups: () => lookups, useAuth: () => ({ isSuperAdmin: superAdmin }),
    supabase: { from: table => { assert.equal(table, 'sites'); return query } },
    run: async () => { if (pending) await pending; if (failure) throw Error(failure); return { id: 7 } },
  }
  for (const name of ['LockedPeriods', 'DepartmentsCard', 'AccessCard', 'BusRoutesCard', 'ChangeLogCard', 'Alert', 'Badge', 'Button', 'Card', 'CardHeader', 'Checkbox', 'Field', 'Input', 'Spinner', 'Td', 'Th']) mocks[name] = name
  const Settings = new Function(...Object.keys(mocks), code + '\nreturn Settings')( ...Object.values(mocks))
  function render() { cursor = 0; return Settings() }
  function nodes(tree) {
    if (!tree || typeof tree !== 'object') return []
    if (Array.isArray(tree)) return tree.flatMap(nodes)
    return [tree, ...nodes(tree.props?.children ?? null)]
  }
  const find = (type, predicate = () => true) => nodes(render()).find(n => n.type === type && predicate(n.props))
  const button = text => find('Button', p => p.children.includes(text))
  const event = { preventDefault() {} }
  const add = async name => {
    find('Field', p => p.label === 'New site name').props.children[0].props.onChange({ target: { value: name } })
    return find('form', p => p.onSubmit.name === 'saveSite').props.onSubmit(event)
  }
  return { writes, nodes, find, button, event, add, sites,
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
  assert.equal(h.find('Checkbox').props.disabled, true)
})
test('availability still updates the same site ID', async () => {
  const h = setup()
  await h.find('Checkbox').props.onChange()
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



