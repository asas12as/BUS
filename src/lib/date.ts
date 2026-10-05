export const WEEK_STARTS_ON = 6

export function toISO(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function fromISO(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function addDays(date: Date, amount: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + amount)
  return next
}

export function startOfWeek(date: Date): Date {
  const diff = (date.getDay() - WEEK_STARTS_ON + 7) % 7
  return addDays(date, -diff)
}

export function weekDays(anchor: Date): Date[] {
  const start = startOfWeek(anchor)
  return Array.from({ length: 7 }, (_, i) => addDays(start, i))
}

export function isToday(date: Date): boolean {
  return toISO(date) === toISO(new Date())
}

/** Stable identity of a week: the ISO date of its Saturday. */
export function weekKey(date: Date): string {
  return toISO(startOfWeek(date))
}

export function nextWeekKey(date: Date): string {
  return toISO(addDays(startOfWeek(date), 7))
}

/* -------------------------------- pricing --------------------------------- */

/**
 * Weekly price in EGP for the base four days. The fifth day, when a rider takes
 * it, is charged on its own at EXTRA_DAY_PRICE rather than being bundled, which
 * is why the two are separate constants instead of one lookup table.
 */
export const BASE_WEEK_PRICE = 160

/** The optional fifth day, charged separately. */
export const EXTRA_DAY_PRICE = 40

/**
 * What the rider owes for a chosen set of days. Anything that is not five days
 * is the base week; only a five-day rider pays the extra day on top.
 */
export function weekPrice(dayCount: number): number {
  return BASE_WEEK_PRICE + (dayCount >= 5 ? EXTRA_DAY_PRICE : 0)
}

/* ------------------------------ chosen days -------------------------------- */

/**
 * Days a rider may choose, as JS day numbers in week order. Weeks start on
 * Saturday, so the selectable run is Saturday through Wednesday: 6, 0, 1, 2, 3.
 * Thursday and Friday are deliberately not offered.
 */
export const SELECTABLE_DAYS = [6, 0, 1, 2, 3] as const

/** A rider commits to either four days or five days a week. */
export const DAY_COUNTS = [4, 5] as const

export type DayCount = (typeof DAY_COUNTS)[number]

/**
 * Normalises a chosen-day list: drops anything outside the selectable range and
 * duplicates, then orders the result by week order so equal sets always compare
 * equal. Invalid input degrades to "no selection" rather than throwing, because
 * this also runs against data that was saved by an older build.
 */
export function normalizeDays(days: readonly number[] | null | undefined): number[] {
  if (!Array.isArray(days)) return []
  const wanted = new Set(days)
  return SELECTABLE_DAYS.filter((d) => wanted.has(d))
}

/** True when the selection is exactly one of the allowed counts, in range. */
export function isValidDayChoice(days: readonly number[] | null | undefined): boolean {
  const clean = normalizeDays(days)
  return (
    clean.length === days?.length &&
    (DAY_COUNTS as readonly number[]).includes(clean.length) &&
    new Set(days ?? []).size === clean.length
  )
}

/**
 * Resolves what a stored subscription actually runs on. A null `days` is a
 * legacy record and means the full selectable week.
 */
export function subDays(sub: { days?: number[] | null } | null): number[] {
  if (!sub) return []
  return normalizeDays(sub.days ?? SELECTABLE_DAYS)
}

/**
 * Real dates for the selectable days of the week containing `anchor`, in week
 * order. Derived from the week start rather than from day numbers, so it stays
 * correct regardless of which weekday the calendar happens to open on.
 */
export function selectableDayDates(anchor: Date): Date[] {
  const start = startOfWeek(anchor)
  return SELECTABLE_DAYS.map((day) => {
    // Saturday is offset 0, and every other day is one past its own number.
    return addDays(start, day === WEEK_STARTS_ON ? 0 : day + 1)
  })
}

/** A week can only be subscribed for the current week or the one after it. */
export function eligibleWeekKeys(anchor: Date = new Date()): string[] {
  return [weekKey(anchor), nextWeekKey(anchor)]
}

/* ------------------------------ pass day strip ------------------------------ */

export type WeekDayState = 'ride' | 'off' | 'closed'

export interface WeekDayMark {
  date: Date
  /** JS day number, matching the values stored in a subscription. */
  day: number
  /** False on Thursday and Friday, which the service does not run. */
  offered: boolean
  riding: boolean
  /**
   * `closed` is kept separate from `off` so a rider can tell "the bus does not
   * run that day" from "the bus runs but I am not on it that day". Rendering
   * both as merely dimmed would make the two indistinguishable.
   */
  state: WeekDayState
}

/**
 * The whole week marked up for the QR pass.
 *
 * The full seven days are returned rather than only the chosen ones, because a
 * pass that lists five chips and silently omits two is easier to misread than
 * one that shows the week and marks where the rider sits.
 */
export function weekDayMarks(
  anchor: Date,
  days: readonly number[] | null | undefined
): WeekDayMark[] {
  const riding = new Set(normalizeDays(days))
  const offered = new Set<number>(SELECTABLE_DAYS)
  return weekDays(anchor).map((date) => {
    const day = date.getDay()
    const isOffered = offered.has(day)
    const isRiding = isOffered && riding.has(day)
    return {
      date,
      day,
      offered: isOffered,
      riding: isRiding,
      state: isRiding ? 'ride' : isOffered ? 'off' : 'closed'
    }
  })
}

/* --------------------------- subscription window -------------------------- */

/**
 * The window is expressed as offsets from the start of the week the anchor
 * belongs to (Saturday = day 0). Offsets are used rather than day-of-week
 * names because the window deliberately straddles the boundary: it closes one
 * minute *into* the next week. Naming weekdays here made the close edge
 * ambiguous when the anchor was itself a Saturday.
 */
const OPEN_OFFSET_DAYS = 4 // Wednesday
const OPEN_HOUR = 16
const OPEN_MINUTE = 30
const CLOSE_OFFSET_DAYS = 7 // the following Saturday, i.e. the end of Friday
const CLOSE_HOUR = 0
const CLOSE_MINUTE = 1

function edge(anchor: Date, offsetDays: number, hour: number, minute: number): Date {
  const d = addDays(startOfWeek(anchor), offsetDays)
  d.setHours(hour, minute, 0, 0)
  return d
}

/** Start of the current window: Wednesday 16:30. */
export function windowOpensAt(anchor: Date = new Date()): Date {
  return edge(anchor, OPEN_OFFSET_DAYS, OPEN_HOUR, OPEN_MINUTE)
}

/** End of the current window: the Saturday after Friday, at 00:01. */
export function windowClosesAt(anchor: Date = new Date()): Date {
  return edge(anchor, CLOSE_OFFSET_DAYS, CLOSE_HOUR, CLOSE_MINUTE)
}

/** True while subscriptions are open, i.e. Wednesday 16:30 to Saturday 00:01. */
export function isWindowOpen(anchor: Date = new Date()): boolean {
  const now = anchor.getTime()
  return now >= windowOpensAt(anchor).getTime() && now < windowClosesAt(anchor).getTime()
}

export function msUntilWindowOpens(anchor: Date = new Date()): number {
  return windowOpensAt(anchor).getTime() - anchor.getTime()
}

export function msUntilWindowCloses(anchor: Date = new Date()): number {
  return windowClosesAt(anchor).getTime() - anchor.getTime()
}

/**
 * Which week a new subscription may target. During the window this is always
 * the upcoming week, because the window runs across the end of the current one.
 */
export function targetableWeekKey(anchor: Date = new Date()): string {
  return isWindowOpen(anchor) ? nextWeekKey(anchor) : weekKey(anchor)
}

/**
 * Which week a subscribe sheet should actually act on.
 *
 * A rider can tap subscribe from anywhere, including weeks that are not open,
 * so rather than refusing with a message the sheet quietly follows the one week
 * that is on offer. The exception is a week the rider already holds: that sheet
 * is there to manage it, so it stays put.
 */
export function resolveSubscribeWeek(
  requested: string,
  targetable: string,
  holdsRequested: boolean
): string {
  return holdsRequested ? requested : targetable
}

/**
 * A week may be subscribed only while the window is open. Previously any of the
 * two eligible weeks was allowed at any time; now the clock decides.
 */
export function canSubscribe(weekStart: string, anchor: Date = new Date()): boolean {
  if (!isWindowOpen(anchor)) return false
  return eligibleWeekKeys(anchor).includes(weekStart)
}

/**
 * True when the user may not open a new subscription because they still hold a
 * live one for the week in progress. Only pending and confirmed count as live.
 */
export function blockedByCurrentWeek(
  currentWeekStatus: 'none' | 'pending' | 'subscribed',
  anchor: Date = new Date()
): boolean {
  if (isWindowOpen(anchor)) return currentWeekStatus !== 'none'
  // Outside the window nothing can be subscribed anyway, so this only reports
  // whether an existing live subscription is in progress.
  return currentWeekStatus === 'subscribed' || currentWeekStatus === 'pending'
}

/** Minutes remaining in the window, rounded up, or 0 when closed. */
export function minutesRemaining(anchor: Date = new Date()): number {
  if (!isWindowOpen(anchor)) return 0
  return Math.ceil(msUntilWindowCloses(anchor) / 60000)
}

/** Minutes until the window opens, rounded up, or 0 when already open. */
export function minutesUntilOpen(anchor: Date = new Date()): number {
  if (isWindowOpen(anchor)) return 0
  return Math.max(0, Math.ceil(msUntilWindowOpens(anchor) / 60000))
}

export function isPastWeek(weekStart: string, anchor: Date = new Date()): boolean {
  return !canSubscribe(weekStart, anchor)
}

export function formatDayName(date: Date, lang: 'en' | 'ar'): string {
  const locale = lang === 'ar' ? 'ar-EG' : 'en-GB'
  return new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(date)
}

/**
 * The day of the month on its own, for the tiles along a pass.
 *
 * Goes through the same locale as every other date in the app, so an Arabic pass
 * shows Arabic-Indic digits to match the week range printed just above it. This
 * is the date, not the weekly number: the number a rider is identified by stays
 * in Latin digits everywhere, because it is typed into a box and read off a QR.
 */
export function formatDayNumber(date: Date, lang: 'en' | 'ar'): string {
  const locale = lang === 'ar' ? 'ar-EG' : 'en-GB'
  return new Intl.DateTimeFormat(locale, { day: 'numeric' }).format(date)
}

export function formatDayShort(date: Date, lang: 'en' | 'ar'): string {
  const locale = lang === 'ar' ? 'ar-EG' : 'en-GB'
  return new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(date)
}

export function formatDate(date: Date, lang: 'en' | 'ar'): string {
  const locale = lang === 'ar' ? 'ar-EG' : 'en-GB'
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(date)
}

export function formatMonthRange(days: Date[], lang: 'en' | 'ar'): string {
  if (days.length === 0) return ''
  const locale = lang === 'ar' ? 'ar-EG' : 'en-GB'
  const first = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long' }).format(days[0])
  const last = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long' }).format(days[days.length - 1])
  return `${first} - ${last}`
}
