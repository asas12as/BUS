import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import { eligibleWeekKeys, formatMonthRange, fromISO, weekDays } from '../lib/date'
import { weekTitleKey } from '../lib/status'
import { PlacesManager } from '../components/PlacesManager'
import { UsersManager } from '../components/UsersManager'
import { WeekSubsSheet } from '../components/WeekSubsSheet'
import { CalendarIcon, QrCodeIcon } from '../components/Icons'
import type { SubStatus } from '../lib/types'

export function AdminDashboard() {
  const { t, lang, adminUsers, weekStatusFor } = useApp()

  const [openWeek, setOpenWeek] = useState<string | null>(null)

  const [thisWeek, nextWeek] = eligibleWeekKeys()
  const weekRange = (key: string) => formatMonthRange(weekDays(fromISO(key)), lang)

  const countFor = (week: string, status: SubStatus) =>
    adminUsers.filter((u) => weekStatusFor(u.id, week) === status).length

  const weeks = [
    { key: thisWeek, title: t('thisWeek') },
    { key: nextWeek, title: t('nextWeek') }
  ]

  const totalPending =
    countFor(thisWeek, 'pending') + countFor(nextWeek, 'pending')

  return (
    <div className="page">
      <section className="page__head">
        <h1 className="page__title">{t('adminPanel')}</h1>
        <p className="page__sub">{t('subscribers')}</p>
      </section>

      <section className="statgrid statgrid--3 anim-stagger">
        <div className="stat stat--plain" style={{ '--i': 0 } as React.CSSProperties}>
          <span className="stat__count">{adminUsers.length}</span>
          <span className="stat__label">{t('totalMembers')}</span>
        </div>
        <div className="stat stat--subscribed" style={{ '--i': 1 } as React.CSSProperties}>
          <span className="stat__count">{countFor(thisWeek, 'subscribed')}</span>
          <span className="stat__label">{t('subscribed')}</span>
        </div>
        <div className="stat stat--pending" style={{ '--i': 2 } as React.CSSProperties}>
          <span className="stat__count">{totalPending}</span>
          <span className="stat__label">{t('pendingPayment')}</span>
        </div>
      </section>

      <section className="weekdoors anim-fade">
        {weeks.map(({ key, title }, index) => {
          const pending = countFor(key, 'pending')
          const subscribed = countFor(key, 'subscribed')
          return (
            <button
              key={key}
              type="button"
              className="weekdoor"
              style={{ '--i': index } as React.CSSProperties}
              onClick={() => setOpenWeek(key)}
            >
              {pending > 0 && (
                <span className="weekdoor__badge" aria-label={t('pendingPayment')}>
                  {pending}
                </span>
              )}
              <span className="weekdoor__icon">
                <CalendarIcon />
              </span>
              <span className="weekdoor__body">
                <strong className="weekdoor__title">{title}</strong>
                <small className="weekdoor__range">{weekRange(key)}</small>
                <span className="weekdoor__counts">
                  <span className="weekdoor__count weekdoor__count--pending">
                    {pending} {t('pendingPayment')}
                  </span>
                  <span className="weekdoor__count weekdoor__count--subscribed">
                    {subscribed} {t('subscribed')}
                  </span>
                </span>
              </span>
            </button>
          )
        })}
      </section>

      <section className="scanlink">
        <Link to="/scan" className="scanlink__btn">
          <QrCodeIcon />
          <span className="scanlink__body">
            <strong>{t('scanTitle')}</strong>
            <small>{t('scanSub')}</small>
          </span>
        </Link>
      </section>

      <PlacesManager />

      <UsersManager />

      {openWeek && (
        <WeekSubsSheet
          weekStart={openWeek}
          title={weekTitleKey(openWeek, thisWeek)}
          onClose={() => setOpenWeek(null)}
        />
      )}
    </div>
  )
}
