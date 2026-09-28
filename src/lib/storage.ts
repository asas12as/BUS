import type {
  AppData,
  DayEntry,
  Lang,
  PickupPlace,
  PlaceRequest,
  SubStatus,
  User,
  WeekSubscription
} from './types'
import { eligibleWeekKeys, nextWeekKey, toISO, weekDays, weekKey } from './date'

const KEY = 'projectbus.data.v1'

const ADMIN_EMAIL = 'admin@projectbus.app'
const ADMIN_PASSWORD = 'admin123'

export const ROUTES = ['Route A - North', 'Route B - City', 'Route C - South', 'Route D - Airport']

export function hashPassword(input: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return `${(h2 >>> 0).toString(16).padStart(8, '0')}${(h1 >>> 0).toString(16).padStart(8, '0')}`
}

function emptyData(): AppData {
  return {
    users: [],
    session: null,
    days: {},
    subscriptions: {},
    weekCounters: {},
    places: [],
    placeRequests: [],
    lang: 'en'
  }
}

const LEGACY_HASH = hashPassword('\u0000legacy')

function nowISO(): string {
  return new Date().toISOString()
}

export function defaultPlaces(): PickupPlace[] {
  const stamp = nowISO()
  return [
    { id: 'p_central', name: 'Central Bus Station', active: true, createdAt: stamp },
    { id: 'p_university', name: 'University Gate', active: true, createdAt: stamp },
    { id: 'p_market', name: 'North Market', active: true, createdAt: stamp },
    { id: 'p_airport', name: 'Old Airport Road', active: true, createdAt: stamp },
    { id: 'p_waterfront', name: 'Waterfront', active: true, createdAt: stamp }
  ]
}

/**
 * Older saves predate weekly numbers. Number the existing subscriptions per week
 * in the order they were created so the queue stays consistent after migration.
 */
function backfillNumbers(raw: unknown): {
  subs: Record<string, Record<string, WeekSubscription>>
  counters: Record<string, number>
} {
  const subs: Record<string, Record<string, WeekSubscription>> = {}
  const counters: Record<string, number> = {}
  if (!raw || typeof raw !== 'object') return { subs, counters }

  const unnumbered: Record<string, { userId: string; createdAt: string; sub: WeekSubscription }[]> = {}

  for (const [userId, weeks] of Object.entries(raw as Record<string, unknown>)) {
    if (!weeks || typeof weeks !== 'object') continue
    subs[userId] = { ...(weeks as Record<string, WeekSubscription>) }
    for (const [week, value] of Object.entries(weeks as Record<string, unknown>)) {
      const sub = value as WeekSubscription
      if (!sub || typeof sub !== 'object') continue
      if (typeof sub.number === 'number' && Number.isFinite(sub.number)) {
        counters[week] = Math.max(counters[week] ?? 0, Math.floor(sub.number))
        continue
      }
      const list = unnumbered[week] ?? []
      list.push({ userId, createdAt: sub.createdAt ?? '', sub })
      unnumbered[week] = list
    }
  }

  for (const [week, list] of Object.entries(unnumbered)) {
    list.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.userId.localeCompare(b.userId))
    // Continue after the highest number already taken in this week, so a
    // partially numbered week can never hand the same number to two users.
    let next = (counters[week] ?? 0) + 1
    for (const entry of list) {
      if (next > MAX_WEEKLY_NUMBER) break
      subs[entry.userId][week] = { ...entry.sub, number: next }
      counters[week] = next
      next++
    }
  }

  return { subs, counters }
}

function mergeCounters(
  base: Record<string, number>,
  extra: unknown
): Record<string, number> {
  const out: Record<string, number> = { ...base }
  if (extra && typeof extra === 'object') {
    for (const [week, value] of Object.entries(extra as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        out[week] = Math.max(out[week] ?? 0, Math.floor(value))
      }
    }
  }
  return out
}

