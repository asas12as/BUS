import { useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Header } from './Header'
import { FooterNav } from './FooterNav'

export function Layout() {
  const { pathname } = useLocation()

  useEffect(() => {
    const main = document.querySelector('.app__main')
    if (main) main.scrollTo({ top: 0, behavior: 'auto' })
  }, [pathname])

  return (
    <div className="app">
      <Header />
      <main className="app__main" key={pathname}>
        <div className="anim-page">
          <Outlet />
        </div>
      </main>
      <FooterNav />
    </div>
  )
}
