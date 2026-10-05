import qrcode from 'qrcode-generator'
import { addDays, fromISO, normalizeDays, SELECTABLE_DAYS } from './date'
import { weeklyNumberLabel, parseWeeklyNumber } from './weeklyNumber'
import type { SubStatus } from './types'

/* -------------------------------- payload ---------------------------------- */

/**
 * What a rider's QR carries. The keys are short because every character costs QR
 * density, but nothing about this is written into the code itself: the scanned
 * text is a readable block, not this object. See encodeQrPayload.
 *
 * Note there is one pickup field, not a place plus a line. They are the same
 * thing throughout the app, so the code carries it once.
 */
export interface QrPayload {
  /** Rider name. */
  n: string
  /** Weekly queue number in printed form, such as "7" or "1A". Empty when not subscribed. */
  q: string
  /** Pickup days as JS day numbers (0 = Sunday), in week order. */
  d: number[]
  /** Pickup place, which is also the pickup line. */
  p: string
  /** Subscription state, which is what payment status is derived from. */
  s: SubStatus
  /** ISO date of the week this code is for. */
  w: string
}

/**
 * First line of the scanned text. It identifies the code as ours so a scanner
 * can tell it apart from any other QR, and its presence is what marks the
 * version.
 *
 * Written into every new code, but renaming it did not retire the old one:
 * passes are printed and kept, so the previous spelling stays in
 * ACCEPTED_PREFIXES and codes already in circulation still scan.
 */
export const QR_PREFIX = 'NVU-BUS'

/** The original JSON payload. Still decoded, since codes may already exist. */
const LEGACY_PREFIX = 'PB1:'

/**
 * Every prefix this build still reads.
 *
 * The first is the original JSON format. The second is the pre-rename card
 * format, kept so a pass printed before the rename is not suddenly rejected by
 * the driver's phone.
 */
const ACCEPTED_PREFIXES = [QR_PREFIX, 'ProjectBus', LEGACY_PREFIX] as const

/**
 * Labels in the scanned text are English on purpose. A scanner parses these
 * lines, so they must not change when the app is switched to Arabic; the
 * rider-facing panel is where localisation belongs.
 */
const LABELS = {
  name: 'Name',
  id: 'ID',
  pickup: 'Pickup',
  days: 'Days',
  week: 'Week'
} as const

/**
 * Day abbreviations, fixed rather than taken from Intl. The scanned text has to
 * look and read the same regardless of the phone's locale, and the parser
 * depends on these exact spellings.
 */
const DAY_LABEL: Record<number, string> = {
  6: 'Sat',
  0: 'Sun',
  1: 'Mon',
  2: 'Tue',
  3: 'Wed',
  4: 'Thu',
  5: 'Fri'
}

const DAY_BY_LABEL: Record<string, number> = Object.fromEntries(
  Object.entries(DAY_LABEL).map(([day, label]) => [label, Number(day)])
)

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const PAYMENT_LABEL: Record<PaymentState, string> = {
  paid: 'Paid',
  unpaid: 'Unpaid',
  none: 'Not subscribed'
}

/** Shown in place of a value the rider has not got, e.g. no weekly number. */
const NONE_LABEL = 'none'

export function buildQrPayload(input: {
  name: string
  number: number | null
  days: readonly number[] | null | undefined
  pickup: string | null
  status: SubStatus
  weekStart: string
}): QrPayload {
  return {
    n: input.name.trim(),
    q: input.number === null ? '' : weeklyNumberLabel(input.number),
    // Days are normalised so the code never carries a duplicate or an
    // out-of-range value, whatever is in storage.
    d: normalizeDays(input.days),
    p: (input.pickup ?? '').trim(),
    s: input.status,
    w: input.weekStart
  }
}

/**
 * Reads a weekly number off a pass back to its stored integer form, then prints
 * it again in the current scheme. Keeps "004" from an older pass resolving as
 * 4, and "1A" resolving as 1001, so the rest of the app only ever deals with one
 * representation.
 */
