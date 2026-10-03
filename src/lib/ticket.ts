import type { WeekDayState } from './date'
import type { PaymentState } from './qr'

/**
 * The rider's pass drawn as one self-contained image.
 *
 * A QR code can only carry text, so the scanned result of any code is going to
 * look plain no matter what is put inside it. This file takes the other half of
 * the job: the same details that are on the panel, flattened into a single SVG
 * that can be saved, shared or printed, with the code still embedded so the
 * saved image scans.
 *
 * Everything is inline and the colours are literal, so the output has no
 * dependency on the app's stylesheet, fonts or network. That is what lets a
 * rider keep the file after the app is gone.
 *
 * The palette is the light one on purpose. This is a ticket: it gets screenshotted
 * and printed, and both of those cope badly with a dark background. The QR plate
 * is white in either case, because that is a scanning requirement, not a style
 * choice.
 */

export interface TicketDay {
  /** Localised short weekday, e.g. "Sat" or "السبت". */
  label: string
  state: WeekDayState
}

/**
 * Already-resolved display strings.
 *
 * Every label arrives translated rather than being looked up here, so this
 * module stays free of the i18n layer and can be checked on its own. Note the
 * asymmetry with the scanned payload: that text is fixed English because a
 * machine parses it, whereas a saved ticket is only ever read by a person.
 */
export interface TicketView {
  brand: string
  idLabel: string
  /** Weekly number as printed, or the localised word for none. */
  number: string
  hasNumber: boolean
  name: string
  weekPrefix: string
  weekRange: string
  days: TicketDay[]
  pickup: string
  pickupLabel: string
  payment: PaymentState
  paymentLabel: string
  statusLabel: string
  /** Merged module path from qrMatrixPath. */
  qrPath: string
  /** Module count of the same grid, so it can be scaled. */
  qrCount: number
}

const PALETTE = {
  card: '#ffffff',
  surface: '#f4f8f4',
  text: '#0d1a0d',
  muted: '#5c6b5c',
  border: '#d8e4d8',
  brand: '#15803d',
  active: '#15803d',
  activeSoft: '#dcfce7',
  expired: '#b91c1c',
  expiredSoft: '#fee2e2',
  pending: '#b45309',
  pendingSoft: '#fef3c7',
  white: '#ffffff',
  black: '#000000'
} as const

/**
 * The app's own stack, repeated here.
 *
 * SVG has no cascade to inherit from, so without this the ticket falls back to
 * the renderer's default face, which is a serif in most of them and would not
 * match the panel it was copied from. Arabic is listed explicitly: a rider
 * without a system Arabic face would otherwise get tofu boxes on their ticket.
 *
 * System faces only, on purpose. Embedding a real font would add hundreds of
 * kilobytes to a file that is meant to be saved and shared over chat, and the
 * document would then need to be self-contained in a way that survives losing
 * the app entirely.
 */
const FONT = "'Segoe UI', system-ui, -apple-system, Tahoma, 'Noto Sans Arabic', sans-serif"

function paymentColors(payment: PaymentState): { fg: string; bg: string } {
  if (payment === 'paid') return { fg: PALETTE.active, bg: PALETTE.activeSoft }
  if (payment === 'unpaid') return { fg: PALETTE.pending, bg: PALETTE.pendingSoft }
  return { fg: PALETTE.expired, bg: PALETTE.expiredSoft }
}

/* ------------------------------- geometry ---------------------------------- */

const WIDTH = 640
const PAD = 32
const INNER = WIDTH - PAD * 2
const RADIUS = 24

/** Side of the drawn code itself, before its quiet zone. */
const QR_SIZE = 380
const DAY_ROW_H = 92
const PICKUP_H = 60
const FOOTER_H = 78

/**
 * Text has to be cut to fit, and SVG will not do that for us.
 *
 * There is no text measurement in a pure string builder, so widths are
 * estimated from per-character ratios. The estimate is deliberately generous:
 * its only job is to catch the genuinely long values, and over-measuring merely
 * shortens a name a little early. Where it matters the numbers below are the
 * ones that were checked against a rendered result.
 */
const NARROW = new Set(['i', 'l', 'j', 'I', 't', 'f', 'r', ' ', '.', ',', ':', ';', "'", '|', '(', ')'])
const WIDE = new Set(['m', 'w', 'M', 'W', '@', '%'])

