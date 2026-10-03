import { useState } from 'react'
import { useApp } from '../context/AppContext'
import type { SubStatus } from '../lib/types'
import {
  formatMonthRange,
  weekDays,
  fromISO,
eligibleWeekKeys,
  subDays
} from '../lib/date'
import { weeklyNumberLabel } from '../lib/storage'
import { StatusBadge } from '../components/StatusBadge'
import { SubscribeSheet } from '../components/SubscribeSheet'
import { SUB_STATUS_LABEL, SUB_STATUS_ORDER, dayCountLabelKey, weekTitleKey } from '../lib/status'
import { StatusIcon, MapPinIcon, BusIcon, CalendarIcon } from '../components/Icons'

export function Statuses() {
  const { t, lang, currentUser, weekStatusFor, weekSubFor } = useApp()
  const [filter, setFilter] = useState<SubStatus | 'all'>('all')
  const [sheetWeek, setSheetWeek] = useState<string | null>(null)

  const [thisWeek] = eligibleWeekKeys()
  const weeks = eligibleWeekKeys().map((key) => ({
    key,
    label: weekTitleKey(key, thisWeek),
    range: formatMonthRange(weekDays(fromISO(key)), lang),
    status: currentUser ? weekStatusFor(currentUser.id, key) : 'none',
    sub: currentUser ? weekSubFor(currentUser.id, key) : null
  }))

  const counts = weeks.reduce(
    (acc, w) => ({ ...acc, [w.status]: acc[w.status] + 1 }),
    { none: 0, pending: 0, subscribed: 0 } as Record<SubStatus, number>
  )

  const matches = (status: SubStatus) => filter === 'all' || status === filter

  return (
    <div className="page">
      <section className="page__head">
        <h1 className="page__title">{t('statuses')}</h1>
        <p className="page__sub">{t('weekOverview')}</p>
      </section>

      <section className="statgrid">
        {SUB_STATUS_ORDER.map((status) => (
          <button
            key={status}
            type="button"
            className={`stat stat--${status} ${filter === status ? 'is-active' : ''}`}
            onClick={() => setFilter(filter === status ? 'all' : status)}
          >
            <span className="stat__count">{counts[status]}</span>
            <span className="stat__label">{t(SUB_STATUS_LABEL[status])}</span>
          </button>
        ))}
      </section>

      {weeks.map((week) => (
        <section key={week.key} className="weekpart">
          <h2 className="weekpart__title">
            <CalendarIcon className="weekpart__icon" />
            {week.label}
            <small>{week.range}</small>
          </h2>

          {matches(week.status) ? (
            <ul className="statuslist">
              <li className="statuslist__row">
                <div className="statuslist__day">
                  <strong>{t('yourSubscription')}</strong>
                  <small>{t(SUB_STATUS_LABEL[week.status])}</small>
                  {week.sub?.number != null && (
                    <span className="wkid wkid--inline">
                      <span className="wkid__label">{t('weeklyId')}</span>
                      <strong className="wkid__value">
                        {weeklyNumberLabel(week.sub.number)}
                      </strong>
                    </span>
                  )}
                  {week.sub?.pickupName && (
                    <span className="statuslist__pickup">
                      <MapPinIcon />
                      {week.sub.pickupName}
                    </span>
                  )}
                  {week.sub && (
                    <span className="statuslist__days">
                      <CalendarIcon />
                      {t(dayCountLabelKey(subDays(week.sub).length))}
                    </span>
                  )}
                </div>
                <StatusBadge status={week.status} size="sm" />
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => setSheetWeek(week.key)}
                >
                  <BusIcon className="btn__icon" />
                  {week.status === 'none' ? t('subscribe') : t('subscription')}
                </button>
              </li>
            </ul>
          ) : (
            <p className="empty">
              <StatusIcon className="empty__icon" />
              {t('scheduleEmpty')}
            </p>
          )}
        </section>
      ))}

      {sheetWeek && (
        <SubscribeSheet requestedWeek={sheetWeek} onClose={() => setSheetWeek(null)} />
      )}
    </div>
  )
}
