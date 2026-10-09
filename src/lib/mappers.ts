/**
 * Converts Postgres rows into the app's own shapes.
 *
 * Every column arrives as a string and has to be checked, because the app's
 * types are narrower than what the database can hold. `status text check (...)`
 * is a constraint the type system cannot see, and jsonb is `unknown` by
 * definition.
 *
 * The important one is `daysFromRecord`. A row written before a column existed
 * is `{}`; the app treats "no days stored" as the full selectable week, which is
 * the historical meaning of that record.
 */
import type { DayEntry, Lang, PickupPlace, User, WeekSubscription } from './types'
import { SELECTABLE_DAYS, normalizeDays, isValidDayChoice } from './date'
import {
  asLang,
  asPlaceKind,
  asRole,
  asSubStatus,
  asScanResult,
  daysFromRecord,
  daysToRecord,
  type DayEntryRow,
  type PlaceRow,
  type ProfileRow,
  type ScanResult,
  type ScanResultRow,
  type WeekSubscriptionRow
} from './rows'
import { supabaseConfigured } from './supabase'

/**
 * Email lives in auth.users, not in profiles.
 *
 * That is the whole point of keeping identity in Supabase's table: the password
 * and the email are not ours to store. But the admin screens and the pass both
 * show an email, so the repository has to join it in. Every caller that
 * materialises a User gets it from here, and a row that came back without a
 * joined email yields an empty string rather than undefined, so no screen has to
 * consider a missing field.
 */
export type ProfileWithEmail = ProfileInput

export interface UserWithPhone extends User {
  /**
   * From the profiles column, added in migration 0002.
   *
   * Was read from signup metadata before that, which meant the number only
   * existed on the session that created the account: every later reload showed a
   * blank one on the pass.
   */
  phone: string
}

/**
 * A profile, plus the one field that is not part of User.
 *
 * Language lives on the profiles row rather than on User because it is a
 * database column, not something the app owns. Threading it through User would
 * mean every place that builds a User from a row had to remember it, and the
 * one that forgot would silently reset a rider's language on every reload.
 */
export interface MeProfile {
  user: UserWithPhone
  lang: Lang
}

/**
 * A row as read from Postgres, with the address joined in.
 *
 * `email` is not a column on profiles. It comes from the auth session when the
 * caller knows the session, and from admin_list_profiles() otherwise, so it is
 * part of the input rather than something a row could carry.
 */
export type ProfileInput = ProfileRow & { email: string | null }

/**
 * Maps a profile row to the shape the screens use.
 *
 * The column wins over `phone`. The signup trigger writes profiles.phone from the
 * signup metadata, so the two normally agree; where they do not, the column is the
 * one an admin can read back and the one a Profile edit writes to. The metadata
 * copy is only a fallback for a row that predates the column.
 */
export function toUser(row: ProfileInput, metadataPhone?: string): UserWithPhone {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone || metadataPhone || '',
    email: row.email ?? '',
    role: asRole(row.role),
    createdAt: row.created_at,
    avatar: row.avatar,
    pickupId: row.pickup_place_id ?? null,
    pickupLocation: row.pickup_name ?? null,
    pickupBusId: row.pickup_bus_id ?? null,
    pickupBusName: row.pickup_bus_name ?? null
  }
}

export function toDayEntry(row: DayEntryRow): DayEntry {
  return {
    date: row.entry_date,
    route: row.route,
    time: row.time
  }
}

export function toPlace(row: PlaceRow): PickupPlace {
  return {
    id: row.id,
    name: row.name,
    kind: asPlaceKind(row.kind),
    active: !row.archived,
    createdAt: row.created_at,
    busId: row.bus_id ?? null
  }
}

export function toWeekSubscription(row: WeekSubscriptionRow): WeekSubscription {
  const stored = daysFromRecord(row.days)
  // Same repair as the old localStorage reader: a record with no usable day list
  // is read as the whole selectable week rather than as a broken subscription.
  const days =
    stored === null ? [...SELECTABLE_DAYS] : isValidDayChoice(stored) ? normalizeDays(stored) : [...SELECTABLE_DAYS]

  return {
    weekStart: row.week_start,
    status: asSubStatus(row.status),
    number: row.weekly_number,
    pickupId: row.pickup_place_id,
    pickupName: row.pickup_name,
    days,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

/**
 * Whether the build has a usable database.
 *
 * Read from the environment rather than imported as a constant, so a test can
 * stub it and a rebuild picks up a change to .env.local without a restart.
 */
export function hasBackend(): boolean {
  return supabaseConfigured()
}

/**
 * A profile row plus the language it carries.
 *
 * `MeProfile` exists so that a caller holding only a profile knows both the user
 * and the interface language, and cannot accidentally apply a default and reset
 * an Arabic rider's language to English on reload.
 */
export function toMeProfile(row: ProfileWithEmail, phone?: string): MeProfile {
  return { user: toUser(row, phone), lang: asLang(row.lang) }
}

/**
 * What a scan resolved to.
 *
 * `user` is null for a miss: there is nobody to describe, and inventing a
 * placeholder name would risk a driver reading it off the screen as real.
 */
export interface ScanResolution {
  result: ScanResult
  user: User | null
  sub: WeekSubscription | null
}

/** Normalises record_scan's row into something the screen can render. */
export function toScanResolution(row: ScanResultRow): ScanResolution {
  const result = asScanResult(row.result)
  const sub =
    row.weekly_number === null
      ? null
      : {
          weekStart: row.week_start,
          status: asSubStatus(row.status ?? 'none'),
          number: row.weekly_number,
          pickupId: null,
          pickupName: row.pickup_name,
          days: [...SELECTABLE_DAYS],
          createdAt: '',
          updatedAt: ''
        }

  return {
    result,
    sub,
    user: row.rider_id
      ? {
          id: row.rider_id,
          name: row.rider_name ?? '',
          phone: '',
          email: '',
          role: 'user' as const,
          createdAt: '',
          avatar: null,
          pickupId: null,
          pickupLocation: row.pickup_name
        }
      : null
  }
}

/**
 * A profile row, and the same fields as an update for the write side.
 *
 * `lang` is included because it is a real column on this table, even though it
 * is deliberately absent from `User`.
 */
export function profilePatch(
  patch: Partial<{ name: string; avatar: string | null; lang: Lang; phone: string }>
) {
  const out: Record<string, unknown> = {}
  if (patch.name !== undefined) out.name = patch.name
  if (patch.avatar !== undefined) out.avatar = patch.avatar
  if (patch.lang !== undefined) out.lang = patch.lang
  if (patch.phone !== undefined) out.phone = patch.phone
  // pickup_place_id and pickup_name are set by the repository, which resolves
  // the typed name against the places table first. Sending one from here would
  // let a caller store an id and a name that disagree.
  return out
}

/**
 * Resolves a typed pickup name to the pair of columns that describe it.
 *
 * Exported so the mapping is testable on its own: the choice between an id and
 * free text is a rule, not a detail of the write.
 */
export function pickupColumns(match: { id: string } | null, typed: string): Record<string, unknown> {
  return match ? { pickup_place_id: match.id, pickup_name: null } : { pickup_place_id: null, pickup_name: typed || null }
}

export { daysToRecord }