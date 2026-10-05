import { useMemo, useState } from 'react'
import { useApp } from '../context/useApp'
import {
  addDays,
  formatDate,
  formatDayName,
  formatMonthRange,
  isToday,
  startOfWeek,
  subDays,
  toISO,
  weekDays
} from '../lib/date'
import { StatusBadge } from './StatusBadge'
import { SubscribeSheet } from './SubscribeSheet'
import { formatMinutes } from '../lib/format'
import { BusIcon, ChevronLeftIcon, ChevronRightIcon, ClockIcon } from './Icons'

export function WeekCalendar() {
  const {
    t,
    lang,
    currentUser,
    daysFor,
    weekStatusFor,
    weekSubFor,
    windowOpen,
    subscribeBlock,
    windowMinutesLeft
  } = useApp()
  const [anchor, setAnchor] = useState(() => new Date())
  const [sheetOpen, setSheetOpen] = useState(false)

  const days = useMemo(() => weekDays(anchor), [anchor])
  const weekStart = toISO(startOfWeek(anchor))
  const entries = currentUser ? daysFor(currentUser.id) : {}
  const isCurrentWeek = weekStart === toISO(startOfWeek(new Date()))
  const sub = currentUser ? weekSubFor(currentUser.id, weekStart) : null
  const riding = new Set(sub ? subDays(sub) : [])
  const windowNote = windowOpen
    ? t('windowOpenNow').replace('{n}', formatMinutes(windowMinutesLeft, lang))
    : t('windowOpensIn').replace('{n}', formatMinutes(windowMinutesLeft, lang))

  const status = currentUser ? weekStatusFor(currentUser.id, weekStart) : 'none'

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

{/* Window state sits above the action so it is read before tapping. */}
        <p
          className={`calendar__window anim-stagger ${windowOpen ? 'is-open' : ''}`}
          style={{ '--i': 1 } as React.CSSProperties}
        >
          <ClockIcon className="calendar__windowIcon" />
          <span>{windowNote}</span>
        </p>

        <div className="calendar__sub anim-stagger" style={{ '--i': 2 } as React.CSSProperties}>
          <StatusBadge status={status} />
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
          // Only meaningful while a subscription is live: Thu and Fri can never
          // be chosen, so a live rider is always off those two.
          const rides = sub !== null && status !== 'none' && riding.has(date.getDay())
          return (
            <article
              key={iso}
              className={`day anim-stagger ${today ? 'is-today' : ''} ${entry ? '' : 'is-empty'} ${
                sub !== null && status !== 'none' ? (rides ? 'is-riding' : 'is-off') : ''
              }`}
              style={{ '--i': index } as React.CSSProperties}
            >
              <div className="day__head">
                <div className="day__label">
                  <strong>{formatDayName(date, lang)}</strong>
                  <small>{formatDate(date, lang)}</small>
                </div>
                {sub !== null && status !== 'none' && (
                  <span className={`day__badge ${rides ? 'is-riding' : ''}`}>
                    {rides ? t('rides') : t('off')}
                  </span>
                )}
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

      {/* The block applies wherever you tap from, so it is not tied to a week. */}
      {subscribeBlock === 'holdingThisWeek' && (
        <p className="calendar__note">{t('holdingThisWeek')}</p>
      )}

      {sheetOpen && (
        <SubscribeSheet
          key={weekStart}
          requestedWeek={weekStart}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </section>
  )
}
