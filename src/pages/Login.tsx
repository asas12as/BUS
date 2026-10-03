import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import type { TranslationKey } from '../i18n/translations'
import { LockIcon, MailIcon } from '../components/Icons'
import { AuthShell } from './SignUp'

export function Login() {
  const { t, login, isAdmin } = useApp()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<TranslationKey | null>(null)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const result = login(email, password)
    if (result.ok) navigate(isAdmin ? '/admin' : '/')
    else setError(result.error ?? 'invalidCredentials')
  }

  return (
    <AuthShell>
      <h2 className="auth__title">{t('welcomeBack')}</h2>
      <form className="form" onSubmit={submit} noValidate>
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
            autoComplete="current-password"
          />
        </label>

        {error && <p className="form__error">{t(error)}</p>}

        <button type="submit" className="btn btn--primary btn--block">
          {t('signIn')}
        </button>
      </form>
      <p className="auth__hint">{t('adminHint')}</p>
      <p className="auth__switch">
        {t('noAccountYet')} <Link to="/signup">{t('signUp')}</Link>
      </p>
    </AuthShell>
  )
}
