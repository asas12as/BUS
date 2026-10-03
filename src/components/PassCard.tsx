import type { ReactNode } from 'react'
import { useApp } from '../context/AppContext'
import { Avatar } from './Avatar'
import { CheckIcon, MapPinIcon } from './Icons'
import type { WeekDayState } from '../lib/date'
import type { PaymentState } from '../lib/qr'
import type { SubStatus } from '../lib/types'
import { PAYMENT_LABEL_KEY, SUB_STATUS_LABEL, dayStateLabelKey } from '../lib/status'

/** One tile along the bottom of the pass. */
export interface PassDay {
  key: string
  /** Short weekday name, already localised. */
  label: string
  /** Day of the month, already localised. */
  number: string
  state: WeekDayState
}

export interface PassCardProps {
  /** Weekly number as printed, or null when there is none. */
  number: string | null
  name: string
  avatar?: string | null
  /** Already-formatted week range, so both callers format it the same way. */
  weekRange: string
  days: PassDay[]
  pickup: string
  status: SubStatus
  payment: PaymentState
  /**
   * The QR block, when the pass is the rider's own.
   *
   * A slot rather than a boolean because the symbol is drawn by the caller and
   * the scanner's card has none: it was read from a code, not showing one.
   */
  qr?: ReactNode
}

/** The states a legend should explain, in the order they are read. */
const LEGEND_ORDER: WeekDayState[] = ['ride', 'off', 'closed']

/**
 * The weekly pass, drawn once.
 *
 * The rider's own pass in the QR sheet and the card the door scanner shows are
 * the same object, so they are built here rather than twice. That matters
 * beyond tidiness: a driver compares the card in their hand against this one,
 * and any detail that drifts between the two screens teaches them to trust the
 * wrong one.
 */
export function PassCard({
  number,
  name,
  avatar = null,
  weekRange,
  days,
  pickup,
  status,
  payment,
  qr
}: PassCardProps) {
  const { t } = useApp()

  // Only explain the states this pass actually shows, so the legend is never
  // longer than it needs to be and never describes a day that is not there.
  const shown = LEGEND_ORDER.filter((state) => days.some((d) => d.state === state))

  return (
    <article className={`pass pass--${payment}`}>
      <section className="pass__top">
        <div className="pass__topRow">
          <div className="pass__idBlock">
            <span className="pass__idLabel">{t('weeklyId')}</span>
            <strong className={`pass__id ${number ? '' : 'is-none'}`}>
              {number ?? t('none')}
            </strong>
          </div>
          <span className="pass__pill">
            <i aria-hidden="true" />
            {t(SUB_STATUS_LABEL[status])}
          </span>
        </div>

        <div className="pass__who">
          <Avatar name={name} src={avatar} variant="ticket" />
          <div className="pass__whoText">
            <p className="pass__name">{name}</p>
            <p className="pass__week">
              {t('weekOf')} {weekRange}
            </p>
          </div>
        </div>
      </section>

      <section className="pass__bottom">
        {qr}

        <ol className="pass__days">
          {days.map((d) => (
            <li key={d.key} className={`pass__day pass__day--${d.state}`}>
              <span className="pass__dayName">{d.label}</span>
              <span className="pass__dayNumber">{d.number}</span>
            </li>
          ))}
        </ol>

        {shown.length > 0 && (
          <ul className="pass__legend">
            {shown.map((state) => (
              <li key={state} className={`pass__legendItem pass__legendItem--${state}`}>
                <i aria-hidden="true" />
                {t(dayStateLabelKey(state))}
              </li>
            ))}
          </ul>
        )}

        {/* One line, not two: the pickup place and the pickup line are the same
            thing, so a second row would imply a choice that does not exist. */}
        <p className="pass__route">
          <MapPinIcon />
          <b>{pickup}</b>
          <span className="pass__leader" aria-hidden="true" />
          <em>{t('pickup')}</em>
        </p>

        <footer className={`pass__foot pass__foot--${payment}`}>
          <span className="pass__pay">{t(PAYMENT_LABEL_KEY[payment])}</span>
          <span className={`pass__check pass__check--${payment}`} aria-hidden="true">
            <CheckIcon />
          </span>
        </footer>
      </section>
    </article>
  )
}
