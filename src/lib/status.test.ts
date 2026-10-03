import { describe, expect, it } from 'vitest'
import {
  PAYMENT_LABEL_KEY,
  SUB_STATUS_LABEL,
  dayCountLabelKey,
  dayStateLabelKey,
  weekTitleKey
} from './status'

describe('PAYMENT_LABEL_KEY', () => {
  it('has a key for every payment state a pass can show', () => {
    expect(Object.keys(PAYMENT_LABEL_KEY).sort()).toEqual(['none', 'paid', 'unpaid'])
  })

  it('names money separately from the subscription status it follows', () => {
    expect(PAYMENT_LABEL_KEY.paid).toBe('paid')
    expect(PAYMENT_LABEL_KEY.unpaid).toBe('unpaid')
  })

  it('falls back to notSubscribed when there is no subscription', () => {
    expect(PAYMENT_LABEL_KEY.none).toBe('notSubscribed')
  })
})

describe('dayCountLabelKey', () => {
  it('labels a four day week', () => {
    expect(dayCountLabelKey(4)).toBe('fourDays')
  })

  it('labels a five day week', () => {
    expect(dayCountLabelKey(5)).toBe('fiveDays')
  })

  it('treats anything else as a full week', () => {
    expect(dayCountLabelKey(0)).toBe('fiveDays')
    expect(dayCountLabelKey(3)).toBe('fiveDays')
  })
})

describe('dayStateLabelKey', () => {
  it('names a day the rider rides', () => {
    expect(dayStateLabelKey('ride')).toBe('rides')
  })

  it('words a non-running day apart from a rest day', () => {
    expect(dayStateLabelKey('closed')).toBe('notRun')
    expect(dayStateLabelKey('off')).toBe('off')
    expect(dayStateLabelKey('closed')).not.toBe(dayStateLabelKey('off'))
  })
})

describe('weekTitleKey', () => {
  const current = '2026-10-03'
  const next = '2026-10-10'

  it('calls the week in progress this week', () => {
    expect(weekTitleKey(current, current)).toBe('thisWeek')
  })

  it('calls any other week next week', () => {
    expect(weekTitleKey(next, current)).toBe('nextWeek')
  })

  it('does not look up today, so it follows the week it is given', () => {
    // A far past week still reads as "next week" rather than pretending to know
    // which week it is relative to now.
    expect(weekTitleKey('2020-01-04', current)).toBe('nextWeek')
  })
})

describe('SUB_STATUS_LABEL', () => {
  it('covers every subscription status', () => {
    expect(Object.keys(SUB_STATUS_LABEL).sort()).toEqual(['none', 'pending', 'subscribed'])
  })
})
