import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import { applyTheme, resolveTheme, storeTheme } from '../lib/theme'
import type { Theme } from '../lib/types'
import { BusIcon, MoonIcon, QrCodeIcon, ShieldIcon, SunIcon } from './Icons'
import { Avatar } from './Avatar'
import { QrSheet } from './QrSheet'
import { weekKey } from '../lib/date'

export function Header() {
  const { t, currentUser, isAdmin } = useApp()
  const [theme, setTheme] = useState<Theme>(() => resolveTheme())
  const [qrOpen, setQrOpen] = useState(false)

  // Keep the document in step with state. This runs after the inline script in
  // index.html has already handled first paint, so it only matters once the
  // user actually toggles.
  useEffect(() => {
    applyTheme(theme)
    storeTheme(theme)
    const meta = document.querySelector('meta[name="theme-color"]')
    meta?.setAttribute('content', theme === 'dark' ? '#000000' : '#15803d')
  }, [theme])

  if (!currentUser) return null

  const next: Theme = theme === 'dark' ? 'light' : 'dark'

  return (
    <>
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

      <div className="app-header__actions">
        <button
          type="button"
          className="icon-btn themebtn"
          onClick={() => setTheme(next)}
          aria-label={next === 'dark' ? t('switchToDark') : t('switchToLight')}
          title={next === 'dark' ? t('switchToDark') : t('switchToLight')}
        >
          {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
        </button>

        {/* Sits directly beside the theme toggle, as asked. Opens on the week
            the rider holds, or the week on offer when they hold none. */}
        <button
          type="button"
          className="icon-btn themebtn"
          onClick={() => setQrOpen(true)}
          aria-label={t('myQr')}
          title={t('myQr')}
        >
          <QrCodeIcon />
        </button>

        {/* Admin only. The route is already guarded by RequireAdmin, but the
            button is hidden for everyone else rather than left there to bounce
            them back to the home page. Sits ahead of the account link, which is
            the one thing in the header that should read as the last item. */}
        {isAdmin && (
          <Link
            to="/admin"
            className="icon-btn themebtn"
            aria-label={t('adminPanel')}
            title={t('adminPanel')}
          >
            <ShieldIcon />
          </Link>
        )}

        <Link to="/profile" className="app-header__user" aria-label={currentUser.name} title={currentUser.name}>
          <span className="app-header__name">{currentUser.name}</span>
          <Avatar name={currentUser.name} src={currentUser.avatar} variant="md" />
        </Link>
      </div>
      </header>

      {/* A sibling of the header rather than a child: it is a dialog, not
          header content. */}
      {qrOpen && <QrSheet requestedWeek={weekKey(new Date())} onClose={() => setQrOpen(false)} />}
    </>
  )
}