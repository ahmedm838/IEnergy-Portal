import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { transformSync } from 'esbuild'

/*
 * Bus routes, Departments and Access: the three Settings cards that live
 * in their own components. Each used to write on blur or on change, and
 * now holds edits until Save. These exercise that contract the same way
 * settings.test.mjs exercises the page -- the real source with its
 * imports stripped, run against mocks, no credentials and no live
 * writes.
 */

const strip = (text) => text.replace(/^import[\s\S]*?from ['"][^'"]+['"]\r?\n/gm, '')
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

const hookCode = strip(read('../src/lib/usePendingEdits.js'))
  .replace('export function usePendingEdits', 'function usePendingEdits')

function load(path, name) {
  const code = transformSync(
    strip(read(path)).replace(`export default function ${name}`, `function ${name}`),
    { loader: 'jsx' },
  ).code
  return { code, name }
}

const CARDS = {
  BusRoutesCard: load('../src/components/BusRoutesCard.jsx', 'BusRoutesCard'),
  DepartmentsCard: load('../src/components/DepartmentsCard.jsx', 'DepartmentsCard'),
  AccessCard: load('../src/components/AccessCard.jsx', 'AccessCard'),
}

function setup(cardName, { props = {}, employees = [] } = {}) {
  const state = [], writes = [], tables = []
  let cursor = 0, failure = null, reloads = 0

  const query = {
    update(values) { writes.push({ op: 'update', values }); return this },
    insert(values) { writes.push({ op: 'insert', values }); return this },
    delete() { writes.push({ op: 'delete' }); return this },
    eq(key, value) { writes.at(-1).filter = [key, value]; return this },
    select() { return this }, single() { return this }, order() { return this },
  }
  const useState = (initial) => {
    const i = cursor++
    if (!(i in state)) state[i] = typeof initial === 'function' ? initial() : initial
    return [state[i], (value) => { state[i] = typeof value === 'function' ? value(state[i]) : value }]
  }
  const hookDeps = { useState, useCallback: (fn) => fn, useMemo: (fn) => fn() }
  const usePendingEdits = new Function(
    ...Object.keys(hookDeps), hookCode + '\nreturn usePendingEdits',
  )(...Object.values(hookDeps))

  const mocks = {
    React: { createElement: (type, p, ...children) => ({ type, props: { ...p, children } }) },
    useState,
    useMemo: (fn) => fn(),
    useEffect: () => {},
    usePendingEdits,
    supabase: { from: (table) => { tables.push(table); return query } },
    run: async () => { if (failure) throw Error(failure); return {} },
    useEmployees: () => ({ employees, loading: false, reload: () => { reloads++ } }),
    setTemporaryPassword: async () => {},
    generateTemporaryPassword: () => 'x'.repeat(12),
  }
  for (const n of ['SaveBar', 'Alert', 'Badge', 'Button', 'Card', 'CardHeader',
                   'Field', 'Input', 'Select', 'Td', 'Th']) mocks[n] = n

  const { code, name } = CARDS[cardName]
  const Card = new Function(...Object.keys(mocks), code + `\nreturn ${name}`)(...Object.values(mocks))

  function nodes(tree) {
    if (!tree || typeof tree !== 'object') return []
    if (Array.isArray(tree)) return tree.flatMap(nodes)
    return [tree, ...nodes(tree.props?.children ?? null)]
  }
  const render = () => { cursor = 0; return Card(props) }
  const find = (type, predicate = () => true) =>
    nodes(render()).find((n) => n.type === type && predicate(n.props))
  const all = (type, predicate = () => true) =>
    nodes(render()).filter((n) => n.type === type && predicate(n.props))
  const bar = () => find('SaveBar', (p) => typeof p.onSave === 'function')
  return { writes, tables, find, all, bar, render, nodes,
    reloads: () => reloads, fail: (m) => { failure = m } }
}

// --- Bus routes -------------------------------------------------------

const routes = [
  { id: 1, name: 'None', sort_order: 1 },
  { id: 2, name: 'Maadi', sort_order: 2 },
  { id: 3, name: 'Giza', sort_order: 3 },
]
const busProps = { lookups: { busRoutes: routes, reload: () => {} }, readOnly: false }

test('bus routes: renaming writes nothing until Save', async () => {
  const h = setup('BusRoutesCard', { props: busProps })
  const box = h.all('Input').find((n) => n.props.value === 'Maadi')
  box.props.onChange({ target: { value: 'Maadi North' } })
  assert.deepEqual(h.writes, [])
  assert.equal(h.bar().props.count, 1)

  await h.bar().props.onSave()
  assert.deepEqual(h.writes, [
    { op: 'update', values: { name: 'Maadi North' }, filter: ['id', 2] },
  ])
  assert.ok(h.tables.includes('bus_routes'))
})

test('bus routes: a rename that would duplicate another name is refused', async () => {
  const h = setup('BusRoutesCard', { props: busProps })
  h.all('Input').find((n) => n.props.value === 'Maadi')
    .props.onChange({ target: { value: ' giza ' } })
  await h.bar().props.onSave()
  assert.deepEqual(h.writes, [], 'nothing written')
  assert.ok(h.find('Alert', (p) => p.tone === 'error'))
})

