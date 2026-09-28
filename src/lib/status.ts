import type { SubStatus } from './types'
import type { TranslationKey } from '../i18n/translations'

export const SUB_STATUS_LABEL: Record<SubStatus, TranslationKey> = {
  none: 'notSubscribed',
  pending: 'pendingPayment',
  subscribed: 'subscribed'
}

export const SUB_STATUS_ORDER: SubStatus[] = ['none', 'pending', 'subscribed']
