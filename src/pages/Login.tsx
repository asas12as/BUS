import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useApp } from '../context/useApp'
import { LockIcon, MailIcon } from '../components/Icons'
import { AuthShell } from './SignUp'

export function Login() {
  const { t, show, login } = useApp()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  // Awaited: the sign-in is a round trip to the auth server, and the redirect
  // needs the answer. isAdmin is read after the fact because role comes from the
  // profile row the sign-in loads, not from anything known before it.
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setPending(true)
    setError(null)
    const result = await login(email, password)
    // The role comes back with the result rather than from `isAdmin`, which is
    // still false here: context has not re-rendered yet, so the pre-sign-in
    // value is read.
    if (result.ok) navigate(result.role === 'admin' ? '/admin' : '/')
    else setError(show(result.error) ?? t('invalidCredentials'))
    setPending(false)
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

        {error && <p className="form__error">{error}</p>}

        <button type="submit" className="btn btn--primary btn--block" disabled={pending}>
          {pending ? t('signingIn') : t('signIn')}
        </button>
      </form>
      <p className="auth__hint">{t('adminHint')}</p>
      <p className="auth__switch">
        {t('noAccountYet')} <Link to="/signup">{t('signUp')}</Link>
      </p>
    </AuthShell>
  )
}
