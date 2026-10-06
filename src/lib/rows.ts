/**
 * Row shapes as they exist in Postgres, and the conversions to and from the
 * app's own types.
 *
 * These are hand-written rather than generated. `supabase gen types` would
 * describe the whole database, including tables this app never touches, and the
 * generated file would then have to be regenerated on every schema change to
 * stay in step. Written by hand, the drift shows up as a type error at the one
 * call site that matters instead of as a stale file nobody reads.
 *
 * Naming follows Postgres convention: snake_case columns, and `archived` rather
 * than `active` because a place is removed from the picker without ceasing to
 * exist. The app's own types keep `active`, which is the inverse, so that every
 * read of that field says what it means.
 */
import type { Lang, PlaceRequestStatus, Role, SubStatus } from './types'

export interface ProfileRow {
  id: string
  name: string
  phone: string
  role: string
  lang: string
  avatar: string | null
  pickup_place_id: string | null
  pickup_name: string | null
  /**
   * The rider's own address, when they gave one at signup.
   *
   * Distinct from the account's GoTrue address, which is derived from the phone
   * and is never shown. This is the one a human typed, and it is optional.
   */
  email?: string | null
  created_at: string
  updated_at: string
}

export interface DayEntryRow {
  id: string
  user_id: string
  entry_date: string
  route: string
  time: string
  created_at: string
  updated_at: string
}

/** What a scan resolved to, as record_scan returns it. */
export interface ScanResultRow {
  result: string
  rider_id: string | null
  rider_name: string | null
  pickup_name: string | null
  week_start: string
  weekly_number: number | null
  status: string | null
}

export interface PlaceRow {
  id: string
  name: string
  archived: boolean
  created_at: string
}

export interface PlaceRequestRow {
  id: string
  user_id: string
  name: string
  status: string
  created_at: string
  resolved_at: string | null
}

export interface WeekSubscriptionRow {
  id: string
  user_id: string
  week_start: string
  days: unknown
  pickup_place_id: string | null
  pickup_name: string | null
  status: string
  weekly_number: number | null
  confirmed_at: string | null
  created_at: string
  updated_at: string
}

/**
 * Narrows a database string to one of the app's unions, falling back when the
 * value is not recognised.
 *
 * Needed because these columns are `text` with a CHECK constraint rather than
 * Postgres enums. A `check` is not visible to the type system and is not
 * guaranteed to hold if the constraint is ever dropped, so a row read as
 * `status: string` has to be validated before it reaches a switch statement.
 * Returning the fallback rather than throwing keeps one bad row from blanking
 * the whole screen.
 */
function oneOf<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback
}

export const ROLES = ['user', 'admin'] as const satisfies readonly Role[]
export const LANGS = ['en', 'ar'] as const satisfies readonly Lang[]
export const SUB_STATUSES = ['none', 'pending', 'subscribed'] as const satisfies readonly SubStatus[]
export const REQUEST_STATUSES = ['open', 'approved', 'rejected'] as const satisfies readonly PlaceRequestStatus[]

/** What a scan can conclude, in the order the driver screen treats them. */
export const SCAN_RESULTS = ['valid', 'pending', 'cancelled', 'not_found'] as const
export type ScanResult = (typeof SCAN_RESULTS)[number]

export function asRole(value: string): Role {
  return oneOf(value, ROLES, 'user')
}

export function asLang(value: string): Lang {
  return oneOf(value, LANGS, 'en')
}

export function asSubStatus(value: string): SubStatus {
  return oneOf(value, SUB_STATUSES, 'none')
}

export function asRequestStatus(value: string): PlaceRequestStatus {
  return oneOf(value, REQUEST_STATUSES, 'open')
}

/**
 * A scan outcome, falling back to 'not_found'.
 *
 * The fallback is deliberately the pessimistic one. An unrecognised value means
 * the server sent something this build does not understand, and reporting that
 * as 'not valid' stops a driver rather than waving somebody through on a guess.
 */
export function asScanResult(value: string): ScanResult {
  return oneOf(value, SCAN_RESULTS, 'not_found')
}

/**
 * Days are stored as a jsonb object keyed by JS day number, e.g. {"6":true}.
 *
 * An object rather than an array of the chosen days, because a pass needs to
 * distinguish "Tuesday off" from "not set". With a plain list there is no way to
 * tell those apart, and the printed pass would show a false blank on a day the
 * rider never chose.
 */
export function daysToRecord(days: readonly number[]): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const day of days) out[String(day)] = true
  return out
}

/**
 * Reads the object form back into a list of day numbers.
 *
 * `days` is `unknown` because it is jsonb: the driver types it as whatever the
 * column holds, which is nothing in particular. Everything about it has to be
 * checked, including that it is an object at all -- a row written before the
 * column existed is `{}`, and a hand-edited row could be an array or a string.
 */
export function daysFromRecord(raw: unknown): number[] | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw !== 'object' || Array.isArray(raw)) return null
  const out: number[] = []
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value !== true) continue
    const day = Number(key)
    if (Number.isInteger(day) && day >= 0 && day <= 6) out.push(day)
  }
  return out
}