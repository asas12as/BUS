import { useMemo, useState } from 'react'
import { useApp } from '../context/useApp'
import type { SubStatus, User } from '../lib/types'
import { addDays, eligibleWeekKeys, formatMonthRange, fromISO, weekDays } from '../lib/date'
import { weeklyNumberLabel } from '../lib/weeklyNumber'
import { ROUTES } from '../lib/routes'
import { weekTitleKey } from '../lib/status'
import { subDays } from '../lib/date'
import { StatusBadge } from './StatusBadge'
import { CheckIcon, CloseIcon, SearchIcon, UsersIcon } from './Icons'

/** Two-step delete so a misclick cannot destroy a record. */
function ConfirmDelete({
  label,
  confirmLabel,
  onConfirm
}: {
  label: string
  confirmLabel: string
  onConfirm: () => void
}) {
  const [armed, setArmed] = useState(false)
  if (!armed) {
    return (
      <button type="button" className="btn btn--danger btn--sm" onClick={() => setArmed(true)}>
        {label}
      </button>
    )
  }
  return (
    <>
      <button
        type="button"
        className="btn btn--danger btn--sm"
        onClick={() => {
          setArmed(false)
          onConfirm()
        }}
      >
        <CheckIcon className="btn__icon" />
        {confirmLabel}
      </button>
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        onClick={() => setArmed(false)}
      >
        <CloseIcon className="btn__icon" />
      </button>
    </>
  )
}

