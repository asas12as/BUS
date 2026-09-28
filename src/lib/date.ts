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

/** A week can only be subscribed for the current week or the one after it. */
export function eligibleWeekKeys(anchor: Date = new Date()): string[] {
  return [weekKey(anchor), nextWeekKey(anchor)]
}

export function canSubscribe(weekStart: string, anchor: Date = new Date()): boolean {
  return eligibleWeekKeys(anchor).includes(weekStart)
}

export function isPastWeek(weekStart: string, anchor: Date = new Date()): boolean {
  return !canSubscribe(weekStart, anchor)
}

export function formatDayName(date: Date, lang: 'en' | 'ar'): string {
  const locale = lang === 'ar' ? 'ar-EG' : 'en-GB'
  return new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(date)
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
