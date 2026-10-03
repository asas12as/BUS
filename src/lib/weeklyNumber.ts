/**
 * Weekly queue numbers.
 *
 * A number is stored as a plain integer, so counters, sorting and the
 * "already taken" guard stay trivial. The letters only exist at the edges:
 * printing and parsing.
 *
 * The scheme runs 1 to 1000 as plain numbers, then reuses those 1000 numbers
 * once per letter: 1A to 1000A, then 1B to 1000B, and so on. Each letter
 * block adds another 1000 riders, so the letters are a long way from being a
 * real limit, but the parser accepts only a one or two letter suffix so the
 * accepted input stays narrow and can be validated cheaply.
 *
 * Everything is ASCII by design. These strings are read aloud at the door and
 * typed by hand into the manual lookup box, and a full-width or Arabic-Indic
 * digit would turn "12A" into something nobody can enter reliably.
 */

/** Plain numbers handed out before the first letter block. */
const PLAIN_MAX = 1000

/** How many numbers each letter block covers. */
const PER_BLOCK = 1000

/**
 * Two-letter suffixes only, giving 26 + 26*26 = 702 blocks of 1000. More than
 * a million riders per week, which is past any plausible use, and it keeps the
 * accepted pattern to a fixed width.
 */
const MAX_BLOCKS = 26 + 26 * 26

export const MAX_WEEKLY_NUMBER = PLAIN_MAX + MAX_BLOCKS * PER_BLOCK

/** Shown where a subscription exists but has no number yet. */
export const NO_NUMBER_LABEL = '—'

/**
 * Excel-style 1-based column name: A to Z, then AA to AZ, then BA.
 *
 * The "+1" then "-1" around each step is what makes it bijective, so 26 is "Z"
 * and 27 is "AA" rather than rolling over to "BA".
 */
function letterBlock(block: number): string {
  let n = block + 1
  let out = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    out = String.fromCharCode(65 + rem) + out
    n = Math.floor((n - 1) / 26)
  }
  return out
}

/**
 * The printed form of a weekly number.
 *
 * Returns the "no number" dash rather than an empty string so callers can put
 * it straight on screen without branching.
 */
export function weeklyNumberLabel(number: number | null | undefined): string {
  if (number == null || !Number.isFinite(number)) return NO_NUMBER_LABEL
  const n = Math.floor(number)
  if (n <= 0) return NO_NUMBER_LABEL
  if (n <= PLAIN_MAX) return String(n)
  const offset = n - PLAIN_MAX - 1
  const block = Math.floor(offset / PER_BLOCK)
  if (block >= MAX_BLOCKS) return NO_NUMBER_LABEL
  return `${(offset % PER_BLOCK) + 1}${letterBlock(block)}`
}

/**
 * The inverse of {@link weeklyNumberLabel}, for manual entry and for reading a
 * number back out of a scanned pass.
 *
 * Tolerates the zero padded form ("004") written by earlier versions, so a pass
 * printed before the change still types in. Rejects anything ambiguous rather
 * than guessing, because a wrong number here silently confirms the wrong
 * rider.
 */
export function parseWeeklyNumber(raw: string): number | null {
  const text = raw.trim().toUpperCase()
  if (text === '') return null

  // Plain numbers. Zero padded values from older passes land here too.
  if (/^\d{1,4}$/.test(text)) {
    const n = Number(text)
    if (n < 1 || n > PLAIN_MAX) return null
    return n
  }

  const match = /^(\d{1,4})([A-Z]{1,2})$/.exec(text)
  if (!match) return null

  const digits = Number(match[1])
  // The numeric part is always one of the first thousand. "0A" and "1001A" are
  // outside the scheme, so they are typos rather than valid numbers.
  if (digits < 1 || digits > PLAIN_MAX) return null

  let block = 0
  for (const ch of match[2]) {
    // Reverse of letterBlock: A is 1, and each extra letter shifts by 26.
    const value = ch.charCodeAt(0) - 64
    if (value < 1 || value > 26) return null
    block = block * 26 + value
  }
  block -= 1
  if (block >= MAX_BLOCKS) return null

  const n = PLAIN_MAX + 1 + block * PER_BLOCK + (digits - 1)
  return n <= MAX_WEEKLY_NUMBER ? n : null
}
