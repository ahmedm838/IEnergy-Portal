import { Navigate, Route, Routes } from 'react-router-dom'
import { isConfigured } from './lib/supabase'
import { ONLY } from './lib/only'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import { Alert, Card } from './components/ui'

import Login from './pages/Login'
import ResetPassword from './pages/ResetPassword'
import Attendance from './pages/Attendance'
import EmployeeReport from './pages/EmployeeReport'
import MonthlyReport from './pages/MonthlyReport'
import HoursReport from './pages/HoursReport'
import Adjustments from './pages/Adjustments'
import Employees from './pages/Employees'
import Settings from './pages/Settings'

export default function App() {
  if (!isConfigured) return <MissingConfig />

  return (
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
        {/* The dashboard lives on the portal home page now, where it is
            the first thing anybody sees after signing in. Landing here
            goes to the employee report instead: the one page every role
            can open, so a user is not met with a refusal. */}
        <Route
          index
          element={<Navigate to={ONLY === 'settings' ? 'settings' : 'employee-report'} replace />}
        />
        <Route path="employee-report" element={<EmployeeReport />} />
        <Route
          path="monthly-report"
          element={
            <ProtectedRoute requireAdmin>
              <MonthlyReport />
            </ProtectedRoute>
          }
        />

        <Route
          path="hours-report"
          element={
            <ProtectedRoute requireAdmin>
              <HoursReport />
            </ProtectedRoute>
          }
        />
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
            <ProtectedRoute requireSuperAdmin>
              <Settings />
            </ProtectedRoute>
          }
        />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
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
