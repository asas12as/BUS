import { describe, expect, it } from 'vitest'
import { formatDayNumber, fromISO, weekDayMarks, weekDays } from './date'

/**
 * The day tiles on the pass show the date of month, not the weekly number. That
 * split is the thing worth protecting here: tiles localise to Arabic-Indic digits
 * so an Arabic pass matches the week range above it, while the weekly number
 * itself stays in Latin digits everywhere, because it gets typed into a box and
 * read off a QR.
 */
describe('formatDayNumber', () => {
  it('renders Latin digits in English', () => {
    expect(formatDayNumber(fromISO('2026-03-14'), 'en')).toBe('14')
  })

  it('renders Arabic-Indic digits in Arabic', () => {
    // ar-EG defaults to the Arabic-Indic numerals. If a runtime ever ships with
    // `ar` defaulting to Latin digits, this is the assertion that catches it.
    expect(formatDayNumber(fromISO('2026-03-14'), 'ar')).toBe('١٤')
  })

  it('agrees with the day of month across a whole week', () => {
    const days = weekDays(fromISO('2026-03-14'))
    const marks = weekDayMarks(fromISO('2026-03-14'), [6, 0, 1, 2, 3])
    const numbers = marks.map((m) => formatDayNumber(m.date, 'en'))
    // The week starts Saturday, so the tiles run 14 through 20.
    expect(numbers).toEqual(['14', '15', '16', '17', '18', '19', '20'])
    expect(days).toHaveLength(7)
  })

  it('pads nothing, so single digits stay narrow', () => {
    expect(formatDayNumber(fromISO('2026-03-03'), 'en')).toBe('3')
    expect(formatDayNumber(fromISO('2026-03-03'), 'ar')).toBe('٣')
  })
})