test('bus routes: a name cannot be emptied', async () => {
  const h = setup('BusRoutesCard', { props: busProps })
  h.all('Input').find((n) => n.props.value === 'Maadi')
    .props.onChange({ target: { value: '   ' } })
  await h.bar().props.onSave()
  assert.deepEqual(h.writes, [])
})

test('bus routes: None has no editable box, so it cannot be renamed', () => {
  const h = setup('BusRoutesCard', { props: busProps })
  assert.equal(h.all('Input').some((n) => n.props.value === 'None'), false)
})

test('bus routes: read-only gets no save bar', () => {
  const h = setup('BusRoutesCard', { props: { ...busProps, readOnly: true } })
  assert.equal(h.bar(), undefined)
})

// --- Departments ------------------------------------------------------

const deptProps = {
  lookups: {
    sectors: [{ id: 1, name: 'Operations' }, { id: 2, name: 'Finance' }],
    departments: [
      { id: 10, name: 'Production', sector_id: 1 },
      { id: 11, name: 'Accounting', sector_id: 2 },
    ],
    reload: () => {},
  },
  readOnly: false,
}

test('departments: a rename and a sector move are staged, then saved together', async () => {
  const h = setup('DepartmentsCard', { props: deptProps })
  h.all('Input').find((n) => n.props.value === 'Production')
    .props.onChange({ target: { value: 'Production Line' } })
  h.all('Select').find((n) => n.props.value === 1)
    .props.onChange({ target: { value: '2' } })
  assert.deepEqual(h.writes, [])
  assert.equal(h.bar().props.count, 1, 'both changes are one row')

  await h.bar().props.onSave()
  assert.deepEqual(h.writes, [
    { op: 'update', values: { name: 'Production Line', sector_id: 2 }, filter: ['id', 10] },
  ])
})

test('departments: a sector rename is staged separately from its departments', async () => {
  const h = setup('DepartmentsCard', { props: deptProps })
  h.all('Input').find((n) => n.props.value === 'Operations')
    .props.onChange({ target: { value: 'Ops' } })
  assert.equal(h.bar().props.count, 1)
  await h.bar().props.onSave()
  assert.deepEqual(h.writes, [{ op: 'update', values: { name: 'Ops' }, filter: ['id', 1] }])
  assert.ok(h.tables.includes('sectors'))
})

test('departments: Discard clears both buffers', () => {
  const h = setup('DepartmentsCard', { props: deptProps })
  h.all('Input').find((n) => n.props.value === 'Operations')
    .props.onChange({ target: { value: 'Ops' } })
  h.all('Input').find((n) => n.props.value === 'Production')
    .props.onChange({ target: { value: 'Line' } })
  assert.equal(h.bar().props.count, 2)
  h.bar().props.onDiscard()
  assert.equal(h.bar().props.count, 0)
  assert.deepEqual(h.writes, [])
})

// --- Access -----------------------------------------------------------

const staff = [
  { id: 'a', code: 240001, name: 'Ahmed', role: 'user', email: 'a@x.com', auth_user_id: 'u1' },
  { id: 'b', code: 240005, name: 'Doaa', role: 'no_access', email: null, auth_user_id: null },
]

test('access: changing a role writes nothing until Save', async () => {
  const h = setup('AccessCard', { props: { readOnly: false }, employees: staff })
  h.all('Select').find((n) => n.props.value === 'user')
    .props.onChange({ target: { value: 'no_access' } })
  assert.deepEqual(h.writes, [])
  assert.equal(h.bar().props.count, 1)

  await h.bar().props.onSave()
  assert.deepEqual(h.writes, [
    { op: 'update', values: { role: 'no_access' }, filter: ['id', 'a'] },
  ])
})

test('access: granting admin asks once, and nothing is written if refused', async () => {
  const h = setup('AccessCard', { props: { readOnly: false }, employees: staff })
  const asked = []
  globalThis.window = { confirm: (message) => { asked.push(message); return false } }
  try {
    h.all('Select').find((n) => n.props.value === 'user')
      .props.onChange({ target: { value: 'admin' } })
    h.all('Select').find((n) => n.props.value === 'no_access')
      .props.onChange({ target: { value: 'admin' } })
    await h.bar().props.onSave()
    assert.equal(asked.length, 1, 'one dialog for both grants, not two')
    assert.match(asked[0], /Ahmed/)
    assert.match(asked[0], /Doaa/)
    assert.deepEqual(h.writes, [], 'refusing writes nothing')
  } finally {
    delete globalThis.window
  }
})

test('access: a demotion needs no confirmation', async () => {
  const h = setup('AccessCard', {
    props: { readOnly: false },
    employees: [{ ...staff[0], role: 'admin' }],
  })
  globalThis.window = { confirm: () => { throw new Error('should not be asked') } }
  try {
    h.all('Select').find((n) => n.props.value === 'admin')
      .props.onChange({ target: { value: 'user' } })
    await h.bar().props.onSave()
    assert.deepEqual(h.writes, [{ op: 'update', values: { role: 'user' }, filter: ['id', 'a'] }])
  } finally {
    delete globalThis.window
  }
})

test('access: read-only gets no save bar', () => {
  const h = setup('AccessCard', { props: { readOnly: true }, employees: staff })
  assert.equal(h.bar(), undefined)
})
