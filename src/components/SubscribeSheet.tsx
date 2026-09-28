import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useApp } from '../context/AppContext'
import { canSubscribe, formatMonthRange, weekDays, fromISO } from '../lib/date'
import { weeklyNumberLabel } from '../lib/storage'
import { BusIcon, CheckIcon, CloseIcon, MapPinIcon } from './Icons'
import { StatusBadge } from './StatusBadge'

interface Props {
  weekStart: string
  onClose: () => void
}

/** Presentational body, exported so it can be rendered without a portal target. */
export function SubscribeSheetBody({ weekStart, onClose }: Props) {
  const {
    t,
    lang,
    places,
    subscribeWeek,
    changePickup,
    weekStatusFor,
    weekSubFor,
    currentUser,
    cancelSubscription
  } = useApp()
  const existing = currentUser ? weekSubFor(currentUser.id, weekStart) : null
  const [selected, setSelected] = useState<string | null>(() => existing?.pickupId ?? null)
  const [custom, setCustom] = useState(() =>
    existing && !existing.pickupId ? (existing.pickupName ?? '') : ''
  )
  const [mode, setMode] = useState<'list' | 'custom'>(() =>
    existing && !existing.pickupId ? 'custom' : 'list'
  )
  const [error, setError] = useState('')
  const [done, setDone] = useState<'subscribe' | 'change' | null>(null)
  const [editing, setEditing] = useState(false)

  const eligible = canSubscribe(weekStart)
  const status = currentUser ? weekStatusFor(currentUser.id, weekStart) : 'none'
  const range = formatMonthRange(weekDays(fromISO(weekStart)), lang)
  const hasActive = existing !== null && status !== 'none'
  const managing = hasActive && !editing
  const number = existing?.number ?? null

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const submit = () => {
    if (!currentUser) return
    const choice =
      mode === 'list'
        ? (() => {
            const place = places.find((p) => p.id === selected)
            if (!place) {
              setError(t('selectPlace'))
              return null
            }
            return { id: place.id, name: place.name }
          })()
        : custom.trim()
          ? { id: null, name: custom.trim() }
          : (setError(t('placeNameRequired')), null)

    if (!choice) return

    // An existing subscription keeps its weekly number and payment state.
    const result = hasActive
      ? changePickup(currentUser.id, weekStart, choice)
      : subscribeWeek(currentUser.id, weekStart, choice)

    if (!result.ok) {
      setError(t(result.error ?? 'selectPlace'))
      return
    }
    setError('')
    setDone(hasActive ? 'change' : 'subscribe')
    setTimeout(onClose, 900)
  }

  const numberChip = number !== null && (
    <span className="wkid">
      <span className="wkid__label">{t('weeklyId')}</span>
      <strong className="wkid__value">{weeklyNumberLabel(number)}</strong>
    </span>
  )

  return (
    <div className="sheet-backdrop anim-fade" onClick={onClose} role="presentation">
      <div
        className="sheet anim-pop"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t('subscription')}
      >
        <header className="sheet__head">
          <span className="sheet__icon">
            <BusIcon />
          </span>
          <div>
            <h2 className="sheet__title">{t('subscription')}</h2>
            <p className="sheet__sub">
              {t('weekOf')} {range}
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t('close')}>
            <CloseIcon />
          </button>
        </header>

        {!done && (
          <div className="sheet__state">
            <StatusBadge status={status} size="sm" />
            {numberChip}
            {existing?.pickupName && (
              <span className="sheet__statePickup">
                <MapPinIcon />
                {existing.pickupName}
              </span>
            )}
          </div>
        )}

        {!eligible && <p className="sheet__warn">{t('notEligible')}</p>}

        {done ? (
          <div className="sheet__done anim-pop">
            <CheckIcon />
            <strong>{done === 'change' ? t('saved') : t('subscriptionRequested')}</strong>
            <span>{done === 'change' ? t('changePickupPlace') : t('awaitingConfirmation')}</span>
            {number !== null && <span className="sheet__doneId">{weeklyNumberLabel(number)}</span>}
          </div>
        ) : managing ? (
          <>
            <p className="sheet__label">{t('yourSubscription')}</p>
            <p className="sheet__help">
              {status === 'subscribed' ? t('paymentVerified') : t('awaitingVerification')}
            </p>

            <div className="sheet__actions">
              <button
                type="button"
                className="btn btn--primary btn--block"
                onClick={() => {
                  setEditing(true)
                  setError('')
                }}
              >
                {t('changePickupPlace')}
              </button>
              {status !== 'subscribed' && (
                <button
                  type="button"
                  className="btn btn--danger btn--block"
                  onClick={() => {
                    if (currentUser) cancelSubscription(currentUser.id, weekStart)
                    onClose()
                  }}
                >
                  {t('cancelSubscription')}
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <p className="sheet__label">{t('choosePickup')}</p>
            <p className="sheet__help">{t('choosePickupHelp')}</p>

            <div className="segment">
              <button
                type="button"
                className={`segment__btn ${mode === 'list' ? 'is-active' : ''}`}
                onClick={() => {
                  setMode('list')
                  setError('')
                }}
              >
                {t('selectPlace')}
              </button>
              <button
                type="button"
                className={`segment__btn ${mode === 'custom' ? 'is-active' : ''}`}
                onClick={() => {
                  setMode('custom')
                  setError('')
                }}
              >
                {t('requestNewPlace')}
              </button>
            </div>

            {mode === 'list' ? (
              <ul className="placelist">
                {places.map((place) => (
                  <li key={place.id}>
                    <button
                      type="button"
                      className={`placelist__item ${selected === place.id ? 'is-active' : ''}`}
                      onClick={() => {
                        setSelected(place.id)
                        setError('')
                      }}
                    >
                      <MapPinIcon />
                      <span>{place.name}</span>
                      {selected === place.id && <CheckIcon className="placelist__check" />}
                    </button>
                  </li>
                ))}
                {places.length === 0 && <li className="sheet__empty">{t('noPlaces')}</li>}
              </ul>
            ) : (
              <div className="sheet__custom">
                <p className="sheet__help">{t('requestNewPlaceHelp')}</p>
                <input
                  className="field__input"
                  value={custom}
                  onChange={(e) => {
                    setCustom(e.target.value)
                    setError('')
                  }}
                  placeholder={t('placeName')}
                />
              </div>
            )}

            {error && <p className="form__error">{error}</p>}

            <div className="sheet__actions">
              {editing && (
                <button
                  type="button"
                  className="btn btn--ghost btn--block"
                  onClick={() => {
                    setEditing(false)
                    setError('')
                  }}
                >
                  {t('cancel')}
                </button>
              )}
              <button
                type="button"
                className="btn btn--primary btn--block"
                onClick={submit}
                disabled={!eligible}
              >
                {hasActive ? t('changePickup') : t('subscribe')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/**
 * Portalled to document.body so the sheet escapes the stacking contexts that
 * .calendar and .card create with their fill-mode animations, which would
 * otherwise paint page content over the overlay.
 */
export function SubscribeSheet(props: Props) {
  const target = typeof document === 'undefined' ? null : document.body
  if (!target) return null
  return createPortal(<SubscribeSheetBody {...props} />, target)
}
