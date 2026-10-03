import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useApp } from '../context/AppContext'
import {
  formatDayShort,
  formatMonthRange,
  weekDays,
  fromISO,
  BASE_WEEK_PRICE,
  DAY_COUNTS,
  EXTRA_DAY_PRICE,
  isValidDayChoice,
  normalizeDays,
  resolveSubscribeWeek,
  SELECTABLE_DAYS,
  selectableDayDates,
  subDays,
  weekPrice
} from '../lib/date'
import { formatMinutes } from '../lib/format'
import { useEscapeToClose } from '../lib/useEscapeToClose'
import { weeklyNumberLabel } from '../lib/storage'
import { dayCountLabelKey } from '../lib/status'
import { BusIcon, CheckIcon, ClockIcon, CloseIcon, MapPinIcon } from './Icons'
import { StatusBadge } from './StatusBadge'

interface Props {
  /**
   * The week the tap came from, which is not necessarily the week on offer. The
   * sheet resolves it to the allowed week rather than refusing, so tapping
   * subscribe from any week still lands somewhere useful.
   */
  requestedWeek: string
  onClose: () => void
}

/** Presentational body, exported so it can be rendered without a portal target. */
export function SubscribeSheetBody({ requestedWeek, onClose }: Props) {
  const {
    t,
    lang,
    places,
    subscribeWeek,
    changePickup,
    weekStatusFor,
    weekSubFor,
    currentUser,
    cancelSubscription,
    windowOpen,
    subscribeBlock,
    windowMinutesLeft,
    targetableWeek
  } = useApp()
  const requestedSub = currentUser ? weekSubFor(currentUser.id, requestedWeek) : null
  // Managing a week the rider already holds stays on that week. Anything else
  // follows the single week that is open, so the sheet never opens on a week
  // that cannot be subscribed.
  const holdsRequested = requestedSub !== null && requestedSub.status !== 'none'
  const weekStart = resolveSubscribeWeek(requestedWeek, targetableWeek, holdsRequested)
  const existing = currentUser ? weekSubFor(currentUser.id, weekStart) : null
  // An existing subscription wins; otherwise fall back to the pickup the rider
  // gave at sign-up, which is the same "place" concept.
  const savedPickup = currentUser?.pickupId ?? null
  const savedName = currentUser?.pickupLocation ?? ''
  const [selected, setSelected] = useState<string | null>(
    () => existing?.pickupId ?? savedPickup
  )
  const [custom, setCustom] = useState(() =>
    existing && !existing.pickupId ? (existing.pickupName ?? '') : savedPickup ? '' : savedName
  )
  const [mode, setMode] = useState<'list' | 'custom'>(() => {
    if (existing) return existing.pickupId ? 'list' : 'custom'
    // A sign-up pickup that is not a known place has to start in custom mode,
    // otherwise the typed value would be hidden behind an empty list.
    return savedPickup ? 'list' : savedName ? 'custom' : 'list'
  })
  // Days the rider takes. Starts from the saved choice, or all five when new.
  const [chosenDays, setChosenDays] = useState<number[]>(() =>
    existing ? subDays(existing) : [...SELECTABLE_DAYS]
  )
  const [error, setError] = useState('')
  const [done, setDone] = useState<'subscribe' | 'change' | null>(null)
  const [editing, setEditing] = useState(false)

  // Managing an existing subscription stays possible outside the window: only
  // taking on a new one is gated by the clock. The reason therefore comes from
  // the context rather than canSubscribe(), which would also reject a week the
  // user already holds.
  const status = currentUser ? weekStatusFor(currentUser.id, weekStart) : 'none'
  const range = formatMonthRange(weekDays(fromISO(weekStart)), lang)
  const hasActive = existing !== null && status !== 'none'
  const managing = hasActive && !editing
  const number = existing?.number ?? null
  // The only reasons a new subscription cannot be started are the clock and the
  // one-week-at-a-time rule. A week mismatch can no longer happen here.
  const blocked = hasActive ? null : subscribeBlock
  // True when the tap came from a week other than the one being offered, so the
  // heading can say which week this actually is.
  const redirected = weekStart !== requestedWeek

  const windowNote = windowOpen
    ? t('windowOpenNow').replace('{n}', formatMinutes(windowMinutesLeft, lang))
    : t('windowOpensIn').replace('{n}', formatMinutes(windowMinutesLeft, lang))

  useEscapeToClose(onClose)

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

    if (!isValidDayChoice(chosenDays)) {
      setError(t('pickDaysCount'))
      return
    }

    // An existing subscription keeps its weekly number and payment state.
    const result = hasActive
      ? changePickup(currentUser.id, weekStart, { ...choice, days: chosenDays })
      : subscribeWeek(currentUser.id, weekStart, { ...choice, days: chosenDays })

    if (!result.ok) {
      setError(t(result.error ?? 'selectPlace'))
      return
    }
    setError('')
    setDone(hasActive ? 'change' : 'subscribe')
    setTimeout(onClose, 900)
  }

  // The fifth day is charged on its own, so the price follows the chosen count
  // rather than being a fixed figure per subscription.
  const price = weekPrice(chosenDays.length)

  const money = (amount: number) => `${amount} ${t('egp')}`

  const priceRow = (
    <div className="price">
      <p className="price__label">{t('weeklyPrice')}</p>
      <dl className="price__lines">
        <div className="price__line">
          <dt>{t('basePrice')}</dt>
          <dd>{money(BASE_WEEK_PRICE)}</dd>
        </div>
        <div className={`price__line ${chosenDays.length >= 5 ? 'is-added' : ''}`}>
          <dt>{t('extraDayPrice')}</dt>
          <dd>{money(EXTRA_DAY_PRICE)}</dd>
        </div>
        <div className="price__line price__line--total">
          <dt>{t('totalDue')}</dt>
          <dd>{money(price)}</dd>
        </div>
      </dl>
    </div>
  )

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
            {redirected && !hasActive && (
              <p className="sheet__redirect">{t('openWeekIs').replace('{n}', range)}</p>
            )}
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

        <p className={`sheet__window ${windowOpen ? 'is-open' : ''}`}>
          <ClockIcon className="sheet__windowIcon" />
          <span>{windowNote}</span>
        </p>

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

            {priceRow}

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
            <p className="sheet__label">{t('yourDays')}</p>
            <p className="sheet__help">{t('chooseDaysHelp')}</p>

            {/* Count first, then the days. Choosing a count pre-fills the
                quickest matching set; the chips stay editable after that. */}
            <div className="segment">
              {DAY_COUNTS.map((count) => {
                const active = chosenDays.length === count
                return (
                  <button
                    key={count}
                    type="button"
                    className={`segment__btn ${active ? 'is-active' : ''}`}
                    onClick={() => {
                      setChosenDays(SELECTABLE_DAYS.slice(0, count))
                      setError('')
                    }}
                  >
                    {t(dayCountLabelKey(count))}
                  </button>
                )
              })}
            </div>

            <div className="daypick">
              {selectableDayDates(fromISO(weekStart)).map((date) => {
                const day = date.getDay()
                const on = chosenDays.includes(day)
                const full = chosenDays.length >= 5 && !on
                return (
                  <button
                    key={day}
                    type="button"
                    className={`daypick__btn ${on ? 'is-active' : ''}`}
                    onClick={() => {
                      setChosenDays((prev) =>
                        prev.includes(day)
                          ? normalizeDays(prev.filter((d) => d !== day))
                          : normalizeDays([...prev, day])
                      )
                      setError('')
                    }}
                    disabled={full}
                    aria-pressed={on}
                  >
                    {formatDayShort(date, lang)}
                  </button>
                )
              })}
            </div>

            {priceRow}

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

            {blocked && <p className="sheet__warn">{t(blocked)}</p>}
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
                disabled={hasActive ? false : blocked !== null}
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
