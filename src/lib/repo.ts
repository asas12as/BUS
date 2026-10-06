/**
 * The app's view of the database.
 *
 * Every read and write the app performs goes through this module, so there is
 * exactly one place that knows about Postgres, and one place to look when a
 * query behaves unexpectedly. Components and context never call supabase()
 * directly.
 *
 * Two rules hold throughout:
 *
 * 1. The server is the source of truth. Nothing here trusts a number, a status
 *    or a role computed in the browser; those come back from Postgres.
 * 2. Nothing is queued. There is no write-behind, no retry and no conflict
 *    resolution, because the rule is that offline means read-only. A failed
 *    write is reported, not remembered.
 */
import type { Lang, PickupPlace, PlaceRequest, SubStatus, User, WeekSubscription } from './types'
import { normalizeDays } from './date'
import { normalizePhone } from './phone'
import { supabase, describeError, SupabaseNotConfigured } from './supabase'
import {
  asLang,
  daysToRecord,
  type DayEntryRow,
  type PlaceRequestRow,
  type PlaceRow,
  type ProfileRow,
  type ScanResultRow,
  type WeekSubscriptionRow
} from './rows'
import {
  pickupColumns,
  profilePatch,
  toDayEntry,
  toPlace,
  toPlaceRequest,
  toScanResolution,
  toUser,
  toWeekSubscription,
  type MeProfile,
  type ScanResolution,
  type UserWithPhone
} from './mappers'
import type { DayEntry } from './types'

/**
 * A repository call that failed.
 *
 * Carries the underlying driver error so a caller can inspect `code`, which is
 * the reliable way to tell an RLS refusal (42501) from a missing row (PGRST116)
 * from a network drop. The message alone is not enough: GoTrue and PostgREST
 * both write prose that overlaps.
 */
export class RepoError extends Error {
  readonly code: string | null

  constructor(message: string, code: string | null = null) {
    super(message)
    this.name = 'RepoError'
    this.code = code
  }

  /** True when the failure looks like no network rather than a refusal. */
  get isOffline(): boolean {
    return this.code === null && /fetch|network|failed to fetch|load failed/i.test(this.message)
  }
}

/** Pulls Postgres's SQLSTATE or PostgREST code out of a driver error. */
function codeOf(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null
  const candidate = error as { code?: unknown; message?: unknown }
  if (typeof candidate.code === 'string') return candidate.code
  const message = typeof candidate.message === 'string' ? candidate.message : ''
  const match = /\b([0-9A-Z]{5})\b/.exec(message)
  return match ? match[1] : null
}

function fail(error: unknown): never {
  if (error instanceof SupabaseNotConfigured) throw new RepoError(error.message)
  throw new RepoError(describeError(error), codeOf(error))
}

/* --------------------------------- profile -------------------------------- */

/**
 * The signed-in rider's own profile.
 *
 * Read on every sign-in rather than trusted from the signup response: the
 * trigger that creates the row runs as `postgres`, so a signup that raced the
 * trigger would otherwise leave the app holding a session with no profile, and
 * every later read would be filtered against a user_id that is not there.
 *
 * The email is passed in from the auth session rather than joined. `auth.users`
 * is not exposed through PostgREST to a client, so a select that tried to embed
 * it would fail; the session already carries the address, and it is
 * authoritative for it.
 *
 * Phone needs no such treatment: migration 0002 added it as a column, so it is
 * read from the row and survives a reload. A passed phone still wins, because the
 * session copy is the one the rider signed up with.
 */
export async function fetchOwnProfile(userId: string, email?: string, phone?: string): Promise<MeProfile | null> {
  const { data, error } = await supabase()
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle()
  if (error) fail(error)
  if (!data) return null
  const row = data as ProfileRow
  // The stored address wins over the session's. The session carries the account's
  // GoTrue address, which is derived from the phone number and reads as
  // `p201001234567@phone.invalid`; showing that to a rider would be worse than
  // showing nothing. The session value is only a fallback for a profile row
  // written before the column existed.
  return { user: toUser({ ...row, email: row.email ?? email ?? null }, phone), lang: asLang(row.lang) }
}

