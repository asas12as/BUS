/**
 * The Supabase client, created once.
 *
 * Deliberately not typed with a generated Database generic. The generated type
 * would cover every table in the project, and PostgREST's inference over a
 * supabase-js generic is expensive enough at the type level to be noticeable in
 * a project this size. The row shapes the app actually reads are declared by
 * hand in src/lib/rows.ts, which keeps the surface honest.
 *
 * Row-level security is the only thing protecting the publishable key's power.
 * See supabase/migrations/0001_initial_schema.sql.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Why the app cannot reach the database at all.
 *
 * Distinct from a failed request, which throws: a missing key means the build
 * never had credentials, and every query would fail in a way that looks like a
 * network problem. Surfacing it as a build-time configuration error keeps the
 * diagnosis obvious.
 */
export class SupabaseNotConfigured extends Error {
  constructor(missing: readonly string[]) {
    super(
      `Supabase is not configured: ${missing.join(', ')} missing. ` +
        'Copy .env.example to .env.local and fill in the VITE_ values.'
    )
    this.name = 'SupabaseNotConfigured'
  }
}

function required(name: 'VITE_SUPABASE_URL' | 'VITE_SUPABASE_PUBLISHABLE_KEY'): string {
  const value = import.meta.env[name]
  if (!value) throw new SupabaseNotConfigured([name])
  return value
}

let cached: SupabaseClient | null = null

/**
 * The shared client.
 *
 * Not built at module scope, so that merely importing this file in a test or in
 * a tool without credentials does not throw. The failure happens on first use,
 * where there is a screen to show it.
 */
export function supabase(): SupabaseClient {
  if (cached) return cached
  const url = required('VITE_SUPABASE_URL')
  const key = required('VITE_SUPABASE_PUBLISHABLE_KEY')

  cached = createClient(url, key, {
    auth: {
      // The session has to outlive a reload: a rider opening the app on the
      // bus is not going to type a password again every time.
      persistSession: true,
      autoRefreshToken: true,
      // Supabase probes the session in another tab. Without this the app can
      // hold a session that the server has already revoked.
      detectSessionInUrl: false
    },
    global: {
      headers: { 'x-application-name': 'nvu-bus-web' }
    }
  })

  return cached
}

/**
 * True when the build has credentials.
 *
 * Lets the UI show an honest message instead of a failed spinner, and lets
 * tests skip against a real database.
 */
export function supabaseConfigured(): boolean {
  return Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY)
}

/**
 * True when a network call can plausibly succeed.
 *
 * `navigator.onLine` is only a hint -- it reports a link, not reachability --
 * but it is the cheapest check available synchronously, and it is right in the
 * cases that matter here: being on the bus with no signal.
 */
export function networkAvailable(): boolean {
  if (typeof navigator === 'undefined') return true
  return navigator.onLine !== false
}

/**
 * Narrows a Supabase failure to a message worth showing a rider.
 *
 * PostgREST and GoTrue both put a human-readable line in `message`, and both
 * sometimes add a trailing period. Anything unrecognised falls back to a generic
 * string rather than leaking a raw driver message into the UI.
 */
export function describeError(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message: unknown }).message
    if (typeof message === 'string' && message.trim()) {
      return message.trim().replace(/\.$/, '')
    }
  }
  if (error instanceof Error && error.message) return error.message.replace(/\.$/, '')
  return 'Something went wrong'
}