function charEm(ch: string): number {
  if (NARROW.has(ch)) return 0.3
  if (WIDE.has(ch)) return 0.85
  // Arabic and other connected scripts sit narrower than latin on average, and
  // the ticket is read in both.
  const code = ch.codePointAt(0) ?? 0
  if (code >= 0x0600 && code <= 0x06ff) return 0.52
  if (code > 0x2e80) return 1
  return 0.55
}

function estimateWidth(text: string, fontSize: number): number {
  let ems = 0
  for (const ch of text) ems += charEm(ch)
  return ems * fontSize
}

/** Shortens text until it fits, appending an ellipsis when it has to cut. */
function fit(text: string, fontSize: number, maxWidth: number): string {
  if (estimateWidth(text, fontSize) <= maxWidth) return text
  const ellipsis = '\u2026'
  const budget = maxWidth - estimateWidth(ellipsis, fontSize)
  let used = 0
  let out = ''
  for (const ch of text) {
    const w = charEm(ch) * fontSize
    if (used + w > budget) break
    out += ch
    used += w
  }
  return `${out.replace(/\s+$/, '')}${ellipsis}`
}

/**
 * Controls and newlines have no meaning in SVG text. Stripping them also stops a
 * name that was pasted with a line break from silently pushing the layout down.
 *
 * Written as a filter rather than a regex so the range of removed characters is
 * stated as the thing it is: code points that cannot appear in text.
 */
function clean(value: string): string {
  let out = ''
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0
    out += code < 0x20 || code === 0x7f ? ' ' : ch
  }
  return out.replace(/\s+/g, ' ').trim()
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function roundRect(x: number, y: number, w: number, h: number, r: number): string {
  const c = Math.min(r, w / 2, h / 2)
  return (
    `M${x + c} ${y}h${w - 2 * c}a${c} ${c} 0 0 1 ${c} ${c}v${h - 2 * c}` +
    `a${c} ${c} 0 0 1 ${-c} ${c}h${-(w - 2 * c)}a${c} ${c} 0 0 1 ${-c} ${-c}` +
    `v${-(h - 2 * c)}a${c} ${c} 0 0 1 ${c} ${-c}z`
  )
}

/** Same, with the bottom corners left square, for the footer's full-bleed band. */
function bottomBand(x: number, y: number, w: number, h: number, r: number): string {
  return `M${x} ${y}h${w}v${h - r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - 2 * r)}` +
    `a${r} ${r} 0 0 1 ${-r} ${-r}z`
}

function text(
  value: string,
  x: number,
  y: number,
  size: number,
  fill: string,
  weight = 600,
  anchor: 'start' | 'middle' | 'end' = 'start'
): string {
  return (
    `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}" ` +
    `text-anchor="${anchor}" dominant-baseline="alphabetic">${esc(value)}</text>`
  )
}

/* --------------------------------- drawing --------------------------------- */

/** The map pin from Icons.tsx, in its own 24x24 space, scaled into place. */
function pin(x: number, y: number, size: number, fill: string): string {
  const s = size / 24
  return (
    `<g transform="translate(${x} ${y}) scale(${s})" fill="none" stroke="${fill}" ` +
    `stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">` +
    '<path d="M12 21s7-5.7 7-11a7 7 0 1 0-14 0c0 5.3 7 11 7 11z"/>' +
    '<circle cx="12" cy="10" r="2.75"/></g>'
  )
}

function dayCell(x: number, y: number, w: number, h: number, day: TicketDay): string {
  const label = clean(day.label)
  const ride = day.state === 'ride'
  const closed = day.state === 'closed'
  const cx = x + w / 2

  let bg: string = PALETTE.surface
  let stroke = 'none'
  let strokeOpacity = 1
  let fg: string = PALETTE.muted
  if (ride) {
    bg = PALETTE.activeSoft
    stroke = PALETTE.active
    strokeOpacity = 0.25
    fg = PALETTE.active
  } else if (closed) {
    bg = 'none'
    stroke = PALETTE.border
  }

  const dot = ride
    ? `<circle cx="${cx}" cy="${y + 40}" r="5" fill="${PALETTE.active}"/>`
    : `<circle cx="${cx}" cy="${y + 40}" r="4.5" fill="none" stroke="${PALETTE.muted}" ` +
      `stroke-width="1.6" opacity="${closed ? 0.4 : 0.7}"/>`

  const parts = [
    // Stroke opacity rather than an rgba() colour: rgba in a presentation
    // attribute is not honoured everywhere this gets drawn.
    `<path d="${roundRect(x, y, w, h, 12)}" fill="${bg}" stroke="${stroke}" ` +
      `stroke-opacity="${strokeOpacity}"${closed ? ' stroke-dasharray="4 3"' : ''}/>`,
    text(fit(label, 15, w - 8), cx, y + 20, 15, fg, 700, 'middle'),
    dot
  ]

  if (closed) {
    // Struck through by hand rather than with text-decoration, which not every
    // rasteriser honours, and this output does get drawn to a canvas.
    const half = Math.min(estimateWidth(label, 15) / 2, (w - 12) / 2)
    parts.push(
      `<path d="M${cx - half} ${y + 15.5}h${half * 2}" stroke="${PALETTE.muted}" ` +
        'stroke-width="1.4" opacity="0.55"/>'
    )
  }

  return parts.join('')
}

