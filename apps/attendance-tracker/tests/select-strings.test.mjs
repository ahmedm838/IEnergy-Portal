import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { test } from 'node:test'

/*
 * No comments inside a PostgREST select string.
 *
 * A select list is sent to the server verbatim as a query parameter. It
 * is a string, not code, so a comment written inside one is not stripped
 * by the bundler or by anything else -- it goes down the wire and the
 * server rejects the whole parameter:
 *
 *   failed to parse select parameter (...,sites(id,name),
 *   /*Thesectorridesalong...*\/departments(id,name)...)
 *
 * This happened. One comment inside the employees select emptied every
 * employee picker in the app at once -- the Attendance page, the
 * Employee report and the Employees page all stopped working together,
 * because all three read that one list. The build was clean and the
 * tests passed; nothing catches it but this.
 *
 * Whitespace and newlines are fine -- supabase-js strips those. It is
 * only comment markers that survive.
 */

function sourceFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const path = `${dir}/${entry}`
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path))
    else if (/\.jsx?$/.test(entry)) out.push(path)
  }
  return out
}

/* Every `.select(\`...\`)` argument in the app, as written. Only
   backtick arguments are examined: a single-line quoted select cannot
   hold a comment without ending the string. */
function selectStrings(source) {
  return [...source.matchAll(/\.select\(\s*`([^`]*)`/g)].map((m) => m[1])
}

const files = sourceFiles(new URL('../src', import.meta.url).pathname.replace(/^\//, ''))

test('every select list is free of comment markers', () => {
  let checked = 0
  for (const file of files) {
    for (const select of selectStrings(readFileSync(file, 'utf8'))) {
      checked += 1
      const found = /\/\*|\*\/|\/\//.exec(select)
      assert.equal(
        found,
        null,
        `${file}: a comment inside a select list is sent to the server and rejects the query.\n` +
          `  near: ${select.slice(Math.max(0, (found?.index ?? 0) - 40), (found?.index ?? 0) + 60).trim()}`,
      )
    }
  }
  // If this ever reads zero, the pattern above has stopped matching and
  // the test is passing by finding nothing rather than by finding
  // nothing wrong.
  assert.ok(checked > 0, 'found select lists to check')
})

test('the employees select still asks for what the pages read', () => {
  const source = readFileSync(
    new URL('../src/lib/useLookups.js', import.meta.url).pathname.replace(/^\//, ''),
    'utf8',
  )
  const [employees] = selectStrings(source).filter((s) => s.includes('arabic_name'))
  assert.ok(employees, 'found the employees select')

  // The report's heading reads title, level, department, sector, site.
  for (const part of ['level_id', 'employee_levels', 'sectors', 'departments', 'sites']) {
    assert.ok(employees.includes(part), `the employees select asks for ${part}`)
  }
})