/**
 * One rider by id, for the scanner's lookup.
 *
 * Renders null for anyone but the caller and for admins, so this cannot be used
 * to enumerate riders; that comes from fetchAllProfiles, which the admin policy
 * does allow.
 */
export async function fetchProfileById(userId: string): Promise<UserWithPhone | null> {
  const { data, error } = await supabase()
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle()
  if (error) fail(error)
  if (!data) return null
  // No email: a client cannot read auth.users, and the scanner screen shows the
  // rider's name, which is on this row.
  return toUser({ ...(data as ProfileRow), email: null })
}

/**
 * Updates the signed-in rider's own profile.
 *
 * Only the fields this table owns are accepted. `role` is not among them: the
 * database refuses a non-admin anyway, but omitting it means the client never
 * offers an action that cannot succeed. Neither is `email`, which lives in
 * auth.users and is not writable from a client.
 *
 * `pickupLocation` resolves to the id when the name matches a live place, so a
 * rider who types a curated name gets a real link rather than free text that
 * would not survive a rename.
 */
export async function updateOwnProfile(
  userId: string,
  patch: Partial<Pick<User, 'name' | 'avatar' | 'phone' | 'pickupLocation'>> & { lang?: Lang }
): Promise<void> {
  const body = profilePatch(patch)
  if (body.name !== undefined) body.name = String(body.name).trim()
  if (body.phone !== undefined) {
    // Normalised, not just trimmed. The unique index is built on the normalised
    // value, so a raw spelling would still be caught as a duplicate, but the
    // column would then hold two different strings for one number and the rider
    // would see their own number change shape depending on where they edited it.
    const normalized = normalizePhone(String(body.phone))
    if (!normalized) fail(new Error('That phone number could not be read.'))
    body.phone = normalized
  }

  if (patch.pickupLocation !== undefined) {
    const wanted = (patch.pickupLocation ?? '').trim()
    const { data, error } = await supabase()
      .from('places')
      .select('id')
      .eq('name', wanted)
      .eq('archived', false)
      .maybeSingle()
    if (error) fail(error)
    Object.assign(body, pickupColumns((data as { id: string } | null) ?? null, wanted))
  }

  if (Object.keys(body).length === 0) return

  const { error } = await supabase().from('profiles').update(body).eq('id', userId)
  if (error) fail(error)
}

/**
 * Admin-only list of every account, for the admin screens.
 *
 * Emails are blank here. `auth.users` is not reachable from a client query, so
 * an admin screen that shows an address would need a server-side view or a
 * function to join it. Rather than pretend, the admin list shows names and roles
 * and leaves the address off. See 0002_admin_list_emails.sql for the fix.
 */
export async function fetchAllProfiles(): Promise<UserWithPhone[]> {
  // The RPC joins auth.users, which a client cannot read. Without it the admin
  // list would show names and roles but no addresses, so the dashboard's email
  // column and the search over it would both be empty.
  const { data, error } = await supabase().rpc('admin_list_profiles')
  if (error) fail(error)
  return ((data ?? []) as Array<ProfileRow & { email?: string | null }>).map((row) =>
    toUser({ ...row, email: row.email ?? null })
  )
}

/**
 * Admin-only. Corrects a rider's recorded details.
 *
 * Goes through a function rather than an update because the email lives in
 * auth.users. Updating only the profiles row would leave the dashboard showing
 * one address and the login form asking for another.
 */
export async function adminUpdateProfile(input: {
  userId: string
  name?: string
  phone?: string
  email?: string
}): Promise<void> {
  const { error } = await supabase().rpc('admin_update_profile', {
    p_user_id: input.userId,
    p_name: input.name ?? null,
    p_phone: input.phone ?? null,
    p_email: input.email ?? null
  })
  if (error) fail(error)
}

/** Admin-only. Resets a rider's password. */
export async function adminSetPassword(userId: string, password: string): Promise<void> {
  const { error } = await supabase().rpc('admin_set_password', {
    p_user_id: userId,
    p_password: password
  })
  if (error) fail(error)
}

/**
 * Admin-only. Closes an account.
 *
 * Cascades from auth.users through profiles to weeks, entries and requests. The
 * database refuses to remove the last admin, so this cannot lock everyone out.
 */