function migrate(parsed: Partial<AppData>): AppData {
  const users = Array.isArray(parsed.users) ? parsed.users : []
  const lang = parsed.lang === 'ar' ? 'ar' : 'en'
  const places = Array.isArray(parsed.places) && parsed.places.length > 0 ? parsed.places : defaultPlaces()
  const { subs, counters } = backfillNumbers(parsed.subscriptions)
  return {
    ...emptyData(),
    ...parsed,
    users: users.map((u) => (u.passwordHash ? u : { ...u, passwordHash: LEGACY_HASH })),
    places,
    placeRequests: Array.isArray(parsed.placeRequests) ? parsed.placeRequests : [],
    subscriptions: subs,
    weekCounters: mergeCounters(counters, parsed.weekCounters),
    lang
  }
}

export function readData(): AppData {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return seed()
    return migrate(JSON.parse(raw) as Partial<AppData>)
  } catch {
    return seed()
  }
}

export function writeData(data: AppData): void {
  localStorage.setItem(KEY, JSON.stringify(data))
}

/**
 * Some environments (notably file:// in some mobile browsers, and private
 * windows with storage disabled) block or quota-limit localStorage. The app
 * cannot work there, so probe once and let the UI say so plainly instead of
 * failing silently on the first save.
 */
export function storageAvailable(): boolean {
  try {
    const probe = '__projectbus_probe__'
    localStorage.setItem(probe, '1')
    localStorage.removeItem(probe)
    return true
  } catch {
    return false
  }
}

function seed(): AppData {
  const now = nowISO()
  const places = defaultPlaces()
  const admin: User = {
    id: 'u_admin',
    name: 'Administrator',
    phone: '+0000000000',
    email: ADMIN_EMAIL,
    passwordHash: hashPassword(ADMIN_PASSWORD),
    role: 'admin',
    createdAt: now
  }
  const demo: User = {
    id: 'u_demo',
    name: 'Demo Rider',
    phone: '+966500000000',
    email: 'demo@projectbus.app',
    passwordHash: hashPassword('demo123'),
    role: 'user',
    createdAt: now
  }

  const data: AppData = {
    ...emptyData(),
    users: [admin, demo],
    places,
    days: {
      u_admin: generateDays(),
      u_demo: generateDays()
    },
    subscriptions: {
      u_admin: {
        [weekKey(new Date())]: {
          weekStart: weekKey(new Date()),
          status: 'subscribed',
          number: 1,
          pickupId: places[0].id,
          pickupName: places[0].name,
          createdAt: now,
          updatedAt: now
        }
      },
      u_demo: {
        [weekKey(new Date())]: {
          weekStart: weekKey(new Date()),
          status: 'subscribed',
          number: 2,
          pickupId: places[0].id,
          pickupName: places[0].name,
          createdAt: now,
          updatedAt: now
        },
        [nextWeekKey(new Date())]: {
          weekStart: nextWeekKey(new Date()),
          status: 'pending',
          number: 1,
          pickupId: places[1].id,
          pickupName: places[1].name,
          createdAt: now,
          updatedAt: now
        }
      }
    },
    weekCounters: {
      [weekKey(new Date())]: 2,
      [nextWeekKey(new Date())]: 1
    },
    placeRequests: [
      {
        id: 'r_seed',
        userId: 'u_demo',
        name: 'Riverside Gate',
        status: 'open',
        createdAt: now
      }
    ]
  }
  writeData(data)
  return data
}

const HOUR_CYCLE = [6, 7, 8, 9]

export function generateDays(anchor: Date = new Date()): Record<string, DayEntry> {
  const out: Record<string, DayEntry> = {}
  const start = weekDays(anchor)[0]
  for (let i = 0; i < 28; i++) {
    const date = new Date(start)
    date.setDate(date.getDate() + i)
    const slot = (date.getDay() + i) % HOUR_CYCLE.length
    out[toISO(date)] = {
      date: toISO(date),
      route: ROUTES[(date.getDay() + i) % ROUTES.length],
      time: `${String(HOUR_CYCLE[slot]).padStart(2, '0')}:${i % 2 === 0 ? '00' : '30'}`
    }
  }
  return out
}

export function isAdminEmail(email: string): boolean {
  return email.trim().toLowerCase() === ADMIN_EMAIL
}

export function adminCredentials(): { email: string; password: string } {
  return { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }
}

export function emailExists(users: User[], email: string): boolean {
  const target = email.trim().toLowerCase()
  return users.some((u) => u.email.toLowerCase() === target)
}

