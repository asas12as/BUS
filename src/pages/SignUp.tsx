import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import type { TranslationKey } from '../i18n/translations'
import { BusIcon, LockIcon, MailIcon, PhoneIcon, UserIcon } from '../components/Icons'

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
  const { t, signUp, isAdmin } = useApp()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<TranslationKey | null>(null)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const result = signUp({ name, phone, email, password })
    if (result.ok) navigate(isAdmin ? '/admin' : '/')
    else setError(result.error ?? 'requiredFields')
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
          />
        </label>

        <label className="field">
          <span className="field__label">
            <MailIcon className="field__icon" />
            {t('email')}
          </span>
          <input
            className="field__input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('emailPlaceholder')}
            inputMode="email"
            autoComplete="email"
            dir="ltr"
          />
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
          />
        </label>

        {error && <p className="form__error">{t(error)}</p>}

        <button type="submit" className="btn btn--primary btn--block">
          {t('signUp')}
        </button>
      </form>
      <p className="auth__switch">
        {t('alreadyRegistered')} <Link to="/login">{t('signIn')}</Link>
      </p>
    </AuthShell>
  )
}
