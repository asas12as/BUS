import { useApp } from '../context/AppContext'
import { WeekCalendar } from '../components/WeekCalendar'
import { StatusBadge } from '../components/StatusBadge'
import { eligibleWeekKeys } from '../lib/date'
import { MapPinIcon } from '../components/Icons'

export function Home() {
  const { t, currentUser, weekStatusFor, weekSubFor } = useApp()
  const [thisWeek, nextWeek] = eligibleWeekKeys()
  const status = currentUser ? weekStatusFor(currentUser.id, thisWeek) : 'none'
  const nextStatus = currentUser ? weekStatusFor(currentUser.id, nextWeek) : 'none'
  const nextSub = currentUser ? weekSubFor(currentUser.id, nextWeek) : null

  return (
    <div className="page">
      <WeekCalendar />

      <section className="card anim-fade">
        <h2 className="card__title">{t('weekOverview')}</h2>
        <ul className="statuslist">
          <li className="statuslist__row">
            <span>{t('thisWeek')}</span>
            <StatusBadge status={status} size="sm" />
          </li>
          <li className="statuslist__row statuslist__row--stacked">
            <div className="statuslist__day">
              <span>{t('nextWeek')}</span>
              {nextSub?.pickupName && (
                <small className="statuslist__pickup">
                  <MapPinIcon />
                  {nextSub.pickupName}
                </small>
              )}
            </div>
            <StatusBadge status={nextStatus} size="sm" />
          </li>
        </ul>
      </section>
    </div>
  )
}
