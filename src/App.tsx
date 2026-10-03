import { Navigate, Route, Routes } from 'react-router-dom'
import { AppProvider, useApp } from './context/AppContext'
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
 * Without localStorage nothing can be saved, so say so instead of letting the
 * user type a subscription that silently disappears.
 */
function StorageWarning() {
  const { storageOk, t } = useApp()
  if (storageOk) return null
  return (
    <div className="storagewarn" role="alert">
      {t('storageBlocked')}
    </div>
  )
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
        <StorageWarning />
        <AppRoutes />
      </AppRouter>
    </AppProvider>
  )
}