export function upsertUser(data: AppData, user: User): AppData {
  return { ...data, users: [...data.users.filter((u) => u.id !== user.id), user] }
}

export function setLang(data: AppData, lang: Lang): AppData {
  return { ...data, lang }
}

/* ---------------------------------- places --------------------------------- */

export function activePlaces(data: AppData): PickupPlace[] {
  return data.places.filter((p) => p.active)
}

export function placeById(data: AppData, id: string | null): PickupPlace | null {
  if (!id) return null
  return data.places.find((p) => p.id === id) ?? null
}

export function addPlace(data: AppData, name: string): AppData {
  const trimmed = name.trim()
  if (!trimmed) return data
  const place: PickupPlace = {
    id: `p_${Date.now().toString(36)}`,
    name: trimmed,
    active: true,
    createdAt: nowISO()
  }
  return { ...data, places: [...data.places, place] }
}

export function renamePlace(data: AppData, id: string, name: string): AppData {
  const trimmed = name.trim()
  if (!trimmed) return data
  return {
    ...data,
    places: data.places.map((p) => (p.id === id ? { ...p, name: trimmed } : p))
  }
}

/** Soft delete so existing subscriptions keep a resolvable pickup name. */
export function archivePlace(data: AppData, id: string): AppData {
  return {
    ...data,
    places: data.places.map((p) => (p.id === id ? { ...p, active: false } : p))
  }
}

export function restorePlace(data: AppData, id: string): AppData {
  return {
    ...data,
    places: data.places.map((p) => (p.id === id ? { ...p, active: true } : p))
  }
}

/* ------------------------------ place requests ----------------------------- */

function requestExists(data: AppData, userId: string, name: string): boolean {
  const target = name.trim().toLowerCase()
  return data.placeRequests.some(
    (r) => r.userId === userId && r.name.trim().toLowerCase() === target && r.status === 'open'
  )
}

export function requestPlace(data: AppData, userId: string, name: string): AppData {
  const trimmed = name.trim()
  if (!trimmed || requestExists(data, userId, trimmed)) return data
  const request: PlaceRequest = {
    id: `r_${Date.now().toString(36)}`,
    userId,
    name: trimmed,
    status: 'open',
    createdAt: nowISO()
  }
  return { ...data, placeRequests: [request, ...data.placeRequests] }
}

export function approvePlaceRequest(data: AppData, requestId: string): AppData {
  const request = data.placeRequests.find((r) => r.id === requestId)
  if (!request) return data
  const place: PickupPlace = {
    id: `p_${Date.now().toString(36)}`,
    name: request.name,
    active: true,
    createdAt: nowISO()
  }
  const withPlace = { ...data, places: [...data.places, place] }
  // Point the requester's subscription at the newly created place.
  const subs = { ...withPlace.subscriptions }
  for (const [userId, weeks] of Object.entries(subs)) {
    const updated: Record<string, WeekSubscription> = {}
    for (const [week, sub] of Object.entries(weeks)) {
      updated[week] =
        userId === request.userId && sub.pickupId === null && sub.pickupName === request.name
          ? { ...sub, pickupId: place.id }
          : sub
    }
    subs[userId] = updated
  }
  return {
    ...withPlace,
    subscriptions: subs,
    placeRequests: withPlace.placeRequests.map((r) =>
      r.id === requestId ? { ...r, status: 'approved' } : r
    )
  }
}

export function rejectPlaceRequest(data: AppData, requestId: string): AppData {
  return {
    ...data,
    placeRequests: data.placeRequests.map((r) =>
      r.id === requestId ? { ...r, status: 'rejected' } : r
    )
  }
}

export function openPlaceRequests(data: AppData): PlaceRequest[] {
  return data.placeRequests.filter((r) => r.status === 'open')
}

/* ----------------------------- week subscription --------------------------- */

export function getWeekSub(data: AppData, userId: string, weekStart: string): WeekSubscription | null {
  return data.subscriptions[userId]?.[weekStart] ?? null
}

export function weekStatus(data: AppData, userId: string, weekStart: string): SubStatus {
  return getWeekSub(data, userId, weekStart)?.status ?? 'none'
}

export interface PickupChoice {
  id: string | null
  name: string
}

