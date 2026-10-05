/**
 * Structural checks for a migration file. Not a SQL parser: it catches the
 * mistakes that are easy to make by hand and invisible until the editor
 * rejects the whole batch.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const file = process.argv[2]
const sql = readFileSync(resolve(file), 'utf8')

const problems = []
const notes = []

// Dollar-quoted bodies must pair up, or every later statement is swallowed.
// Both spellings count: a plain $$ ... $$ and a named one such as
// $body$ ... $body$, which is how PL/pgSQL function bodies are written.
//
// Comments are stripped first. They are full of prose about dollar quoting, and
// counting a delimiter that a comment merely mentions reports a file that is
// perfectly fine as unbalanced.
const withoutComments = sql
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/--[^\n]*/g, ' ')

const stack = []
for (const m of withoutComments.matchAll(/\$(\$|[A-Za-z_]\w*\$)/g)) {
  const tag = m[1]
  if (stack.length === 0) {
    stack.push(tag)
  } else if (stack[stack.length - 1] === tag) {
    stack.pop()
  } else {
    problems.push(`dollar-quote mismatch: ${tag} opened while ${stack[stack.length - 1]} was open`)
    stack.length = 0
  }
}
if (stack.length > 0) {
  problems.push(`unclosed dollar-quote: ${stack[stack.length - 1]}`)
}

// The one that bit us: partial constraints are invalid inside CREATE TABLE.
const inlinePartial = sql.matchAll(/^\s*(unique|primary key)\s*\([^)]*\)\s*where\s+/gim)
for (const m of inlinePartial) {
  problems.push(`inline partial constraint is not valid SQL: "${m[0].trim()}"`)
}

// ...but a partial INDEX is exactly how that intent should be expressed.
for (const m of sql.matchAll(/create unique index if not exists (\w+)/gi)) {
  notes.push(`partial/unique index: ${m[1]}`)
}

// Every function must pin search_path. A SECURITY DEFINER function without it
// resolves unqualified names through whatever the caller controls first.
const fnNames = [...sql.matchAll(/create or replace function public\.(\w+)/gi)].map((m) => m[1])
for (const name of fnNames) {
  const body = sql.slice(sql.toLowerCase().indexOf(`function public.${name.toLowerCase()}`))
  const next = body.search(/\$\$/)
  const chunk = next === -1 ? body.slice(0, 400) : body.slice(0, next + 2)
  if (!/set search_path/i.test(chunk)) {
    problems.push(`function ${name}() does not pin search_path`)
  }
}

// SECURITY DEFINER functions that call other schema objects by bare name.
for (const m of sql.matchAll(/security definer/g)) {
  const before = sql.slice(Math.max(0, m.index - 300), m.index)
  const name = before.match(/function public\.(\w+)\s*\(\s*\)[^)]*$/i)?.[1]
  if (name) notes.push(`security definer: ${name}()`)
}

// RLS must be enabled per table, and the count of `enable row level security`
// should match the number of tables created.
const created = [...sql.matchAll(/create table if not exists public\.(\w+)/gi)].map((m) => m[1])
const enabled = [...sql.matchAll(/enable row level security/gi)].length
notes.push(`tables created: ${created.length} (${created.join(', ')})`)
notes.push(`rls enabled: ${enabled}`)
if (enabled < created.length) {
  problems.push(`${created.length} tables created but only ${enabled} enable RLS`)
}

// A table with no policy at all is unreachable rather than open, which is safe
// but usually a mistake worth surfacing.
//
// The exception is a table that is meant to be server-only: reached exclusively
// through a SECURITY DEFINER function, with its table privileges revoked from
// the client roles. Listing it here keeps the check strict everywhere else.
const SERVER_ONLY = new Set([
  // Allocation reads it under an advisory lock. Granting reads would let a client
  // enumerate how many riders each week has.
  'weekly_number_ledger'
])

const policies = [...sql.matchAll(/create policy (\w+)\s+on public\.(\w+)/gi)]
for (const t of created) {
  const n = policies.filter((p) => p[2].toLowerCase() === t).length
  notes.push(`policies on ${t}: ${n}`)
  if (n === 0 && !SERVER_ONLY.has(t.toLowerCase())) {
    problems.push(`${t} has no policies, so it is unreachable for clients`)
  }
  if (SERVER_ONLY.has(t.toLowerCase()) && n > 0) {
    problems.push(`${t} is server-only but has client policies; revoke them instead`)
  }
}

// A server-only table that is not revoked is still readable through the
// Data API, because RLS with no policy denies but the default table grant allows
// SELECT. The policies being absent is not what protects it.
for (const t of created) {
  if (!SERVER_ONLY.has(t.toLowerCase())) continue
  const revoked = new RegExp(`revoke\\s+all\\s+on\\s+public\\.${t}\\s+from`, 'i').test(sql)
  notes.push(`${t} is server-only`)
  if (!revoked) problems.push(`${t} is server-only but its grants are not revoked`)
}

// Guards must compare old and new. A guard missing `is distinct from` would fire
// on every update rather than only on the change it is meant to catch.
for (const m of sql.matchAll(/create or replace function public\.(guard_\w+)/gi)) {
  const start = sql.indexOf(`function public.${m[1]}`)
  const chunk = sql.slice(start, start + 900)
  if (!/is distinct from/.test(chunk)) {
    problems.push(`${m[1]}() never compares old and new values`)
  }
  if (!/current_user in/.test(chunk)) {
    problems.push(`${m[1]}() has no superuser bypass, so manual admin via SQL editor will fail`)
  }
  if (!/public\.is_admin\(\)/.test(chunk)) {
    problems.push(`${m[1]}() does not consult is_admin()`)
  }
}

console.log(`checked ${file}\n`)
for (const n of notes) console.log(`  note: ${n}`)
console.log('')
if (problems.length === 0) {
  console.log('no structural problems found')
} else {
  console.log(`${problems.length} problem(s):`)
  for (const p of problems) console.log(`  - ${p}`)
  process.exitCode = 1
}