export async function adminDeleteUser(userId: string): Promise<void> {
  const { error } = await supabase().rpc('admin_delete_user', { p_user_id: userId })
  if (error) fail(error)
}

/**
 * Promotes or demotes an account.
 *
 * Only ever succeeds for an admin, enforced by a trigger rather than a policy
 * because a `with check` clause compares row identity and cannot see a column
 * change. See guard_role_change() in the migration.
 */
export async function setUserRole(userId: string, role: 'user' | 'admin'): Promise<void> {
  const { error } = await supabase().from('profiles').update({ role }).eq('id', userId)
  if (error) fail(error)
}

/* ---------------------------------- weeks --------------------------------- */

/** Every week the signed-in user can see: their own, or all of them for an admin. */
export async function fetchWeekSubscriptions(): Promise<
  Array<{ userId: string; sub: WeekSubscription }>
> {
  const { data, error } = await supabase()
    .from('week_subscriptions')
    .select('*')
    .order('week_start', { ascending: false })
  if (error) fail(error)
  return ((data ?? []) as WeekSubscriptionRow[]).map((row) => ({
    userId: row.user_id,
    sub: toWeekSubscription(row)
  }))
}

/**
 * Creates or updates a rider's own week and takes a weekly number.
 *
 * Delegates to allocate_weekly_number() rather than inserting directly. The
 * insert policy forbids a client-supplied weekly_number, and the function takes
 * an advisory lock first, so two riders subscribing in the same instant cannot
 * be handed the same number. Doing this in the browser would reintroduce the
 * race the unique index exists to prevent.
 */
export async function allocateWeek(input: {
  userId: string
  weekStart: string
  days: readonly number[]
  pickupPlaceId: string | null
  pickupName: string | null
}): Promise<WeekSubscription> {
  const { data, error } = await supabase().rpc('allocate_weekly_number', {
    p_user_id: input.userId,
    p_week_start: input.weekStart,
    p_days: daysToRecord(normalizeDays(input.days)),
    p_pickup_place_id: input.pickupPlaceId,
    p_pickup_name: input.pickupName
  })
  if (error) fail(error)
  // The function returns a composite row; PostgREST hands it back as an object.
  const row = Array.isArray(data) ? data[0] : data
  if (!row) throw new RepoError('The server did not return a subscription')
  return toWeekSubscription(row as WeekSubscriptionRow)
}

/** Admin-only. Moves pending to subscribed, or back down. */
export async function confirmWeekOnServer(
  userId: string,
  weekStart: string,
  status: SubStatus
): Promise<void> {
  const { error } = await supabase().rpc('confirm_week', {
    p_user_id: userId,
    p_week_start: weekStart,
    p_status: status
  })
  if (error) fail(error)
}

/**
 * Rider cancel.
 *
 * A plain update to status='none' rather than a delete, because the weekly
 * number stays on the row and is then never reissued. Deleting would let the
 * sequence hand the same number to somebody else, and a pass printed with it
 * would still scan.
 *
 * The guard trigger permits exactly this transition for a non-admin and refuses
 * everything else, so a rider cannot promote their own row to subscribed.
 */
export async function cancelWeekOnServer(userId: string, weekStart: string): Promise<void> {
  const { error } = await supabase()
    .from('week_subscriptions')
    .update({ status: 'none', pickup_place_id: null, pickup_name: null })
    .eq('user_id', userId)
    .eq('week_start', weekStart)
  if (error) fail(error)
}

/** Changes only the pickup. Keeps the weekly number and the payment state. */
export async function changePickupOnServer(input: {
  userId: string
  weekStart: string
  days: readonly number[]
  pickupPlaceId: string | null
  pickupName: string | null
}): Promise<void> {
  const { error } = await supabase()
    .from('week_subscriptions')
    .update({
      days: daysToRecord(normalizeDays(input.days)),
      pickup_place_id: input.pickupPlaceId,
      pickup_name: input.pickupName
    })
    .eq('user_id', input.userId)
    .eq('week_start', input.weekStart)
  if (error) fail(error)
}

