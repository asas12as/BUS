import { NavLink, useNavigate } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import { BackIcon, BusIcon, HomeIcon, ProfileIcon, SettingsIcon, StatusIcon } from './Icons'

export function FooterNav() {
  const { t, isAdmin } = useApp()
  const navigate = useNavigate()

  const item = (to: string, label: string, Icon: typeof HomeIcon) => (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) => `footnav__item ${isActive ? 'is-active' : ''}`}
    >
      <Icon className="footnav__icon" />
      <span className="footnav__label">{label}</span>
    </NavLink>
  )

  return (
    <nav className="footnav">
      <div className="footnav__grid">
        <button
          type="button"
          className="footnav__item"
          onClick={() => {
            if (window.history.length > 1) navigate(-1)
            else navigate('/')
          }}
        >
          <BackIcon className="footnav__icon" />
          <span className="footnav__label">{t('back')}</span>
        </button>

        {item('/settings', t('settings'), SettingsIcon)}

        <NavLink to="/" end className="footnav__logo" aria-label={t('home')}>
          <BusIcon className="footnav__logoIcon" />
        </NavLink>

        {item('/statuses', t('statuses'), StatusIcon)}
        {item(isAdmin ? '/admin' : '/profile', t('profile'), ProfileIcon)}
      </div>
    </nav>
  )
}