function UserSubscriptions({ user }: { user: User }) {
  const {
    t,
    lang,
    weekSubFor,
    weekStatusFor,
    setWeekStatus,
    deleteSubscription,
    changePickup,
    allPlaces
  } = useApp()
  const [thisWeek, nextWeek] = eligibleWeekKeys()
  const [failed, setFailed] = useState('')
  const label = (key: string) => (weekTitleKey(key, thisWeek))
  const range = (key: string) => formatMonthRange(weekDays(fromISO(key)), lang)

  /**
   * Runs an admin write and reports the outcome inline.
   *
   * The controls are selects and a two-step delete, so there is nowhere else for
   * a failure to appear. A refused change silently reverting would leave the
   * admin believing something was saved that was not.
   */
  const run = async (work: () => Promise<{ ok?: boolean; error?: string }>) => {
    const result = await work()
    setFailed(result.ok ? '' : result.error ?? '')
  }

  return (
    <ul className="usrow__subs">
      {[thisWeek, nextWeek].map((week) => {
        const sub = weekSubFor(user.id, week)
        const status = weekStatusFor(user.id, week)
        return (
          <li key={week} className="usrow__sub">
            <div className="usrow__subHead">
              <strong>{label(week)}</strong>
              <small>{range(week)}</small>
            </div>
            <div className="usrow__subFacts">
              <StatusBadge status={status} size="sm" />
              {sub?.number != null && (
                <span className="wkid wkid--inline">
                  <span className="wkid__label">{t('weeklyId')}</span>
                  <strong className="wkid__value">{weeklyNumberLabel(sub.number)}</strong>
                </span>
              )}
              {sub?.pickupName && <span className="usrow__pickup">{sub.pickupName}</span>}
            </div>
            <div className="usrow__controls">
              <select
                className="field__input"
                value={sub?.pickupId ?? ''}
                disabled={!sub || status === 'none'}
                onChange={(e) => {
                  const place = allPlaces.find((p) => p.id === e.target.value)
                  // Changing the pickup must not disturb the chosen days, so they are carried
                  // over from the existing subscription.
                  if (place) {
                    void run(() =>
                      changePickup(user.id, week, {
                        id: place.id,
                        name: place.name,
                        days: subDays(sub)
                      })
                    )
                  }
                }}
              >
                <option value="">{t('pickup')}</option>
                {allPlaces
                  .filter((p) => p.active)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
              <select
                className="field__input"
                value={status}
                onChange={(e) => void run(() => setWeekStatus(user.id, week, e.target.value as SubStatus))}
              >
                <option value="none">{t('notSubscribed')}</option>
                <option value="pending">{t('pendingPayment')}</option>
                <option value="subscribed">{t('subscribed')}</option>
              </select>
              {sub && (
                <ConfirmDelete
                  label={t('delete')}
                  confirmLabel={t('confirmDelete')}
                  onConfirm={() => void run(() => deleteSubscription(user.id, week))}
                />
              )}
            </div>
            {failed && <p className="form__error">{failed}</p>}
          </li>
        )
      })}
    </ul>
  )
}

/**
 * The fortnight of assigned buses for one rider.
 *
 * Dates with no entry are listed too, blank, because an unassigned day is the
 * thing an admin needs to see: an entry that is missing and an entry that is
 * empty look identical once they are in the same list, and only showing the
 * assigned ones would hide the gap.
 */
function UserSchedule({ user }: { user: User }) {
  const { t, daysFor, updateDay } = useApp()
  const assigned = daysFor(user.id)

  const entries = useMemo(() => {
    const out: Array<{ date: string; route: string; time: string }> = []
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    for (let i = 0; i < 14; i += 1) {
      const date = addDays(today, i).toISOString().slice(0, 10)
      out.push({ date, route: assigned[date]?.route ?? '', time: assigned[date]?.time ?? '' })
    }
    return out
  }, [assigned])

  return (
    <div className="usrow__schedule">
      {entries.length === 0 ? (
        <p className="empty">{t('noSchedule')}</p>
      ) : (
        <ul className="usrow__days">
          {entries.map((day) => (
            <li key={day.date} className="usrow__day">
              <span className="usrow__date">{day.date}</span>
              <select
                className="field__input"
                value={day.route}
                onChange={(e) => void updateDay(user.id, day.date, { route: e.target.value })}
              >
                <option value="">{t('noRoute')}</option>
                {ROUTES.map((route) => (
                  <option key={route} value={route}>
                    {route}
                  </option>
                ))}
              </select>
              <input
                className="field__input"
                type="time"
                value={day.time}
                onChange={(e) => void updateDay(user.id, day.date, { time: e.target.value })}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function UserRow({ user }: { user: User }) {
  const {
    t,
    adminUpdateProfile,
    setUserRole,
    adminSetPassword,
    adminDeleteUser
  } = useApp()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(user.name)
  const [phone, setPhone] = useState(user.phone)
  const [email, setEmail] = useState(user.email)
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [failed, setFailed] = useState('')

  const save = async () => {
    const result = await adminUpdateProfile(user.id, { name, phone, email })
    if (result.ok) {
      setMessage(t('savedSuccessfully'))
      setFailed('')
    } else {
      // Server refusals come back as prose from Postgres, so this is shown
      // as-is. The validation keys the context checks arrive as keys instead,
      // and both are rendered through t().
      setFailed(result.error ?? '')
    }
  }

  const resetPassword = async () => {
    const result = await adminSetPassword(user.id, password)
    if (result.ok) {
      setPassword('')
      setMessage(t('savedSuccessfully'))
      setFailed('')
    } else {
      setFailed(result.error ?? 'passwordTooShort')
    }
  }

  const promote = async () => {
    const result = await setUserRole(user.id, user.role === 'user' ? 'admin' : 'user')
    if (!result.ok) setFailed(result.error ?? '')
  }

  const closeAccount = async () => {
    const result = await adminDeleteUser(user.id)
    if (!result.ok) setFailed(result.error ?? '')
  }

  return (
    <li className="usrow">
      <button
        type="button"
        className="usrow__head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="usrow__id">{user.id}</span>
        <span className="usrow__info">
          <strong>{user.name}</strong>
          <small dir="ltr">{user.email}</small>
        </span>
        <span className="usrow__tags">
          <span className={`usrow__role usrow__role--${user.role}`}>
            {user.role === 'admin' ? t('admin') : t('user')}
          </span>
          <span className="usrow__date">{user.createdAt.slice(0, 10)}</span>
        </span>
      </button>

      {open && (
        <div className="usrow__body anim-fade">
          <div className="usrow__group">
            <h4 className="usrow__groupTitle">
              {t('editDetails')}
            </h4>
            <div className="usrow__grid">
              <input
                className="field__input"
                value={name}
                placeholder={t('fullName')}
                onChange={(e) => setName(e.target.value)}
              />
              <input
                className="field__input"
                value={phone}
                placeholder={t('phoneNumber')}
                onChange={(e) => setPhone(e.target.value)}
              />
              <input
                className="field__input"
                value={email}
                dir="ltr"
                placeholder={t('email')}
                onChange={(e) => setEmail(e.target.value)}
              />
              <button
                type="button"
                className="btn btn--primary btn--sm"
                onClick={() => void save()}
              >
                {t('save')}
              </button>
            </div>
          </div>

          <div className="usrow__group">
            <h4 className="usrow__groupTitle">{t('role')}</h4>
            <div className="rowactions">
              {user.role === 'user' ? (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => void promote()}
                >
                  {t('makeAdmin')}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => void promote()}
                >
                  {t('makeUser')}
                </button>
              )}
            </div>
          </div>

          <div className="usrow__group">
            <h4 className="usrow__groupTitle">{t('resetPassword')}</h4>
            <div className="usrow__grid">
              <input
                className="field__input"
                type="text"
                value={password}
                placeholder={t('newPassword')}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => void resetPassword()}
                disabled={!password}
              >
                {t('resetPassword')}
              </button>
            </div>
          </div>

          <div className="usrow__group">
            <h4 className="usrow__groupTitle">{t('subscription')}</h4>
            <UserSubscriptions user={user} />
          </div>

          <div className="usrow__group">
            <h4 className="usrow__groupTitle">{t('schedule')}</h4>
            <UserSchedule user={user} />
          </div>

          <div className="usrow__foot">
            <ConfirmDelete
              label={t('deleteUser')}
              confirmLabel={t('confirmDelete')}
              onConfirm={() => void closeAccount()}
            />
            {message && <span className="usrow__message">{message}</span>}
            {failed && <span className="form__error">{failed}</span>}
          </div>
        </div>
      )}
    </li>
  )
}

export function UsersManager() {
  const { t, allUsers } = useApp()
  const [query, setQuery] = useState('')

  const q = query.trim().toLowerCase()
  const filtered = q
    ? allUsers.filter(
        (u) =>
          u.name.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q) ||
          u.phone.includes(q) ||
          u.id.toLowerCase().includes(q)
      )
    : allUsers

  return (
    <section className="card anim-fade">
      <h2 className="card__title">
        <UsersIcon className="card__titleIcon" />
        {t('users')}
      </h2>

      <label className="field field--search">
        <span className="field__label">
          <SearchIcon className="field__icon" />
          {t('searchByName')}
        </span>
        <input
          className="field__input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>

      {filtered.length === 0 ? (
        <p className="empty">{t('noUsers')}</p>
      ) : (
        <ul className="uslist">
          {filtered.map((u) => (
            <UserRow key={u.id} user={u} />
          ))}
        </ul>
      )}
    </section>
  )
}
