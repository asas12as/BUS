import { Navigate, Route, Routes } from 'react-router-dom'
import { AppProvider } from './context/AppContext'
import { useApp } from './context/useApp'
import { AppRouter } from './AppRouter'
import { Layout } from './components/Layout'
import { SignUp } from './pages/SignUp'
import { Login } from './pages/Login'
import { Home } from './pages/Home'
import { Statuses } from './pages/Statuses'
import { Profile } from './pages/Profile'
import { Settings } from './pages/Settings'
import { AdminDashboard } from './pages/AdminDashboard'
import { Scan } from './pages/Scan'

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { currentUser } = useApp()
  if (!currentUser) return <Navigate to="/login" replace />
  return <>{children}</>
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { currentUser, isAdmin } = useApp()
  if (!currentUser) return <Navigate to="/login" replace />
  if (!isAdmin) return <Navigate to="/" replace />
  return <>{children}</>
}

function PublicOnly({ children }: { children: React.ReactNode }) {
  const { currentUser, isAdmin } = useApp()
  if (currentUser) return <Navigate to={isAdmin ? '/admin' : '/'} replace />
  return <>{children}</>
}

/**
 * Three states worth interrupting for, and nothing else.
 *
 * A missing database, no network, and a cache that could not be written are all
 * cases where the app is showing something that is not the server's answer. Left
 * unsaid, a rider would tap subscribe, see it appear, and believe it worked.
 *
 * Deliberately not shown: the cache itself. Offline is a supported state, and the
 * per-screen indicators already say which parts are not current.
 */
function ConnectionWarnings() {
  const { online, stale, booting, t } = useApp()
  if (booting) return null

  if (!online) {
    return (
      <div className="storagewarn" role="status">
        {stale ? t('offlineStale') : t('offlineReadOnly')}
      </div>
    )
  }
  return null
}

function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <PublicOnly>
            <Login />
          </PublicOnly>
        }
      />
      <Route
        path="/signup"
        element={
          <PublicOnly>
            <SignUp />
          </PublicOnly>
        }
      />

      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<Home />} />
        <Route path="/statuses" element={<Statuses />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/settings" element={<Settings />} />
        <Route
          path="/admin"
          element={
            <RequireAdmin>
              <AdminDashboard />
            </RequireAdmin>
          }
        />
        {/* Admin only: scanning reads other riders' names and weekly numbers,
            which is a driver's job and not every account's business. */}
        <Route
          path="/scan"
          element={
            <RequireAdmin>
              <Scan />
            </RequireAdmin>
          }
        />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <AppProvider>
      <AppRouter>
        <ConnectionWarnings />
        <AppRoutes />
      </AppRouter>
    </AppProvider>
  )
}
