import { useApp } from '../context/AppContext'
import { WeekCalendar } from '../components/WeekCalendar'
import { StatusBadge } from '../components/StatusBadge'
import { eligibleWeekKeys, weekKey } from '../lib/date'
import { BusIcon } from '../components/Icons'

export function Home() {
  const { t, currentUser, weekStatusFor } = useApp()
  const [thisWeek, nextWeek] = eligibleWeekKeys()
  const status = currentUser ? weekStatusFor(currentUser.id, thisWeek) : 'none'
  const nextStatus = currentUser ? weekStatusFor(currentUser.id, nextWeek) : 'none'

  return (
    <div className="page">
      <section className="hero anim-pop">
        <div className="hero__text">
          <h1 className="hero__title">
            {t('welcomeBack')}, {currentUser?.name.split(' ')[0]}
          </h1>
          <p className="hero__sub">
            {t('weekOf')} {weekKey(new Date())}
          </p>
        </div>
        <div className="hero__status">
          <StatusBadge status={status} size="lg" />
          <span className="hero__icon anim-float">
            <BusIcon />
          </span>
        </div>
      </section>

      <WeekCalendar />

      <section className="card anim-fade">
        <h2 className="card__title">{t('weekOverview')}</h2>
        <ul className="statuslist">
          <li className="statuslist__row">
            <span>{t('thisWeek')}</span>
            <StatusBadge status={status} size="sm" />
          </li>
          <li className="statuslist__row">
            <span>{t('nextWeek')}</span>
            <StatusBadge status={nextStatus} size="sm" />
          </li>
        </ul>
      </section>
    </div>
  )
}
