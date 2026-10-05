# NVU Bus

Weekly bus subscriptions for riders and the people who run the routes: a rider
signs up, subscribes to the week, gets a pass with a weekly number, and a driver
scans that number to confirm it.

The rider's phone number and a route assignment both live on the pass, and the
weekly number is the identity a driver checks at the door, so the rules about who
may see and change what are the substance of this codebase rather than an
afterthought.

## Stack

- React + TypeScript + Vite
- Supabase: Postgres, Auth, and row-level security. No server of our own.
- Oxlint for linting, Vitest for tests

## Local setup

```bash
npm install
cp .env.example .env.local    # then fill it in
npm run dev
```

`npm run verify` is the gate: lint, test typecheck, tests, then a production
build. It should be clean before anything is committed.

## Environment

`.env.example` documents every variable. Two of them end up in the browser
bundle, and only those two:

| Variable | Where it goes |
| --- | --- |
| `VITE_SUPABASE_URL` | browser |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | browser |
| `SUPABASE_ADMIN_KEY` | scripts only, bypasses RLS |
| `DB_PASSWORD` | scripts only, postgres superuser |

Vite inlines `VITE_*` at build time, so a build with no `.env.local` produces an
app pointed at a blank URL and every screen reads as signed out.

## Database

Migrations are plain SQL in `supabase/migrations/`, applied in filename order.
Supabase exposes no route for running DDL over HTTP, so they are applied with a
direct connection:

```bash
npx supabase db query --db-url "postgresql://..." --file supabase/migrations/0001_initial_schema.sql
```

Two constraints worth knowing before writing one:

- **The CLI takes one statement per invocation.** A file with two functions fails
  with `cannot insert multiple commands into a prepared statement`. Split it, or
  send it through a client that does not use the extended protocol.
- **`scripts/check-migration.mjs` is not a SQL parser**, but it catches the
  mistakes that are easy to make by hand: an unpaired `$$`, a function that does
  not pin `search_path`, a table created without RLS, a `SECURITY DEFINER` that
  reaches for a bare schema name.

```bash
node scripts/check-migration.mjs supabase/migrations/0001_initial_schema.sql
```

A `SECURITY DEFINER` function needs `set search_path = public` and must qualify
anything outside it. Supabase installs `pgcrypto` into `extensions`, not
`public`, so those calls are written `extensions.crypt(...)`. Migration 0003
exists because getting that wrong applied cleanly and then failed on first use:
PL/pgSQL bodies are not resolved until they run.

### First admin

There is no way to become an admin from the app, by design. Sign up, then run
this in the Supabase SQL editor:

```sql
update public.profiles set role = 'admin' where id = (
  select id from auth.users where email = 'you@example.com'
);
```

This has to be the SQL editor. A profile update over the Data API is refused by
the `guard_role_change` trigger, service role included, so that a compromised
admin token cannot mint another one.

## Deploying to GitHub Pages

Every push to `main` publishes. The build step needs two repository **variables**
(set under Settings → Secrets and codespaces → Actions), because the runner has
no `.env.local`:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

The admin key and database password are deliberately not passed to the workflow.
Nothing in `src/` needs them.

## What offline means here

Offline is read-only. The app writes a snapshot of what the server returned to
`localStorage`, keyed per user, and shows it with a "stale" marker when the
browser reports no network. There is no write-behind and no queue, because a
queued write would have to invent an answer about whether it succeeded.

Scanning is not available offline. Confirming a pass means asking the server
whether the number is currently valid, and a cached answer is exactly the answer
that must not be trusted.

`projectbus.data.v1` is left untouched by every version since the cutover. It is
the pre-Supabase shape and nothing reads it; it stays only so old installs are not
mangled.

## Weekly numbers

A number is assigned once and retired forever. `weekly_number_ledger` is
server-only — its table privileges are revoked from the client roles rather than
relying on RLS alone — and `allocate_weekly_number` reads it under an advisory
lock. Cancelling a week, or deleting it outright, burns the number: the next
subscriber in that week gets the next one, never the one that was just freed.