function canonicalNumber(raw: string): string {
  const n = parseWeeklyNumber(raw)
  return n === null ? '' : weeklyNumberLabel(n)
}

/**
 * Forces a value onto one line.
 *
 * Names and pickup spots come from free text, so one containing a newline would
 * otherwise break the line-per-field layout the parser relies on. A line break
 * becoming a space is also what the reader would have wanted anyway.
 */
function oneLine(value: string): string {
  return value.replace(/[\r\n\t]+/g, ' ').trim()
}

/**
 * "26 Sep - 2 Oct 2026". Written by hand rather than through Intl because the
 * output is parsed back, so it has to be identical on every device, and because
 * locale data is not guaranteed to spell September the same way everywhere.
 */
function formatWeekLabel(weekStart: string): string {
  const start = fromISO(weekStart)
  const end = addDays(start, 6)
  return `${start.getDate()} ${MONTHS[start.getMonth()]} - ${end.getDate()} ${MONTHS[end.getMonth()]} ${end.getFullYear()}`
}

/** The inverse of formatWeekLabel, for reading a week back out of the text. */
function parseWeekLabel(label: string): string | null {
  const m = /^(\d{1,2}) ([A-Z][a-z]{2}) - (\d{1,2}) ([A-Z][a-z]{2}) (\d{4})$/.exec(label.trim())
  if (!m) return null
  const startMonth = MONTHS.indexOf(m[2])
  const endMonth = MONTHS.indexOf(m[4])
  if (startMonth < 0 || endMonth < 0) return null
  // A week is seven days, so it only crosses into a new year when the end month
  // is earlier in the year than the start. Year zero is rejected below.
  const endYear = Number(m[5])
  const startYear = endMonth < startMonth ? endYear - 1 : endYear
  const start = new Date(startYear, startMonth, Number(m[1]))
  // Reject impossible dates such as 31 September, which Date would roll over
  // into the next month and quietly return the wrong week.
  if (start.getMonth() !== startMonth || start.getDate() !== Number(m[1])) return null
  if (startYear < 100) return null
  return toIso(start)
}

