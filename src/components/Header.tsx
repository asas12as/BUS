import { Link } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import { BusIcon, ProfileIcon } from './Icons'

export function Header() {
  const { t, currentUser } = useApp()

  if (!currentUser) return null

  return (
    <header className="app-header">
      <Link to="/" className="app-header__brand">
        <span className="app-header__brandIcon">
          <BusIcon />
        </span>
        <span className="app-header__brandText">
          <strong>{t('appName')}</strong>
          <small>{t('tagline')}</small>
        </span>
      </Link>

      <Link to="/profile" className="app-header__user">
        <span className="app-header__name">{currentUser.name}</span>
        <span className="app-header__avatar">
          <ProfileIcon />
        </span>
      </Link>
    </header>
  )
}
