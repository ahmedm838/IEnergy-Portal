import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildDatabaseScript, PAGE_SIZE } from '../src/lib/exportDatabase.js'

/*
 * The full-database export: the database writes the SQL, this only asks
 * for it in order. What matters here is that every page of every table
 * is fetched -- a silent cut would make a backup that looks complete and
 * is not -- and that the sections land in restore order.
 */

function fakeRpc(tables) {
  const calls = []
  const rpc = async (name, args = {}) => {
    calls.push({ name, args })
    if (name === 'export_database_schema') {
      return { pre: '-- PRE', objects: '-- OBJECTS', post: '-- POST', object_count: 1, post_count: 1, exported_at: 'now', postgres: '17' }
    }
    if (name === 'export_database_tables') {
      return tables.map(([s, t]) => ({ table_schema: s, table_name: t }))
    }
    if (name === 'export_table_data') {
      const total = tables.find(([s, t]) => s === args.p_schema && t === args.p_table)[2]
      const rows = Math.max(0, Math.min(args.p_limit, total - args.p_offset))
      return rows ? { sql: `-- DATA ${args.p_table} @${args.p_offset}`, rows } : null
    }
    throw new Error(`unexpected rpc ${name}`)
  }
  return { rpc, calls }
}

test('fetches every page of every table and counts the rows', async () => {
  const big = PAGE_SIZE * 2 + 5
  const { rpc, calls } = fakeRpc([['auth', 'users', 3], ['public', 'si_codes', big], ['public', 'empty', 0], ['public', 'exact', PAGE_SIZE]])
  const { sql, tables, rows } = await buildDatabaseScript(rpc)
  assert.equal(tables, 4)
  assert.equal(rows, 3 + big + PAGE_SIZE)
  const pages = calls.filter((c) => c.name === 'export_table_data' && c.args.p_table === 'si_codes')
  assert.deepEqual(pages.map((c) => c.args.p_offset), [0, PAGE_SIZE, PAGE_SIZE * 2])
  // A full last page has to ask once more to learn it was the last.
  assert.equal(calls.filter((c) => c.args.p_table === 'exact').length, 2)
  assert.match(sql, /-- public.si_codes: 4005 rows/)
  assert.match(sql, /-- public.empty: 0 rows/)
})

test('sections come out in restore order', async () => {
  const { rpc } = fakeRpc([['public', 'sites', 1]])
  const { sql } = await buildDatabaseScript(rpc)
  const at = (s) => sql.indexOf(s)
  assert.ok(at('set check_function_bodies = false') < at('-- PRE'))
  assert.ok(at('-- PRE') < at('-- OBJECTS'))
  assert.ok(at('-- OBJECTS') < at('-- DATA sites'))
  assert.ok(at('-- DATA sites') < at('-- POST'))
})

test('a failed call stops the export instead of writing a partial file', async () => {
  const rpc = async (name) => {
    if (name === 'export_database_schema') throw new Error('Only a super admin can export the database.')
  }
  await assert.rejects(buildDatabaseScript(rpc), /super admin/)
})