function toIso(date: Date): string {
  const y = String(date.getFullYear()).padStart(4, '0')
  return `${y}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/**
 * The scanned text is a card, not a list.
 *
 * Framing it costs QR density: every box-drawing character is three bytes in
 * UTF-8, so a full bordered box ran to version 22 and about two pixels per
 * module on a phone screen, which will not reliably scan. Rules top and bottom
 * give the card its shape for roughly half that cost, and the icons carry the
 * colour, because emoji are the only thing that renders as actual colour in the
 * plain text a phone scanner shows.
 *
 * The labels are unchanged so the card stays parseable: a reader looks for
 * "ID: " anywhere in a line, which means the icon in front of it is decoration
 * and cannot break the parse.
 */
const RULE = '\u2501'
const CARD_WIDTH = 30

/**
 * Label used by the first readable version, which had no card frame. It is only
 * read, never written, so codes produced before the card layout keep their
 * payment state.
 */
const FLAT_PAYMENT_LABEL = 'Payment'

const ICONS = {
  brand: '\u{1F68C}',
  name: '\u{1F464}',
  id: '\u{1F3AB}',
  pickup: '\u{1F4CD}',
  days: '\u{1F4C5}',
  week: '\u{1F5D3}'
} as const

/** Coloured squares, which is what actually shows colour in a text view. */
const STATE_ICON: Record<PaymentState, string> = {
  paid: '\u{1F7E2}',
  unpaid: '\u{1F7E1}',
  none: '\u{1F534}'
}

function headerRule(): string {
  const brand = `${ICONS.brand} ${QR_PREFIX}`
  return `${RULE}${RULE} ${brand} ${RULE.repeat(Math.max(3, CARD_WIDTH - brand.length - 4))}`
}

/**
 * The text a scanner receives.
 *
 * A driver scanning at the door wants a card they can read at a glance, and the
 * same text has to stay usable if the scan is shown to them by hand. Each field
 * keeps its "Label: value" pair so it parses without the JSON shape.
 */
export function encodeQrPayload(payload: QrPayload): string {
  const days = SELECTABLE_DAYS.filter((d) => payload.d.includes(d)).map((d) => DAY_LABEL[d])
  const payment = paymentStateFor(payload.s)
  return [
    headerRule(),
    `${ICONS.name} ${LABELS.name}: ${oneLine(payload.n) || NONE_LABEL}`,
    `${ICONS.id} ${LABELS.id}: ${payload.q || NONE_LABEL}`,
    `${ICONS.pickup} ${LABELS.pickup}: ${oneLine(payload.p) || NONE_LABEL}`,
    `${ICONS.days} ${LABELS.days}: ${days.length > 0 ? days.join(' ') : NONE_LABEL}`,
    `${ICONS.week} ${LABELS.week}: ${formatWeekLabel(payload.w)}`,
    RULE.repeat(CARD_WIDTH),
    `${STATE_ICON[payment]} ${PAYMENT_LABEL[payment]}`
  ].join('\n')
}

/** Reads a payload back, returning null for anything that is not one of ours. */
export function decodeQrPayload(text: string): QrPayload | null {
  const legacy = decodeLegacy(text)
  if (legacy) return legacy
  const lines = text.split('\n')
  if (!lines[0] || !ACCEPTED_PREFIXES.some((p) => lines[0].includes(p))) return null

  // Labels are matched anywhere in a line rather than by position, so the
  // leading icon and the rules are decoration that cannot break a parse.
  const fields = new Map<string, string>()
  for (const line of lines) {
    for (const label of Object.values(LABELS)) {
      const at = line.indexOf(`${label}: `)
      if (at >= 0 && !fields.has(label)) fields.set(label, line.slice(at + label.length + 2).trim())
    }
  }

  const name = fields.get(LABELS.name)
  const week = fields.get(LABELS.week)
  if (name === undefined || week === undefined) return null
  const weekStart = parseWeekLabel(week)
  if (weekStart === null) return null

  const id = fields.get(LABELS.id) ?? ''
  // Payment is read from the line under the closing rule, so a rider whose name
  // happens to contain a status word cannot be mistaken for one. Codes from the
  // earlier flat layout have no rule, so they fall back to their own label.
  const ruleAt = lines.findIndex((l, i) => i > 0 && new RegExp(`^${RULE}{3,}$`).test(l))
  let status: SubStatus = 'none'
  if (ruleAt >= 0) {
    const footer = (lines[ruleAt + 1] ?? '').replace(/[^\x20-\x7E]/g, ' ').trim()
    status =
      footer === PAYMENT_LABEL.paid ? 'subscribed' : footer === PAYMENT_LABEL.unpaid ? 'pending' : 'none'
  } else {
    for (const line of lines) {
      const at = line.indexOf(`${FLAT_PAYMENT_LABEL}: `)
      if (at < 0) continue
      const value = line.slice(at + FLAT_PAYMENT_LABEL.length + 2).trim()
      status =
        value === PAYMENT_LABEL.paid ? 'subscribed' : value === PAYMENT_LABEL.unpaid ? 'pending' : 'none'
      break
    }
  }

  const dayText = fields.get(LABELS.days) ?? ''
  const days = normalizeDays(
    dayText
      .split(/[,\s]+/)
      .map((d) => DAY_BY_LABEL[d.trim()])
      .filter((d): d is number => d !== undefined)
  )

  const pickup = fields.get(LABELS.pickup) ?? ''
  return {
    n: name === NONE_LABEL ? '' : name,
    // Normalised through the parser so a pass printed before the scheme change
    // ("004") comes back in the current form ("4"), and anything unreadable is
    // dropped rather than passed through to be shown as a number.
    q: canonicalNumber(id),
    d: days,
    p: pickup === NONE_LABEL ? '' : pickup,
    s: status,
    w: weekStart
  }
}

/**
 * Reads the original compact JSON codes. Kept so a QR generated before this
 * change still resolves rather than showing up as an unrecognised code.
 */
function decodeLegacy(text: string): QrPayload | null {
  if (!text.startsWith(LEGACY_PREFIX)) return null
  try {
    const raw: unknown = JSON.parse(text.slice(LEGACY_PREFIX.length))
    if (typeof raw !== 'object' || raw === null) return null
    const o = raw as Record<string, unknown>
    if (typeof o.n !== 'string' || typeof o.w !== 'string') return null
    const status = o.s
    if (status !== 'none' && status !== 'pending' && status !== 'subscribed') return null
    // An absent or malformed day list means an older record, which is the full
    // selectable week, matching how subDays reads legacy data. A present but
    // empty list is a real answer: the rider has no subscription, so it must
    // stay empty rather than being filled in here.
    const days = Array.isArray(o.d)
      ? normalizeDays(o.d.filter((x): x is number => typeof x === 'number'))
      : [...SELECTABLE_DAYS]
    return {
      n: o.n,
      q: canonicalNumber(typeof o.q === 'string' ? o.q : ''),
      d: days,
      p: typeof o.p === 'string' ? o.p : '',
      s: status,
      w: o.w
    }
  } catch {
    return null
  }
}

/* --------------------------- payment status -------------------------------- */

export type PaymentState = 'none' | 'unpaid' | 'paid'

/**
 * Payment state is not stored separately. It follows the subscription, because
 * the weekly number is only ever issued on subscribe and the admin confirms
 * payment by moving the record to subscribed.
 */
export function paymentStateFor(status: SubStatus): PaymentState {
  if (status === 'subscribed') return 'paid'
  if (status === 'pending') return 'unpaid'
  return 'none'
}

/* -------------------------------- encoding --------------------------------- */

/**
 * The library's default encoder is latin1, which silently mangles Arabic names
 * into garbage bytes. Since riders can be named in Arabic, every code is
 * encoded as UTF-8 instead. The library looks this up per call, so assigning it
 * once covers the whole app.
 */
function utf8Bytes(s: string): number[] {
  const out: number[] = []
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0
    if (cp < 0x80) {
      out.push(cp)
    } else if (cp < 0x800) {
      out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f))
    } else if (cp < 0x10000) {
      out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f))
    } else {
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f)
      )
    }
  }
  return out
}

qrcode.stringToBytes = utf8Bytes

/**
 * Error correction M. Higher levels add redundancy but push the symbol into a
 * larger version, and this payload is small enough that a mid level still
 * tolerates the smudges and low light of a phone screen.
 */
export const QR_ERROR_CORRECTION = 'M' as const

/**
 * The raw module grid for a string, or null when it cannot be encoded.
 *
 * Level M tops out at version 40, which is far more than this payload needs;
 * the null return is here so an overflowing payload degrades to a message
 * rather than a corrupt code.
 */
export function qrMatrix(text: string): { count: number; isDark: (row: number, col: number) => boolean } | null {
  try {
    const qr = qrcode(0, QR_ERROR_CORRECTION)
    qr.addData(text)
    qr.make()
    const count = qr.getModuleCount()
    if (count <= 0) return null
    return { count, isDark: (row, col) => qr.isDark(row, col) }
  } catch {
    return null
  }
}

/**
 * The grid as an SVG path, one subpath per dark module. Merging the modules
 * into a single path keeps the DOM small, which matters on a low-end phone.
 */
export function qrMatrixPath(matrix: { count: number; isDark: (r: number, c: number) => boolean }): string {
  let d = ''
  for (let row = 0; row < matrix.count; row += 1) {
    for (let col = 0; col < matrix.count; col += 1) {
      if (matrix.isDark(row, col)) d += `M${col} ${row}h1v1h-1z`
    }
  }
  return d
}