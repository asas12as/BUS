import { useMemo, useState } from 'react'
import { useApp } from '../context/AppContext'
import {
  addDays,
  canSubscribe,
  formatDate,
  formatDayName,
  formatMonthRange,
  isToday,
  startOfWeek,
  toISO,
  weekDays
} from '../lib/date'
import { StatusBadge } from './StatusBadge'
import { weeklyNumberLabel } from '../lib/storage'
import { SubscribeSheet } from './SubscribeSheet'
import { ChevronLeftIcon, ChevronRightIcon, MapPinIcon, BusIcon } from './Icons'

export function WeekCalendar() {
  const { t, lang, currentUser, daysFor, weekStatusFor, weekSubFor } = useApp()
  const [anchor, setAnchor] = useState(() => new Date())
  const [sheetOpen, setSheetOpen] = useState(false)

  const days = useMemo(() => weekDays(anchor), [anchor])
  const weekStart = toISO(startOfWeek(anchor))
  const entries = currentUser ? daysFor(currentUser.id) : {}
  const isCurrentWeek = weekStart === toISO(startOfWeek(new Date()))
  const eligible = canSubscribe(weekStart)

  const status = currentUser ? weekStatusFor(currentUser.id, weekStart) : 'none'
  const sub = currentUser ? weekSubFor(currentUser.id, weekStart) : null

  return (
    <section className="calendar anim-fade">
      <div className="calendar__bar">
        <button
          type="button"
          className="icon-btn"
          onClick={() => setAnchor(addDays(anchor, -7))}
          aria-label={t('previousWeek')}
        >
          <ChevronLeftIcon />
        </button>

        <div className="calendar__range">
          <strong>{isCurrentWeek ? t('thisWeek') : t('weeklySchedule')}</strong>
          <small>{formatMonthRange(days, lang)}</small>
        </div>

        <button
          type="button"
          className="icon-btn"
          onClick={() => setAnchor(addDays(anchor, 7))}
          aria-label={t('nextWeek')}
        >
          <ChevronRightIcon />
        </button>
      </div>

      <div className="calendar__sub anim-stagger" style={{ '--i': 1 } as React.CSSProperties}>
        <StatusBadge status={status} />
        {sub?.number != null && (
          <span className="wkid wkid--inline">
            <span className="wkid__label">{t('weeklyId')}</span>
            <strong className="wkid__value">{weeklyNumberLabel(sub.number)}</strong>
          </span>
        )}
        {sub?.pickupName && (
          <span className="calendar__pickup">
            <MapPinIcon />
            {sub.pickupName}
          </span>
        )}
        <button
          type="button"
          className="btn btn--primary calendar__cta"
          onClick={() => setSheetOpen(true)}
        >
          <BusIcon className="btn__icon" />
          {status === 'none' ? t('subscribe') : t('subscription')}
        </button>
      </div>

      {!isCurrentWeek && (
        <button
          type="button"
          className="btn btn--ghost btn--block"
          onClick={() => setAnchor(new Date())}
        >
          {t('thisWeek')}
        </button>
      )}

      <div className="calendar__grid">
        {days.map((date, index) => {
          const iso = toISO(date)
          const entry = entries[iso]
          const today = isToday(date)
          return (
            <article
              key={iso}
              className={`day anim-stagger ${today ? 'is-today' : ''} ${entry ? '' : 'is-empty'}`}
              style={{ '--i': index } as React.CSSProperties}
            >
              <div className="day__head">
                <div className="day__label">
                  <strong>{formatDayName(date, lang)}</strong>
                  <small>{formatDate(date, lang)}</small>
                </div>
              </div>

              {entry && (
                <dl className="day__meta">
                  <div>
                    <dt>{t('route')}</dt>
                    <dd>{entry.route}</dd>
                  </div>
                  <div>
                    <dt>{t('time')}</dt>
                    <dd dir="ltr">{entry.time}</dd>
                  </div>
                </dl>
              )}
            </article>
          )
        })}
      </div>

      {!eligible && <p className="calendar__note">{t('notEligible')}</p>}

      {sheetOpen && (
        <SubscribeSheet key={weekStart} weekStart={weekStart} onClose={() => setSheetOpen(false)} />
      )}
    </section>
  )
}
