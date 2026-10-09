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
  const { t, show, signUp, buses } = useApp()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pickupBus, setPickupBus] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<TranslationKey | null>(null)
  const [pending, setPending] = useState(false)

  const options = buses
  const noPlaces = options.length === 0

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setPending(true)
    setError(null)
    setNotice(null)

    const result = await signUp({ name, phone, email, password, pickupBus })
    setPending(false)

    if (result.ok) {
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

        <label className="field">
          <span className="field__label">
            <MapPinIcon className="field__icon" />
            {t('pickupBus')}
          </span>
          <select
            className="field__input"
            value={pickupBus}
            onChange={(e) => setPickupBus(e.target.value)}
            disabled={noPlaces}
            required={!noPlaces}
          >
            <option value="">{t('pickupBusChoose')}</option>
            {options.map((place) => (
              <option key={place.id} value={place.id}>
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