import { useEffect } from 'react'
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { isConfigured } from './lib/supabase'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import { Alert, Card } from './components/ui'

import Login from './pages/Login'
import ResetPassword from './pages/ResetPassword'
import Dashboard from './pages/Dashboard'
import Attendance from './pages/Attendance'
import EmployeeReport from './pages/EmployeeReport'
import MonthlyReport from './pages/MonthlyReport'
import Adjustments from './pages/Adjustments'
import Employees from './pages/Employees'
import Settings from './pages/Settings'

/**
 * Invite and password-reset links come back as
 * `.../?mode=set-password#access_token=...`. supabase-js consumes the
 * fragment to establish the session, which leaves HashRouter sitting at
 * "/" -- the dashboard -- with the person never asked to choose a
 * password. This spots the surviving query marker and sends them on.
 */
function AuthLinkHandler() {
  const navigate = useNavigate()

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('mode') !== 'set-password') return

    // Drop the marker so a later refresh does not loop back here.
    const clean = window.location.pathname
    window.history.replaceState({}, '', clean)
    navigate('/reset-password', { replace: true })
  }, [navigate])

  return null
}

export default function App() {
  if (!isConfigured) return <MissingConfig />

  return (
    <>
      <AuthLinkHandler />
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/reset-password" element={<ResetPassword />} />

      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="employee-report" element={<EmployeeReport />} />
        <Route path="monthly-report" element={<MonthlyReport />} />

        <Route
          path="attendance"
          element={
            <ProtectedRoute requireAdmin>
              <Attendance />
            </ProtectedRoute>
          }
        />
        <Route
          path="adjustments"
          element={
            <ProtectedRoute requireAdmin>
              <Adjustments />
            </ProtectedRoute>
          }
        />
        <Route
          path="employees"
          element={
            <ProtectedRoute requireAdmin>
              <Employees />
            </ProtectedRoute>
          }
        />
        <Route
          path="settings"
          element={
            <ProtectedRoute requireAdmin>
              <Settings />
            </ProtectedRoute>
          }
        />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </>
  )
}

function MissingConfig() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <Card className="p-6">
        <Alert tone="error" title="Supabase is not configured">
          <p>
            This build has no <code>VITE_SUPABASE_URL</code> or{' '}
            <code>VITE_SUPABASE_ANON_KEY</code>.
          </p>
          <p className="mt-2">
            Locally, copy <code>.env.example</code> to <code>.env.local</code> and fill both in. For
            the deployed site, add them as repository secrets so the GitHub Actions build can inject
            them — see the README.
          </p>
        </Alert>
      </Card>
    </div>
  )
}
