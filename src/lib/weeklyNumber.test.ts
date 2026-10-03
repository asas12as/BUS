import { describe, it, expect } from 'vitest'
import { weeklyNumberLabel, parseWeeklyNumber, MAX_WEEKLY_NUMBER } from './weeklyNumber'

/**
 * Weekly numbers are printed on a pass and read aloud at the door, so a wrong
 * number here either misroutes a rider or silently fails to validate one. Both
 * directions are pinned: printing must match the scheme exactly, and parsing
 * must be its exact inverse.
 */
describe('weeklyNumberLabel', () => {
  it('prints plain numbers before the first letter block', () => {
    expect(weeklyNumberLabel(1)).toBe('1')
    expect(weeklyNumberLabel(7)).toBe('7')
    expect(weeklyNumberLabel(999)).toBe('999')
    expect(weeklyNumberLabel(1000)).toBe('1000')
  })

  it('reuses 1-1000 once per letter block', () => {
    // 1001 is the first lettered number, and each block of 1000 advances the
    // letter. This is the scheme: 1A..1000A, then 1B..1000B.
    expect(weeklyNumberLabel(1001)).toBe('1A')
    expect(weeklyNumberLabel(1002)).toBe('2A')
    expect(weeklyNumberLabel(1000 + 1000)).toBe('1000A')
    expect(weeklyNumberLabel(1001 + 1000)).toBe('1B')
    expect(weeklyNumberLabel(2001 + 1000)).toBe('1C')
  })

  it('moves to two letter blocks after Z', () => {
    expect(weeklyNumberLabel(1000 + 26 * 1000)).toBe('1000Z')
    expect(weeklyNumberLabel(1000 + 26 * 1000 + 1)).toBe('1AA')
    expect(weeklyNumberLabel(1000 + 27 * 1000 + 1)).toBe('1AB')
  })

  it('shows a dash rather than a number it cannot express', () => {
    expect(weeklyNumberLabel(null)).toBe('—')
    expect(weeklyNumberLabel(undefined)).toBe('—')
    expect(weeklyNumberLabel(0)).toBe('—')
    expect(weeklyNumberLabel(-1)).toBe('—')
    expect(weeklyNumberLabel(Number.NaN)).toBe('—')
    // Past the last expressible block. Unreachable in practice, but it must
    // not wrap around into a number another rider already holds.
    expect(weeklyNumberLabel(MAX_WEEKLY_NUMBER + 1)).toBe('—')
  })
})

describe('parseWeeklyNumber', () => {
  it('is the exact inverse of printing', () => {
    const samples = [1, 2, 7, 999, 1000, 1001, 1002, 2000, 2001, 27000, 27001, 29577, MAX_WEEKLY_NUMBER]
    for (const n of samples) {
      expect(parseWeeklyNumber(weeklyNumberLabel(n))).toBe(n)
    }
  })

  it('round trips at every letter block boundary', () => {
    // One probe per block, plus the ends of each block's number range. Covers
    // the single and two letter blocks without walking all 700k numbers.
    for (let block = 0; block < 26 + 26 * 26; block++) {
      for (const digits of [1, 2, 999, 1000]) {
        const n = 1000 + 1 + block * 1000 + (digits - 1)
        if (n > MAX_WEEKLY_NUMBER) continue
        expect(parseWeeklyNumber(weeklyNumberLabel(n))).toBe(n)
      }
    }
  })

  it('accepts what a driver would type', () => {
    expect(parseWeeklyNumber('1a')).toBe(1001)
    expect(parseWeeklyNumber(' 12b ')).toBe(2012)
    expect(parseWeeklyNumber('004')).toBe(4)
  })

  it('refuses ambiguous input instead of guessing', () => {
    // A wrong number here would confirm the wrong rider, so anything outside
    // the scheme is rejected outright.
    for (const bad of ['0', '0A', '1001', '1001A', '10000', '', '  ', 'A', 'A1', '1ABC', '12-', '1.5', '-1', '1 A!']) {
      expect(parseWeeklyNumber(bad), `"${bad}" should be rejected`).toBeNull()
    }
  })
})
