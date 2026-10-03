import { describe, it, expect } from 'vitest'
import {
  buildQrPayload,
  decodeQrPayload,
  encodeQrPayload,
  paymentStateFor,
  QR_PREFIX
} from './qr'
import { SELECTABLE_DAYS } from './date'

/**
 * The QR layer is the one place where a mistake cannot be undone by a code
 * change: passes are printed, laminated and handed to riders. Every test here
 * also covers a generation of the format that is no longer written, because
 * those codes are still sitting in people's wallets.
 */
const rider = {
  name: 'ahmed adel',
  number: 1 as number | null,
  days: SELECTABLE_DAYS,
  pickup: 'University Gate',
  status: 'subscribed' as const,
  weekStart: '2026-09-26'
}

describe('buildQrPayload', () => {
  it('carries the weekly number in printed form', () => {
    expect(buildQrPayload({ ...rider, number: 7 }).q).toBe('7')
    // The lettered form has to reach the code as text, or a scan comes back
    // with a number nobody can match against the books.
    expect(buildQrPayload({ ...rider, number: 1001 }).q).toBe('1A')
    expect(buildQrPayload({ ...rider, number: 27001 }).q).toBe('1AA')
  })

  it('leaves the number empty when there is none', () => {
    expect(buildQrPayload({ ...rider, number: null }).q).toBe('')
  })

  it('normalises days so a code cannot carry a duplicate or bad day', () => {
    // Deduped, out of range dropped, and returned in week order.
    expect(buildQrPayload({ ...rider, days: [3, 3, 6, 0] }).d).toEqual([6, 0, 3])
    expect(buildQrPayload({ ...rider, days: [99, 4] }).d).toEqual([])
    expect(buildQrPayload({ ...rider, days: null }).d).toEqual([])
  })
})

describe('encode then decode', () => {
  it('round trips every field, including a lettered number', () => {
    for (const number of [null, 1, 999, 1000, 1001, 2000, 2001, 27000]) {
      const payload = buildQrPayload({ ...rider, number })
      const back = decodeQrPayload(encodeQrPayload(payload))
      expect(back, `number ${number} should decode`).not.toBeNull()
      expect(back?.q).toBe(payload.q)
      expect(back?.n).toBe(payload.n)
      expect(back?.p).toBe(payload.p)
      expect(back?.w).toBe(payload.w)
      expect(back?.s).toBe(payload.s)
      expect(back?.d).toEqual(payload.d)
    }
  })

  it('writes the current brand on the first line', () => {
    const text = encodeQrPayload(buildQrPayload({ ...rider, number: 1 }))
    expect(text.split('\n')[0]).toContain(QR_PREFIX)
  })

  it('forces free text onto one line so the layout survives', () => {
    // A newline in a name would split one field across two lines and shift
    // every label after it, so it is collapsed on the way out.
    const text = encodeQrPayload(
      buildQrPayload({ ...rider, number: 1, name: 'line one\nline two', pickup: 'a\rb' })
    )
    expect(text).toContain('Name: line one line two')
    expect(text).toContain('Pickup: a b')
    expect(decodeQrPayload(text)?.n).toBe('line one line two')
  })
})

describe('paymentStateFor', () => {
  it('maps subscription state to what a driver is told', () => {
    expect(paymentStateFor('subscribed')).toBe('paid')
    expect(paymentStateFor('pending')).toBe('unpaid')
    expect(paymentStateFor('none')).toBe('none')
  })
})

