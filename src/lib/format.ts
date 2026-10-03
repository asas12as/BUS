import type { Lang } from './types'

/**
 * Compact duration for the subscription countdown. Countdown text is written
 * with the app's own language rather than Intl, because Intl renders
 * unit-less numbers ambiguously in Arabic and adds a space before the unit that
 * looks wrong in both directions.
 */
export function formatMinutes(total: number, lang: Lang = 'en'): string {
  const mins = Math.max(0, Math.round(total))
  const days = Math.floor(mins / 1440)
  const hours = Math.floor((mins % 1440) / 60)
  const rest = mins % 60

  if (lang === 'ar') {
    const parts: string[] = []
    if (days > 0) parts.push(`${days} يوم`)
    if (hours > 0) parts.push(`${hours} س`)
    if (rest > 0 || parts.length === 0) parts.push(`${rest} د`)
    return parts.join(' و')
  }

  const parts: string[] = []
  if (days > 0) parts.push(`${days}d`)
  if (hours > 0) parts.push(`${hours}h`)
  if (rest > 0 || parts.length === 0) parts.push(`${rest}m`)
  return parts.join(' ')
}