/**
 * The whole pass as one SVG document.
 *
 * Returns null only when there is no code to draw, so a caller cannot end up
 * saving a ticket with an empty box where the QR should be.
 */
export function ticketSvg(view: TicketView): string | null {
  if (!view.qrPath || view.qrCount <= 0) return null

  const pay = paymentColors(view.payment)
  const name = clean(view.name)
  const pickup = clean(view.pickup)
  const weekRange = clean(view.weekRange)

  let y = PAD

  const brandY = y + 28
  y += 62
  const idLabelY = y
  y += 66
  const idY = y
  y += 30
  const nameY = y + 26
  y += 46
  const weekY = y
  y += 34

  const perfY = y
  y = perfY + 30

  const module = QR_SIZE / view.qrCount
  // Four modules of quiet zone is the spec, and it has to scale with the symbol
  // or a long name, which pushes the code to a bigger version, loses it.
  const quiet = Math.ceil(module * 4)
  const plate = QR_SIZE + quiet * 2
  const plateX = Math.round((WIDTH - plate) / 2)
  const plateY = y
  y = plateY + plate + 26

  const gap = 8
  // Left as an exact fraction rather than floored: seven equal columns that
  // divide the width evenly, so the strip is symmetric in the card. Flooring
  // left a few stray pixels on one side that are visible at this size.
  const cellW = (INNER - gap * 6) / 7
  const daysY = y
  y = daysY + DAY_ROW_H + 18

  const pickupY = y
  y = pickupY + PICKUP_H + 18

  const footerY = y
  const height = footerY + FOOTER_H

  const pillW = Math.min(190, estimateWidth(view.statusLabel, 15) + 52)
  const pillX = WIDTH - PAD - pillW

  const body = [
    // Header: brand, then the weekly number as the largest thing on the ticket,
    // which is the number a driver calls out.
    text(fit(clean(view.brand), 28, INNER), PAD, brandY, 28, PALETTE.brand, 700),
    `<text x="${PAD}" y="${idLabelY}" font-size="15" font-weight="700" fill="${PALETTE.muted}" ` +
      `letter-spacing="2">${esc(clean(view.idLabel).toUpperCase())}</text>`,
    // Fitted like the lines around it: the scheme can produce a longer number
    // such as "1000Z", and this is the one line nobody wants clipped because a
    // driver reads it out loud.
    text(fit(clean(view.number), 64, INNER), PAD, idY, 64, view.hasNumber ? PALETTE.active : PALETTE.expired, 800),

    text(fit(name, 34, INNER), PAD, nameY, 34, PALETTE.text, 700),
    text(fit(`${clean(view.weekPrefix)} ${weekRange}`, 20, INNER), PAD, weekY, 20, PALETTE.muted, 500),

    // The punched line, with the two notches cut out of the card edge.
    `<path d="M${PAD} ${perfY}h${INNER}" stroke="${PALETTE.border}" stroke-width="2" ` +
      'stroke-dasharray="7 6"/>',
    `<circle cx="${PAD - 14}" cy="${perfY}" r="13" fill="${PALETTE.card}"/>`,
    `<circle cx="${WIDTH - PAD + 14}" cy="${perfY}" r="13" fill="${PALETTE.card}"/>`,

    // The code, on its own white plate with the quiet zone around it.
    `<path d="${roundRect(plateX, plateY, plate, plate, 18)}" fill="${PALETTE.white}"/>`,
    `<g transform="translate(${plateX + quiet} ${plateY + quiet}) scale(${module})">` +
      `<rect width="${view.qrCount}" height="${view.qrCount}" fill="${PALETTE.white}"/>` +
      `<path d="${view.qrPath}" fill="${PALETTE.black}"/></g>`,

    // The whole week, not just the chosen days, so Thursday and Friday show up
    // as days the service does not run.
    view.days
      .slice(0, 7)
      .map((day, i) => dayCell(PAD + i * (cellW + gap), daysY, cellW, DAY_ROW_H, day))
      .join(''),

    `<path d="${roundRect(PAD, pickupY, INNER, PICKUP_H, 14)}" fill="${PALETTE.surface}"/>`,
    pin(PAD + 16, pickupY + 18, 24, PALETTE.brand),
    `<text x="${PAD + 52}" y="${pickupY + 25}" font-size="14" font-weight="700" ` +
      `fill="${PALETTE.muted}" letter-spacing="1">${esc(clean(view.pickupLabel).toUpperCase())}</text>`,
    text(fit(pickup, 21, INNER - 68), PAD + 52, pickupY + 48, 21, PALETTE.text, 600),

    // Footer: the state of the ticket as a whole, not one more field in a list.
    `<path d="${bottomBand(0, footerY, WIDTH, FOOTER_H, RADIUS)}" fill="${pay.bg}"/>`,
    `<path d="M0 ${footerY}h${WIDTH}" stroke="${PALETTE.border}" stroke-width="1"/>`,
    `<circle cx="${PAD + 9}" cy="${footerY + FOOTER_H / 2}" r="7" fill="${pay.fg}"/>`,
    text(fit(clean(view.paymentLabel), 21, pillX - PAD - 40), PAD + 26, footerY + FOOTER_H / 2 + 8, 21, pay.fg, 700),
    `<path d="${roundRect(pillX, footerY + FOOTER_H / 2 - 17, pillW, 34, 17)}" ` +
      `fill="${PALETTE.card}" opacity="0.9"/>`,
    `<circle cx="${pillX + 17}" cy="${footerY + FOOTER_H / 2}" r="4.5" fill="${pay.fg}"/>`,
    text(clean(view.statusLabel), pillX + 30, footerY + FOOTER_H / 2 + 6, 15, PALETTE.text, 700)
  ].join('')

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" ` +
    `viewBox="0 0 ${WIDTH} ${height}" role="img" font-family="${FONT}" ` +
    `aria-label="${esc(`${clean(view.idLabel)} ${clean(view.number)} ${name}`)}">` +
    `<title>${esc(name)}</title>` +
    `<path d="${roundRect(0, 0, WIDTH, height, RADIUS)}" fill="${PALETTE.card}"/>` +
    `<clipPath id="ticket-clip"><path d="${roundRect(0, 0, WIDTH, height, RADIUS)}"/></clipPath>` +
    `<g clip-path="url(#ticket-clip)">${body}</g>` +
    '</svg>'
  )
}