describe('decoding passes written by earlier versions', () => {
  /**
   * Each block below is a real generation of the format, still in circulation.
   * They are built by hand rather than through the encoder on purpose: using
   * today's encoder to test today's decoder would pass even if the format
   * itself changed.
   */
  const RULE = '\u2501'

  it('reads the pre-rename brand, so passes printed before the rename still scan', () => {
    const text = [
      `${RULE}${RULE} \u{1F68C} ProjectBus ${RULE.repeat(12)}`,
      `\u{1F464} Name: legacy rider`,
      `\u{1F3AB} ID: 004`,
      `\u{1F4CD} Pickup: University Gate`,
      `\u{1F4C5} Days: Sat Sun Mon Tue Wed`,
      `\u{1F5D3} Week: 26 Sep - 2 Oct 2026`,
      RULE.repeat(40),
      '\u{1F7E2} Paid'
    ].join('\n')
    const back = decodeQrPayload(text)
    expect(back?.n).toBe('legacy rider')
    // "004" was written by the old three digit scheme. It has to resolve to the
    // same number the app holds today, or a printed pass stops matching.
    expect(back?.q).toBe('4')
    expect(back?.s).toBe('subscribed')
  })

  it('reads the flat layout, which had no card frame', () => {
    // The first readable version: a header line then "Label: value" lines, with
    // no closing rule. The rule-less shape is what makes the parser fall back
    // to reading payment from its own label.
    const text = [
      'ProjectBus',
      'Name: flat rider',
      'ID: 012',
      'Pickup: Stadium',
      'Days: Sat Sun Mon Tue Wed',
      'Week: 26 Sep - 2 Oct 2026',
      'Payment: Paid'
    ].join('\n')
    const back = decodeQrPayload(text)
    expect(back?.n).toBe('flat rider')
    expect(back?.q).toBe('12')
    expect(back?.s).toBe('subscribed')
  })

  it('reads the flat layout under the current brand too', () => {
    const text = [
      QR_PREFIX,
      'Name: flat rider',
      'ID: 012',
      'Pickup: Stadium',
      'Days: Sat Sun Mon Tue Wed',
      'Week: 26 Sep - 2 Oct 2026',
      'Payment: Paid'
    ].join('\n')
    expect(decodeQrPayload(text)?.q).toBe('12')
  })

  it('reads the original compact JSON codes', () => {
    const json = JSON.stringify({
      n: 'json rider',
      q: '004',
      d: [6, 0, 1, 2, 3],
      p: 'University Gate',
      s: 'subscribed',
      w: '2026-09-26'
    })
    const back = decodeQrPayload(`PB1:${json}`)
    expect(back?.n).toBe('json rider')
    expect(back?.q).toBe('4')
    expect(back?.s).toBe('subscribed')
  })

  it('treats a JSON record with no stored days as the full selectable week', () => {
    // Matches how subDays reads legacy data, so the card and the books agree.
    const json = JSON.stringify({ n: 'old rider', w: '2026-09-26', s: 'subscribed' })
    expect(decodeQrPayload(`PB1:${json}`)?.d).toEqual([...SELECTABLE_DAYS])
  })

  it('keeps an explicitly empty day list empty', () => {
    // An empty list is a real answer, meaning no subscription, and must not be
    // backfilled to the full week.
    const json = JSON.stringify({ n: 'rider', w: '2026-09-26', s: 'none', d: [] })
    expect(decodeQrPayload(`PB1:${json}`)?.d).toEqual([])
  })

  it('drops a weekly number it cannot read rather than pass it through', () => {
    // A malformed number shown on screen would be worse than none: it looks
    // authoritative and matches nobody.
    const text = [
      QR_PREFIX,
      RULE.repeat(12),
      'Name: rider',
      'ID: not-a-number',
      'Pickup: Stadium',
      'Days: Sat Sun Mon Tue',
      'Week: 26 Sep - 2 Oct 2026',
      RULE.repeat(40),
      'Paid'
    ].join('\n')
    expect(decodeQrPayload(text)?.q).toBe('')
  })
})

describe('decoding rejects anything that is not our pass', () => {
  it('returns null for unrelated and empty text', () => {
    expect(decodeQrPayload('')).toBeNull()
    expect(decodeQrPayload('hello')).toBeNull()
    expect(decodeQrPayload('https://example.com')).toBeNull()
    // A QR that starts like ours but is truncated must not half-resolve.
    expect(decodeQrPayload(`${QR_PREFIX}\nName: x`)).toBeNull()
  })
})
