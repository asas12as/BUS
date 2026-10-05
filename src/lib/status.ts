import type { SubStatus } from './types'
import type { WeekDayState } from './date'
import type { TranslationKey } from '../i18n/translations'

/**
 * The wording for subscription state, gathered in one place.
 *
 * A pass, the status list, the calendar and the admin screens all describe the
 * same handful of ideas: whether a week is paid, how many days it runs, and
 * which week is being talked about. Keeping the choice here means a rider never
 * sees one screen call a day "off" where another calls it "not run".
 */

export const SUB_STATUS_LABEL: Record<SubStatus, TranslationKey> = {
  none: 'notSubscribed',
  pending: 'pendingPayment',
  subscribed: 'subscribed'
}

export const SUB_STATUS_ORDER: SubStatus[] = ['none', 'pending', 'subscribed']

/**
 * The wording shown on a pass for each payment state.
 *
 * The three states are not the same as the subscription statuses: "subscribed"
 * becomes "paid" once money is confirmed, and both of those collapse onto
 * "not subscribed" when there is no subscription at all. Written out once here
 * because three separate sheets render it.
 */
export const PAYMENT_LABEL_KEY = {
  paid: 'paid',
  unpaid: 'unpaid',
  none: 'notSubscribed'
} as const satisfies Record<string, TranslationKey>

/**
 * The wording for how many days a week a subscription runs on.
 *
 * A rider commits to four or five days, and those are the only counts the
 * subscription check accepts, so anything else is treated as a full week here.
 * The status list and the subscription sheet both need this label and used to
 * spell the same choice out separately.
 */
export function dayCountLabelKey(count: number): TranslationKey {
  return count === 4 ? 'fourDays' : 'fiveDays'
}

/**
 * The wording for one day on a pass.
 *
 * `closed` is worded apart from `off` on purpose: `closed` means the service
 * does not run at all that day, while `off` means the bus runs and the rider is
 * simply not on it. Collapsing them would tell a rider their day is cancelled
 * when it is only a rest day.
 */
export function dayStateLabelKey(state: WeekDayState): TranslationKey {
  if (state === 'ride') return 'rides'
  if (state === 'closed') return 'notRun'
  return 'off'
}

/**
 * Whether a week is the one in progress or the one on offer next.
 *
 * Everywhere that shows a week heading needs this, and a heading that said
 * "next week" for the current week would be misleading.
 *
 * The current week is passed in rather than looked up, so a screen that already
 * has the eligible weeks on hand labels against exactly those, instead of
 * recomputing today and risking a disagreeing answer across midnight.
 */
export function weekTitleKey(weekStart: string, currentWeekStart: string): TranslationKey {
  return weekStart === currentWeekStart ? 'thisWeek' : 'nextWeek'
}