/** Weekly queue numbers run 1-999. */
export const MAX_WEEKLY_NUMBER = 999

export function weeklyNumberLabel(number: number | null): string {
  return number === null ? '—' : String(number).padStart(3, '0')
}

export function weeklyNumberUsed(data: AppData, weekStart: string): number {
  return data.weekCounters[weekStart] ?? 0
}

/**
 * Highest number actually present in a week. Allocation uses the greater of
 * this and the stored counter, so a stale or hand-edited counter can never hand
 * the same number to two different users.
 */
export function highestNumberInWeek(data: AppData, weekStart: string): number {
  let max = 0
  for (const weeks of Object.values(data.subscriptions)) {
    const n = weeks[weekStart]?.number
    if (typeof n === 'number' && n > max) max = n
  }
  return max
}

/** False once the week has issued all 999 numbers. */
export function weeklyNumberAvailable(data: AppData, weekStart: string): boolean {
  return Math.max(weeklyNumberUsed(data, weekStart), highestNumberInWeek(data, weekStart)) < MAX_WEEKLY_NUMBER
}

export function needsNewNumber(
  data: AppData,
  userId: string,
  weekStart: string
): boolean {
  return getWeekSub(data, userId, weekStart)?.number == null
}

function issueNumber(data: AppData, weekStart: string, number: number): AppData {
  return {
    ...data,
    weekCounters: { ...data.weekCounters, [weekStart]: number }
  }
}

function writeWeek(
  data: AppData,
  userId: string,
  weekStart: string,
  patch: Partial<WeekSubscription>
): AppData {
  const previous = getWeekSub(data, userId, weekStart)
  const status = patch.status ?? previous?.status ?? 'none'
  let number = patch.number !== undefined ? patch.number : (previous?.number ?? null)

  // Invariant: a live subscription always carries a weekly number, whoever
  // created it. Covers self-subscribe, admin-created subscriptions and
  // payment confirmation through this one place.
  let out = data
  if (status !== 'none' && number === null) {
    const base = Math.max(weeklyNumberUsed(data, weekStart), highestNumberInWeek(data, weekStart))
    if (base >= MAX_WEEKLY_NUMBER) {
      // The week has issued all 999 numbers. Refuse the write rather than
      // store a live subscription that has no number.
      return data
    }
    number = base + 1
    out = issueNumber(data, weekStart, number)
  }

  const next: WeekSubscription = {
    weekStart,
    status,
    number,
    pickupId: patch.pickupId !== undefined ? patch.pickupId : (previous?.pickupId ?? null),
    pickupName: patch.pickupName !== undefined ? patch.pickupName : (previous?.pickupName ?? null),
    createdAt: previous?.createdAt ?? nowISO(),
    updatedAt: nowISO()
  }
  const userWeeks = out.subscriptions[userId] ?? {}
  return {
    ...out,
    subscriptions: {
      ...out.subscriptions,
      [userId]: { ...userWeeks, [weekStart]: next }
    }
  }
}

/**
 * User action: always lands in pending, never straight to subscribed. The weekly
 * number is issued here, at subscribe time, and survives later pickup changes.
 */
export function subscribeWeek(
  data: AppData,
  userId: string,
  weekStart: string,
  choice: PickupChoice
): AppData {
  const withSub = writeWeek(data, userId, weekStart, {
    status: 'pending',
    pickupId: choice.id,
    pickupName: choice.name.trim() || null
  })
  if (choice.id === null && choice.name.trim()) {
    return requestPlace(withSub, userId, choice.name)
  }
  return withSub
}

/**
 * Changes the pickup only. The weekly number and the payment state are kept, so
 * this works on an unverified subscription without restarting the queue.
 */
export function changePickup(
  data: AppData,
  userId: string,
  weekStart: string,
  choice: PickupChoice
): AppData {
  const withSub = writeWeek(data, userId, weekStart, {
    pickupId: choice.id,
    pickupName: choice.name.trim() || null
  })
  if (choice.id === null && choice.name.trim()) {
    return requestPlace(withSub, userId, choice.name)
  }
  return withSub
}

/** Admin action: moves pending -> subscribed. */
export function confirmWeek(data: AppData, userId: string, weekStart: string): AppData {
  return writeWeek(data, userId, weekStart, { status: 'subscribed' })
}

