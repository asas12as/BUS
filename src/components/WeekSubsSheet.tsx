import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useApp } from '../context/AppContext'
import type { SubStatus } from '../lib/types'
import { formatMonthRange, fromISO, weekDays } from '../lib/date'
import { weeklyNumberLabel } from '../lib/storage'
import { StatusBadge } from './StatusBadge'
import { SUB_STATUS_LABEL } from '../lib/status'
import { useEscapeToClose } from '../lib/useEscapeToClose'
import { CheckIcon, CloseIcon, SearchIcon, UsersIcon } from './Icons'

interface Props {
  weekStart: string
  title: string
  onClose: () => void
}

/**
 * Presentational body, exported so it can be rendered without a portal target.
 * Lists every subscription for one week with its payment actions.
 */
export function WeekSubsSheetBody({ weekStart, title, onClose }: Props) {
  const { t, lang, adminUsers, weekStatusFor, weekSubFor, confirmWeek, setWeekStatus } = useApp()
  const [filter, setFilter] = useState<SubStatus | 'all'>('pending')
  const [query, setQuery] = useState('')

  const range = formatMonthRange(weekDays(fromISO(weekStart)), lang)

  // `1` should also find `001`, since the admin reads numbers off the printed
  // label rather than the padded storage value.
  const needle = query.trim().toLowerCase()
  const matchesQuery = (name: string, number?: number | null) => {
    if (!needle) return true
    if (name.toLowerCase().includes(needle)) return true
    if (number == null) return false
    const digits = needle.replace(/\D/g, '')
    if (digits.length === 0) return false
    return String(number).includes(digits)
  }

  const rows = adminUsers
    .map((user) => ({ user: user, status: weekStatusFor(user.id, weekStart) }))
    .filter((r) => r.status !== 'none')
    .filter((r) => filter === 'all' || r.status === filter)
    .filter((r) => matchesQuery(r.user.name, weekSubFor(r.user.id, weekStart)?.number))

  const counts = adminUsers.reduce(
    (acc, u) => {
      const s = weekStatusFor(u.id, weekStart)
      return s === 'none' ? acc : { ...acc, [s]: acc[s] + 1 }
    },
    { none: 0, pending: 0, subscribed: 0 } as Record<SubStatus, number>
  )

  useEscapeToClose(onClose)

  return (
    <div className="sheet-backdrop anim-fade" onClick={onClose} role="presentation">
      <div
        className="sheet anim-pop"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="sheet__head">
          <span className="sheet__icon">
            <UsersIcon />
          </span>
          <div>
            <h2 className="sheet__title">{title}</h2>
            <p className="sheet__sub">
              {t('weekOf')} {range}
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t('close')}>
            <CloseIcon />
          </button>
        </header>

        <div className="segment">
          <button
            type="button"
            className={`segment__btn ${filter === 'pending' ? 'is-active' : ''}`}
            onClick={() => setFilter('pending')}
          >
            {t('pendingPayment')} ({counts.pending})
          </button>
          <button
            type="button"
            className={`segment__btn ${filter === 'all' ? 'is-active' : ''}`}
            onClick={() => setFilter('all')}
          >
            {t('filterAll')} ({counts.pending + counts.subscribed})
          </button>
          <button
            type="button"
            className={`segment__btn ${filter === 'subscribed' ? 'is-active' : ''}`}
            onClick={() => setFilter('subscribed')}
          >
            {t('subscribed')} ({counts.subscribed})
          </button>
        </div>

        <label className="field field--search">
          <span className="field__label">
            <SearchIcon className="field__icon" />
            {t('searchByIdOrName')}
          </span>
          <input
            className="field__input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('searchByIdOrName')}
          />
          {query && (
            <button
              type="button"
              className="searchclear"
              onClick={() => setQuery('')}
              aria-label={t('searchClear')}
            >
              <CloseIcon />
            </button>
          )}
        </label>

        {rows.length === 0 ? (
          <p className="empty">
            {needle ? t('searchNoResults').replace('{q}', query.trim()) : t('noSubsThisWeek')}
          </p>
        ) : (
          <ul className="adminweek">
            {rows.map(({ user, status }, index) => {
              const sub = weekSubFor(user.id, weekStart)
              return (
                <li
                  key={user.id}
                  className="adminweek__row"
                  style={{ '--i': index } as React.CSSProperties}
                >
                  <div className="adminweek__day">
                    <strong>{user.name}</strong>
                    {sub?.number != null && (
                      <span className="wkid wkid--inline">
                        <span className="wkid__label">{t('weeklyId')}</span>
                        <strong className="wkid__value">{weeklyNumberLabel(sub.number)}</strong>
                      </span>
                    )}
                    {sub?.pickupName && <small>{t('pickup')}: {sub.pickupName}</small>}
                  </div>
                  <div className="rowactions">
                    <StatusBadge status={status} size="sm" />
                    {status === 'pending' && (
                      <button
                        type="button"
                        className="btn btn--primary btn--sm"
                        onClick={() => confirmWeek(user.id, weekStart)}
                      >
                        <CheckIcon className="btn__icon" />
                        {t('confirmPayment')}
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn--danger btn--sm"
                      onClick={() => setWeekStatus(user.id, weekStart, 'none')}
                    >
                      <CloseIcon className="btn__icon" />
                      {t('remove')}
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        {rows.length > 0 && (
          <p className="sheet__help">
            {filter === 'all' || needle
              ? t('subsWeekCount').replace('{n}', String(rows.length))
              : t(SUB_STATUS_LABEL[filter])}
          </p>
        )}

        <div className="sheet__actions">
          <button type="button" className="btn btn--ghost btn--block" onClick={onClose}>
            {t('close')}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Portalled to document.body so the sheet escapes page stacking contexts. */
export function WeekSubsSheet(props: Props) {
  const target = typeof document === 'undefined' ? null : document.body
  if (!target) return null
  return createPortal(<WeekSubsSheetBody {...props} />, target)
}
