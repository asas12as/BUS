import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import type { TranslationKey } from '../i18n/translations'
import { LockIcon, LogoutIcon, MailIcon, PhoneIcon, UserIcon } from '../components/Icons'

export function Profile() {
  const { t, lang, currentUser, updateProfile, changePassword, logout } = useApp()
  const navigate = useNavigate()
  const [name, setName] = useState(currentUser?.name ?? '')
  const [phone, setPhone] = useState(currentUser?.phone ?? '')
  const [email, setEmail] = useState(currentUser?.email ?? '')
  const [message, setMessage] = useState<TranslationKey | null>(null)
  const [error, setError] = useState<TranslationKey | null>(null)
  const [curPass, setCurPass] = useState('')
  const [newPass, setNewPass] = useState('')

  if (!currentUser) return null

  const save = (e: React.FormEvent) => {
    e.preventDefault()
    const result = updateProfile({ name, phone, email })
    if (result.ok) {
      setMessage('updated')
      setError(null)
    } else {
      setError(result.error ?? 'requiredFields')
      setMessage(null)
    }
  }

  const changePass = (e: React.FormEvent) => {
    e.preventDefault()
    const result = changePassword(curPass, newPass)
    if (result.ok) {
      setMessage('updated')
      setError(null)
      setCurPass('')
      setNewPass('')
    } else {
      setError(result.error ?? 'invalidCredentials')
      setMessage(null)
    }
  }

  return (
    <div className="page">
      <section className="page__head">
        <h1 className="page__title">{t('profile')}</h1>
        <p className="page__sub">
          {t('memberSince')}{' '}
          {new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG' : 'en-GB', {
            day: 'numeric',
            month: 'long',
            year: 'numeric'
          }).format(new Date(currentUser.createdAt))}
        </p>
      </section>

      <section className="card">
        <form className="form" onSubmit={save}>
          <label className="field">
            <span className="field__label">
              <UserIcon className="field__icon" />
              {t('fullName')}
            </span>
            <input className="field__input" value={name} onChange={(e) => setName(e.target.value)} />
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
              dir="ltr"
              inputMode="tel"
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
              dir="ltr"
              inputMode="email"
            />
          </label>
          <button type="submit" className="btn btn--primary btn--block">
            {t('update')}
          </button>
        </form>
      </section>

      <section className="card">
        <h2 className="card__title">
          <LockIcon className="card__titleIcon" />
          {t('changePassword')}
        </h2>
        <form className="form" onSubmit={changePass}>
          <label className="field">
            <span className="field__label">{t('currentPassword')}</span>
            <input
              className="field__input"
              type="password"
              value={curPass}
              onChange={(e) => setCurPass(e.target.value)}
              autoComplete="current-password"
            />
          </label>
          <label className="field">
            <span className="field__label">{t('newPassword')}</span>
            <input
              className="field__input"
              type="password"
              value={newPass}
              onChange={(e) => setNewPass(e.target.value)}
              autoComplete="new-password"
            />
          </label>
          <button type="submit" className="btn btn--primary btn--block">
            {t('update')}
          </button>
        </form>
      </section>

      {message && <p className="form__ok">{t(message)}</p>}
      {error && <p className="form__error">{t(error)}</p>}

      <button
        type="button"
        className="btn btn--danger btn--block"
        onClick={() => {
          logout()
          navigate('/login')
        }}
      >
        <LogoutIcon className="btn__icon" />
        {t('logout')}
      </button>
    </div>
  )
}