/**
 * Admin or user action: drops back to not subscribed. The weekly number is
 * intentionally kept on the record so it is never re-issued to another user.
 */
export function clearWeek(data: AppData, userId: string, weekStart: string): AppData {
  return writeWeek(data, userId, weekStart, {
    status: 'none',
    pickupId: null,
    pickupName: null
  })
}

export function setWeekStatus(
  data: AppData,
  userId: string,
  weekStart: string,
  status: SubStatus
): AppData {
  return writeWeek(data, userId, weekStart, { status })
}

/**
 * Most urgent state wins, because that is what the user must act on:
 * not subscribed > pending payment > subscribed.
 */
export function worstSubStatus(statuses: SubStatus[]): SubStatus {
  if (statuses.length === 0) return 'none'
  if (statuses.includes('none')) return 'none'
  if (statuses.includes('pending')) return 'pending'
  return 'subscribed'
}

export function overallStatus(data: AppData, userId: string, anchor: Date = new Date()): SubStatus {
  return worstSubStatus(eligibleWeekKeys(anchor).map((wk) => weekStatus(data, userId, wk)))
}

/* ----------------------------- admin full control ---------------------------- */

/** Hard delete of the weekly record. The counter keeps the number burned. */
export function deleteWeekSub(data: AppData, userId: string, weekStart: string): AppData {
  const weeks = data.subscriptions[userId]
  if (!weeks || !weeks[weekStart]) return data
  const next = { ...weeks }
  delete next[weekStart]
  return { ...data, subscriptions: { ...data.subscriptions, [userId]: next } }
}

/** Hard delete. Subscriptions keep the historical pickup name, losing only the link. */
export function deletePlace(data: AppData, id: string): AppData {
  const subs: Record<string, Record<string, WeekSubscription>> = {}
  for (const [userId, weeks] of Object.entries(data.subscriptions)) {
    const updated: Record<string, WeekSubscription> = {}
    for (const [week, sub] of Object.entries(weeks)) {
      updated[week] = sub.pickupId === id ? { ...sub, pickupId: null } : sub
    }
    subs[userId] = updated
  }
  return {
    ...data,
    places: data.places.filter((p) => p.id !== id),
    subscriptions: subs
  }
}

export function deletePlaceRequest(data: AppData, id: string): AppData {
  return { ...data, placeRequests: data.placeRequests.filter((r) => r.id !== id) }
}

/** Admin edit of a user record. Validates uniqueness before calling. */
export function updateUserRecord(
  data: AppData,
  id: string,
  patch: Partial<Pick<User, 'name' | 'phone' | 'email' | 'role'>>
): AppData {
  const user = data.users.find((u) => u.id === id)
  if (!user) return data
  const next = { ...user, ...patch }
  return {
    ...data,
    users: data.users.map((u) => (u.id === id ? next : u)),
    session:
      data.session?.userId === id
        ? { ...data.session, role: next.role, userId: id }
        : data.session
  }
}

export function setUserPassword(data: AppData, id: string, plain: string): AppData {
  return {
    ...data,
    users: data.users.map((u) => (u.id === id ? { ...u, passwordHash: hashPassword(plain) } : u))
  }
}

/** Hard delete of a user plus every record that belongs to them. */
export function deleteUser(data: AppData, id: string): AppData {
  const days = { ...data.days }
  delete days[id]
  const subscriptions = { ...data.subscriptions }
  delete subscriptions[id]
  return {
    ...data,
    users: data.users.filter((u) => u.id !== id),
    days,
    subscriptions,
    placeRequests: data.placeRequests.filter((r) => r.userId !== id),
    session: data.session?.userId === id ? null : data.session
  }
}

/** Admin edit of one scheduled day. */
export function updateDay(
  data: AppData,
  userId: string,
  date: string,
  patch: Partial<Pick<DayEntry, 'route' | 'time'>>
): AppData {
  const userDays = data.days[userId] ?? {}
  const current = userDays[date]
  if (!current) return data
  return {
    ...data,
    days: { ...data.days, [userId]: { ...userDays, [date]: { ...current, ...patch } } }
  }
}
