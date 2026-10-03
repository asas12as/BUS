import { useNavigate } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import { GlobeIcon, LogoutIcon, ShieldIcon } from '../components/Icons'

export function Settings() {
  const { t, lang, toggleLang, currentUser, isAdmin, logout } = useApp()
  const navigate = useNavigate()

  return (
    <div className="page">
      <section className="page__head">
        <h1 className="page__title">{t('settings')}</h1>
        <p className="page__sub">{t('appName')}</p>
      </section>

      <section className="card">
        <h2 className="card__title">
          <GlobeIcon className="card__titleIcon" />
          {t('language')}
        </h2>
        <div className="segmented" role="group" aria-label={t('language')}>
          <button
            type="button"
            className={`segmented__btn ${lang === 'en' ? 'is-active' : ''}`}
            onClick={() => lang !== 'en' && toggleLang()}
          >
            {t('english')}
          </button>
          <button
            type="button"
            className={`segmented__btn ${lang === 'ar' ? 'is-active' : ''}`}
            onClick={() => lang !== 'ar' && toggleLang()}
          >
            {t('arabic')}
          </button>
        </div>
      </section>

      <section className="card">
        <h2 className="card__title">
          <ShieldIcon className="card__titleIcon" />
          {t('role')}
        </h2>
        <ul className="kv">
          <li>
            <span>{t('email')}</span>
            <strong dir="ltr">{currentUser?.email}</strong>
          </li>
          <li>
            <span>{t('role')}</span>
            <strong>{isAdmin ? t('admin') : t('user')}</strong>
          </li>
          {isAdmin && (
            <li>
              <span>{t('internalId')}</span>
              <strong dir="ltr">{currentUser?.id}</strong>
            </li>
          )}
        </ul>
      </section>

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
