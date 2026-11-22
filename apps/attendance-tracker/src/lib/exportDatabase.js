/**
 * The whole database as one restorable .sql script.
 *
 * The database does the hard part: export_database_schema() reads the
 * system catalogs (tables, functions, views, triggers, RLS, policies,
 * grants) and export_table_data() hands back each table a page at a
 * time as an INSERT. Both are super-admin only and refuse anyone else.
 * This file only asks for the pieces in order and joins them up.
 *
 * `rpc(name, args)` is passed in rather than imported so the same code
 * runs in the test against a local database.
 */

export const PAGE_SIZE = 2000

const line = '-- ' + '='.repeat(70)

function header({ exportedAt, postgres, tables, totalRows }) {
  return [
    line,
    '-- iEnergy portal: full database export',
    `-- Exported: ${exportedAt}`,
    `-- Source Postgres: ${postgres}`,
    `-- Tables: ${tables.length}, rows: ${totalRows}`,
    '--',
    '-- WHAT IS IN HERE',
    '--   Every table in the public schema with all its rows, the columns,',
    '--   defaults, keys and checks, every function, view and trigger, row',
    '--   level security, every policy, the API grants, comments, sequence',
    '--   positions, and the sign-ins (auth.users / auth.identities, with',
    '--   password hashes, so people keep their passwords).',
    '--',
    '-- WHAT IS NOT',
    '--   Personnel files (they live on the cPanel host), Edge Function code',
    '--   (it is in the repo under supabase/functions) and Edge Function',
    '--   secrets, which nobody can read back -- set those again by hand.',
    '--',
    '-- HOW TO RESTORE into a NEW, EMPTY Supabase project',
    '--   1. Create the project. Copy its connection string from',
    '--      Project Settings -> Database (the "Session pooler" one).',
    '--   2. Run:',
    '--        psql "<connection string>" -v ON_ERROR_STOP=1 \\',
    '--             --single-transaction -f this-file.sql',
    '--      (The SQL editor in the dashboard also works for a small file.)',
    '--   3. Point the app at the new project: VITE_SUPABASE_URL and',
    '--      VITE_SUPABASE_ANON_KEY in the GitHub secrets, then redeploy.',
    '--   Warnings marked "Not restored" are listed at the end of each',
    '--   section; anything else means it went in as it was.',
    '--',
    '-- This file holds national IDs, salaries and password hashes. Keep it',
    '-- somewhere only you can open.',
    line,
    '',
    'set check_function_bodies = false;',
    "set client_min_messages = warning;",
    'set search_path = public, extensions;',
    '',
  ].join('\n')
}

function section(title) {
  return `\n${line}\n-- ${title}\n${line}\n`
}

/**
 * @param {(name: string, args?: object) => Promise<any>} rpc
 * @param {(message: string) => void} [onProgress]
 * @returns {Promise<{ sql: string, tables: number, rows: number }>}
 */
export async function buildDatabaseScript(rpc, onProgress = () => {}) {
  onProgress('Reading the structure…')
  const schema = await rpc('export_database_schema')
  const tables = (await rpc('export_database_tables')) ?? []

  const data = []
  let totalRows = 0
  for (const [index, t] of tables.entries()) {
    const label = `${t.table_schema}.${t.table_name}`
    onProgress(`Copying ${label} (${index + 1} of ${tables.length})…`)
    let rows = 0
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const page = await rpc('export_table_data', {
        p_schema: t.table_schema,
        p_table: t.table_name,
        p_offset: offset,
        p_limit: PAGE_SIZE,
      })
      if (!page?.sql) break
      data.push(page.sql)
      rows += page.rows
      // A short page is the last one; a full one may or may not be.
      if (page.rows < PAGE_SIZE) break
    }
    totalRows += rows
    data.push(`-- ${label}: ${rows} row${rows === 1 ? '' : 's'}`)
  }

  const sql = [
    header({
      exportedAt: schema.exported_at,
      postgres: schema.postgres,
      tables,
      totalRows,
    }),
    section('1. Extensions and types'),
    schema.pre,
    section(`2. Tables, keys, functions and views (${schema.object_count} statements)`),
    schema.objects,
    section('3. Data (no triggers or foreign keys yet, so nothing fires on the way in)'),
    data.join('\n\n'),
    section(`4. Foreign keys, indexes, triggers, RLS, policies, grants (${schema.post_count} statements)`),
    schema.post,
    '',
    "notify pgrst, 'reload schema';",
    '',
  ].join('\n')

  return { sql, tables: tables.length, rows: totalRows }
}

/** Hand a text file to the browser as a download. */
export function downloadText(text, filename) {
  const blob = new Blob([text], { type: 'application/sql;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
