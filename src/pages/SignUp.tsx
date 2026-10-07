import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useApp } from '../context/useApp'
import type { TranslationKey } from '../i18n/translations'
import { BusIcon, LockIcon, MailIcon, MapPinIcon, PhoneIcon, UserIcon } from '../components/Icons'

export function AuthShell({ children }: { children: React.ReactNode }) {
  const { t, lang, toggleLang } = useApp()
  return (
    <div className="auth">
      <button type="button" className="auth__lang" onClick={toggleLang}>
        {lang === 'en' ? t('arabic') : t('english')}
      </button>
      <div className="auth__brand">
        <span className="auth__logo">
          <BusIcon />
        </span>
        <h1>{t('appName')}</h1>
        <p>{t('tagline')}</p>
      </div>
      <div className="auth__card">{children}</div>
    </div>
  )
}

export function SignUp() {
  const { t, show, signUp, places } = useApp()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pickupLocation, setPickupLocation] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<TranslationKey | null>(null)
  const [pending, setPending] = useState(false)

  // The buses an admin has published. Archived ones are already filtered out by
  // the context, so whatever is here is a place a rider may actually be picked up
  // from.
  //
  // An empty list is not an error state to apologise for: it is a fresh install
  // with nothing published yet. The field is disabled, and the first account to
  // arrive becomes the admin who adds the buses -- so the form says that plainly
  // rather than implying the rider has done something wrong.
  const options = places.filter((place) => place.active)
  const noPlaces = options.length === 0

  /**
   * Awaited, and the outcome has two shapes.
   *
   * With email confirmation on, GoTrue creates the account but returns no
   * session. That is a success from the rider's point of view -- the account
   * exists -- so it shows "check your email" rather than an error, and there is
   * nothing to navigate to.
   */
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setPending(true)
    setError(null)
    setNotice(null)

    const result = await signUp({ name, phone, email, password, pickupLocation })
    setPending(false)

    if (result.ok) {
      // From the result, not from `isAdmin`: that is still the pre-sign-up
      // value, since the context has not re-rendered by the time we navigate.
      navigate(result.role === 'admin' ? '/admin' : '/')
      return
    }
    if (result.needsConfirmation) setNotice('checkYourEmail')
    else setError(show(result.error) ?? t('requiredFields'))
  }

  return (
    <AuthShell>
      <h2 className="auth__title">{t('createAccount')}</h2>
      <form className="form" onSubmit={submit} noValidate>
        <label className="field">
          <span className="field__label">
            <UserIcon className="field__icon" />
            {t('fullName')}
          </span>
          <input
            className="field__input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('namePlaceholder')}
            autoComplete="name"
            required
          />
        </label>

        <label className="field">
          <span className="field__label">
            <PhoneIcon className="field__icon" />
            {t('phoneNumber')}
          </span>
          <input
            className="field__input"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder={t('phonePlaceholder')}
            inputMode="tel"
            autoComplete="tel"
            dir="ltr"
            required
          />
        </label>

        <label className="field">
          <span className="field__label">
            <MailIcon className="field__icon" />
            {t('emailOptional')}
          </span>
          <input
            className="field__input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('emailOptionalPlaceholder')}
            inputMode="email"
            autoComplete="email"
            dir="ltr"
          />
        </label>

        {/* Chosen from the buses an admin maintains, not typed in.
            Required once there are any, because the pickup decides who to expect
            on the bus. */}
        <label className="field">
          <span className="field__label">
            <MapPinIcon className="field__icon" />
            {t('pickupBus')}
          </span>
          <select
            className="field__input"
            value={pickupLocation}
            onChange={(e) => setPickupLocation(e.target.value)}
            disabled={noPlaces}
            required={!noPlaces}
          >
            <option value="">{t('pickupBusChoose')}</option>
            {options.map((place) => (
              <option key={place.id} value={place.name}>
                {place.name}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field__label">
            <LockIcon className="field__icon" />
            {t('password')}
          </span>
          <input
            className="field__input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t('passwordPlaceholder')}
            autoComplete="new-password"
            required
          />
        </label>

        {notice && <p className="form__ok">{t(notice)}</p>}
        {error && <p className="form__error">{error}</p>}

        <button type="submit" className="btn btn--primary btn--block" disabled={pending}>
          {pending ? t('signingIn') : t('signUp')}
        </button>
      </form>
      <p className="auth__switch">
        {t('alreadyRegistered')} <Link to="/login">{t('signIn')}</Link>
      </p>
    </AuthShell>
  )
}