/**
 * Admin-only hard delete of a week.
 *
 * The weekly number is not freed. 0002 added weekly_number_ledger for exactly
 * this: the row that recorded the number outlives the subscription, so
 * allocation cannot hand it out again. Deleting the highest-numbered row used
 * to be the one case where a number came back, and a pass already printed with it
 * would then scan as the next holder.
 */
export async function deleteWeekOnServer(userId: string, weekStart: string): Promise<void> {
  const { error } = await supabase()
    .from('week_subscriptions')
    .delete()
    .eq('user_id', userId)
    .eq('week_start', weekStart)
  if (error) fail(error)
}

/* ---------------------------------- places -------------------------------- */

export async function fetchPlaces(): Promise<PickupPlace[]> {
  const { data, error } = await supabase().from('places').select('*').order('name')
  if (error) fail(error)
  return ((data ?? []) as PlaceRow[]).map(toPlace)
}

export async function createPlace(name: string): Promise<void> {
  const { error } = await supabase().from('places').insert({ name: name.trim() })
  if (error) fail(error)
}

export async function renamePlaceOnServer(id: string, name: string): Promise<void> {
  const { error } = await supabase().from('places').update({ name: name.trim() }).eq('id', id)
  if (error) fail(error)
}

/** Soft delete, so an existing subscription keeps a resolvable pickup name. */
export async function archivePlaceOnServer(id: string): Promise<void> {
  const { error } = await supabase().from('places').update({ archived: true }).eq('id', id)
  if (error) fail(error)
}

export async function restorePlaceOnServer(id: string): Promise<void> {
  const { error } = await supabase().from('places').update({ archived: false }).eq('id', id)
  if (error) fail(error)
}

export async function deletePlaceOnServer(id: string): Promise<void> {
  const { error } = await supabase().from('places').delete().eq('id', id)
  if (error) fail(error)
}

/* ------------------------------ place requests ---------------------------- */

export async function fetchPlaceRequests(): Promise<PlaceRequest[]> {
  const { data, error } = await supabase()
    .from('place_requests')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) fail(error)
  return ((data ?? []) as PlaceRequestRow[]).map(toPlaceRequest)
}

/**
 * Files a request for a place that does not exist yet.
 *
 * `user_id` has to be sent explicitly. The insert policy compares it against
 * auth.uid(), and a missing field is NULL, which does not equal the caller, so
 * an insert that omitted it would be refused with a confusing RLS error rather
 * than the obvious "you must supply a user".
 */
export async function requestPlaceOnServer(userId: string, name: string): Promise<void> {
  const trimmed = name.trim()
  if (!trimmed) return
  const { error } = await supabase().from('place_requests').insert({ user_id: userId, name: trimmed })
  if (error) fail(error)
}

/**
 * Approves a request: creates the place, then resolves the request.
 *
 * Two writes, and deliberately not wrapped in a database function. The second
 * depends on the first having produced an id, and a rider who cancels between
 * them should be left with an orphaned open request, which an admin can resolve
 * by hand, rather than with a request pointing at a place that was never
 * created. The guard trigger keeps the rider from approving their own.
 */
export async function approvePlaceRequestOnServer(requestId: string): Promise<void> {
  const client = supabase()
  const { data: request, error: readError } = await client
    .from('place_requests')
    .select('*')
    .eq('id', requestId)
    .maybeSingle()
  if (readError) fail(readError)
  if (!request) throw new RepoError('That request no longer exists')

  const { data: place, error: insertError } = await client
    .from('places')
    .insert({ name: (request as PlaceRequestRow).name })
    .select('*')
    .single()
  if (insertError) fail(insertError)

  // Point the requester's unlinked subscriptions at the new place, matching the
  // old localStorage behaviour of adoptPlaceRequest.
  const placeId = (place as PlaceRow).id
  const { error: linkError } = await client
    .from('week_subscriptions')
    .update({ pickup_place_id: placeId })
    .eq('user_id', (request as PlaceRequestRow).user_id)
    .is('pickup_place_id', null)
    .eq('pickup_name', (request as PlaceRequestRow).name)
  if (linkError) fail(linkError)

  const { error: resolveError } = await client
    .from('place_requests')
    .update({ status: 'approved', resolved_at: new Date().toISOString() })
    .eq('id', requestId)
  if (resolveError) fail(resolveError)
}