/* -------------------------------- exporting -------------------------------- */

/**
 * Rasterises the ticket to a PNG.
 *
 * The SVG is loaded through a data URL rather than written to a file so the
 * whole thing stays in memory and works on a phone straight from a saved file.
 * Nothing external is referenced, so the canvas is never tainted and the export
 * succeeds under the file:// origin that the rest of the app supports.
 */
export async function ticketPng(svg: string, scale = 2): Promise<Blob | null> {
  if (typeof document === 'undefined') return null
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  const img = new Image()
  img.decoding = 'sync'

  const loaded = await new Promise<boolean>((resolve) => {
    img.onload = () => resolve(true)
    img.onerror = () => resolve(false)
    img.src = url
  })
  if (!loaded) return null

  const width = img.naturalWidth || Number(/width="(\d+)"/.exec(svg)?.[1] ?? 0)
  const height = img.naturalHeight || Number(/height="(\d+)"/.exec(svg)?.[1] ?? 0)
  if (width <= 0 || height <= 0) return null

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * scale)
  canvas.height = Math.round(height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  // Opaque on purpose: a transparent PNG would show whatever is behind it once
  // it lands in a gallery or a message.
  ctx.fillStyle = PALETTE.white
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
}

/** A filename that sorts sensibly and carries the weekly number. */
export function ticketFileName(number: string | null, weekStart: string): string {
  const id = number && number !== '' ? `-${number}` : ''
  return `nvu-bus${id}-${weekStart}.png`
}