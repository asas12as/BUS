/**
 * Finds the correct Supabase pooler region for this project by attempting a
 * real connection to each candidate. Needed because the project URL does not
 * encode a region, and every pooler hostname resolves, so DNS cannot tell us.
 *
 * Prints only the region name and outcome. Credentials are never echoed, and
 * the winning URL is written to a file outside the repo rather than to stdout.
 *
 * Usage: node scripts/probe-db-region.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

function loadEnv() {
  const merged = { ...process.env }
  // Only .env.local, which is gitignored. An earlier version also read
  // .env.local.txt; that file was a duplicate holding the same secrets and has
  // been removed, so nothing should keep it alive.
  const path = join(root, '.env.local')
  if (existsSync(path)) {
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
      if (!m) continue
      merged[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
    }
  }
  return merged
}

const env = loadEnv()
const password = env.DB_PASSWORD
const ref = env.VITE_SUPABASE_URL?.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1]

if (!password || !ref) {
  console.error('Need DB_PASSWORD and VITE_SUPABASE_URL.')
  process.exit(1)
}

const regions = ['eu-west-1', 'eu-central-1', 'us-east-1', 'us-west-1', 'ap-south-1']

function attempt(region) {
  const url =
    `postgresql://postgres.${ref}:${encodeURIComponent(password)}` +
    `@aws-0-${region}.pooler.supabase.com:5432/postgres`

  return new Promise((resolveAttempt) => {
    // shell: true is required on this machine. Spawning .cmd directly fails
    // with EINVAL, the same launcher fault that made check-pass.mjs unusable.
    const child = spawn(
      'npx.cmd --yes supabase@latest db push --db-url "' + url + '" --include-all --dry-run',
      { cwd: root, shell: true, windowsHide: true }
    )

    let out = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (out += d))
    child.on('close', () => {
      // A dry run that reaches the migration list has connected. Any of these
      // means the host/user/password combination is wrong.
      const bad = /ENOTFOUND|FATAL|password authentication|tenant\/user|does not exist/i.test(out)
      const good = !bad && /Connecting to remote database|Migrating|database files|supabase db push/i.test(out)
      resolveAttempt({ region, ok: good, url, detail: out.trim().split('\n').slice(-1)[0] ?? '' })
    })
    child.on('error', () => resolveAttempt({ region, ok: false, url, detail: 'spawn failed' }))
  })
}

let winner = null
for (const region of regions) {
  const r = await attempt(region)
  console.log(`  ${r.region.padEnd(14)} ${r.ok ? 'CONNECTED' : 'no'}`)
  if (r.ok) {
    winner = r
    break
  }
}

if (!winner) {
  console.error('\nNo region accepted the credentials. Check DB_PASSWORD in Project Settings -> Database.')
  process.exit(1)
}

const target = join(process.env.TEMP, 'opencode', 'dburl.txt')
writeFileSync(target, winner.url, 'utf8')
console.log(`\nconnected via ${winner.region}; connection string staged outside the repo`)