import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../context/useApp'
import type { TranslationKey } from '../i18n/translations'
import { processAvatarFile } from '../lib/avatar'
import { Avatar } from '../components/Avatar'
import { CameraIcon, LockIcon, LogoutIcon, MailIcon, MapPinIcon, PhoneIcon, UserIcon } from '../components/Icons'

export function Profile() {
  const { t, show, lang, currentUser, updateProfile, changePassword, logout, places } = useApp()
  const navigate = useNavigate()
  const [name, setName] = useState(currentUser?.name ?? '')
  const [phone, setPhone] = useState(currentUser?.phone ?? '')
  const [email] = useState(currentUser?.email ?? '')
  const [pickupLocation, setPickupLocation] = useState(
    currentUser?.pickupLocation ?? places.find((p) => p.id === currentUser?.pickupId)?.name ?? ''
  )
  // Success is always a key this file chooses; failure may be a key or prose
  // from the server, so it is rendered through show() rather than t().
  const [message, setMessage] = useState<TranslationKey | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [curPass, setCurPass] = useState('')
  const [newPass, setNewPass] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  if (!currentUser) return null

  const pickPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    // Reset immediately so choosing the same file twice still fires a change.
    e.target.value = ''
    if (!file) return

    setBusy(true)
    const result = await processAvatarFile(file)
    setBusy(false)

    if (!result.ok) {
      setError(
        result.error === 'notAnImage'
          ? 'photoNotImage'
          : result.error === 'tooLarge'
            ? 'photoTooLarge'
            : 'photoEncodeFailed'
      )
      setMessage(null)
      return
    }

    const saved = await updateProfile({ avatar: result.dataUrl })
    if (saved.ok) {
      setMessage('photoSaved')
      setError(null)
    } else {
      setError(show(saved.error) ?? t('photoEncodeFailed'))
      setMessage(null)
    }
  }

  const removePhoto = async () => {
    const saved = await updateProfile({ avatar: null })
    if (saved.ok) {
      setMessage('photoRemoved')
      setError(null)
    } else {
      setError(show(saved.error) ?? t('photoEncodeFailed'))
      setMessage(null)
    }
  }

  // Email is not editable here. It is the login identity and lives in
  // auth.users, which a client cannot write, so offering the field would only
  // ever accept a change and silently drop it.
  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    const result = await updateProfile({ name, phone, pickupLocation })
    if (result.ok) {
      setMessage('updated')
      setError(null)
    } else {
      setError(show(result.error) ?? t('requiredFields'))
      setMessage(null)
    }
  }

  const changePass = async (e: React.FormEvent) => {
    e.preventDefault()
    const result = await changePassword(curPass, newPass)
    if (result.ok) {
      setMessage('updated')
      setError(null)
      setCurPass('')
      setNewPass('')
    } else {
      setError(show(result.error) ?? t('invalidCredentials'))
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
        <h2 className="card__title">
          <CameraIcon className="card__titleIcon" />
          {t('profilePhoto')}
        </h2>
        <div className="photopicker">
          <Avatar name={currentUser.name} src={currentUser.avatar} variant="lg" />
          <div className="photopicker__actions">
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
            >
              {busy ? '...' : currentUser.avatar ? t('changePhoto') : t('addPhoto')}
            </button>
            {currentUser.avatar && (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={removePhoto}
                disabled={busy}
              >
                {t('removePhoto')}
              </button>
            )}
            <small className="photopicker__hint">{t('photoHint')}</small>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="photopicker__input"
            onChange={pickPhoto}
          />
        </div>
      </section>

      <section className="card">
        <form className="form" onSubmit={save}>
          <label className="field">
            <span className="field__label">
              <UserIcon className="field__icon" />
              {t('fullName')}
            </span>
            <input
              className="field__input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              minLength={3}
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
              dir="ltr"
              inputMode="tel"
            />
          </label>
          <label className="field">
            <span className="field__label">
              <MailIcon className="field__icon" />
              {t('email')}
            </span>
            {/* Read only: the address identifies the account and cannot be
                changed from a client. An admin can correct it from the dashboard. */}
            <input className="field__input" value={email} dir="ltr" readOnly />
            <small className="field__hint">{t('emailLockedHint')}</small>
          </label>
          <label className="field">
            <span className="field__label">
              <MapPinIcon className="field__icon" />
              {t('pickupLocation')}
            </span>
            <input
              className="field__input"
              list="profile-places"
              value={pickupLocation}
              onChange={(e) => setPickupLocation(e.target.value)}
              placeholder={t('pickupLocationPlaceholder')}
              autoComplete="off"
            />
          </label>
          <datalist id="profile-places">
            {places.map((place) => (
              <option key={place.id} value={place.name} />
            ))}
          </datalist>
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
      {error && <p className="form__error">{error}</p>}

      <button
        type="button"
        className="btn btn--danger btn--block"
        onClick={() => {
          // Awaited before navigating: the sign-out also clears the cached
          // snapshot, and navigating first would briefly render the app with the
          // previous rider's name still on it.
          void logout().then(() => navigate('/login'))
        }}
      >
        <LogoutIcon className="btn__icon" />
        {t('logout')}
      </button>
    </div>
  )
}