export async function rejectPlaceRequestOnServer(requestId: string): Promise<void> {
  const { error } = await supabase()
    .from('place_requests')
    .update({ status: 'rejected', resolved_at: new Date().toISOString() })
    .eq('id', requestId)
  if (error) fail(error)
}

export async function deletePlaceRequestOnServer(id: string): Promise<void> {
  const { error } = await supabase().from('place_requests').delete().eq('id', id)
  if (error) fail(error)
}

/* ------------------------------ day schedules ----------------------------- */

/**
 * Route and time for a rider's days.
 *
 * Admin-written, so a rider cannot set their own bus. Read by the rider too,
 * which is the point: the pass shows what the admin assigned rather than
 * something the rider could change to match their day.
 */
export async function fetchDayEntries(userId: string): Promise<DayEntry[]> {
  const { data, error } = await supabase()
    .from('day_entries')
    .select('*')
    .eq('user_id', userId)
    .order('entry_date')
  if (error) fail(error)
  return ((data ?? []) as DayEntryRow[]).map(toDayEntry)
}

/**
 * Upserts one day's route and time.
 *
 * An upsert rather than an update-then-insert, because day_entries has a unique
 * index on (user_id, entry_date) and two concurrent saves for the same date would
 * otherwise race: one would fail with a duplicate-key error the caller cannot do
 * anything useful with.
 */
export async function saveDayEntry(
  userId: string,
  date: string,
  patch: Partial<Pick<DayEntry, 'route' | 'time'>>
): Promise<void> {
  const { error } = await supabase().from('day_entries').upsert(
    { user_id: userId, entry_date: date, route: patch.route ?? '', time: patch.time ?? '' },
    { onConflict: 'user_id,entry_date' }
  )
  if (error) fail(error)
}

/* --------------------------------- scanning ------------------------------- */

/**
 * Resolves a scanned weekly number and records the attempt, in one call.
 *
 * One call rather than a read followed by a write, because a driver on a poor
 * connection could otherwise produce a pass that showed as valid with no record
 * of the scan, or a log entry for a scan that never actually happened.
 *
 * The result is stored on the server rather than re-derived from the
 * subscription later: "valid" for somebody who cancelled last week is a true
 * statement about that moment and a false one about today.
 */
export async function recordScan(weekStart: string, number: number): Promise<ScanResolution> {
  const { data, error } = await supabase().rpc('record_scan', {
    p_week_start: weekStart,
    p_weekly_number: number
  })
  if (error) fail(error)
  const row = (Array.isArray(data) ? data[0] : data) as ScanResultRow | undefined
  if (!row) throw new RepoError('The server did not return a scan result')
  return toScanResolution(row)
}

/* --------------------------------- language ------------------------------- */

/**
 * Language is stored per account rather than globally.
 *
 * Under localStorage one key covered everyone on the device, so switching
 * language affected every user of that browser. Per-account is the behaviour a
 * shared tablet actually needs.
 */
export async function saveLanguage(userId: string, lang: Lang): Promise<void> {
  const { error } = await supabase().from('profiles').update({ lang }).eq('id', userId)
  if (error) fail(error)
}

/**
 * Whether a phone number already belongs to an account.
 *
 * Lets the signup form say "this number is registered" before it tries, instead
 * of after. It is a convenience, not the guarantee: this runs before the write,
 * so two simultaneous signups can both be told no, and both succeed, and only
 * one survives. What actually prevents the second is the unique index on the
 * normalised phone, which the database applies at the moment of the insert.
 *
 * Returns false rather than throwing when it cannot be reached. The signup form
 * then proceeds and lets the real attempt produce the real answer, which is
 * better than refusing to let somebody register because a check was flaky.
 */
export async function isPhoneRegistered(phone: string): Promise<boolean> {
  try {
    const { data, error } = await supabase().rpc('phone_in_use', { p_phone: phone })
    if (error) return false
    return data === true
  } catch {
    return false
  }
}