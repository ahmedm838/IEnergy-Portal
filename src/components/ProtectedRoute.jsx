import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { Alert, Button, Card, Spinner } from './ui'

/**
 * Gate for every authenticated route.
 *
 * This is a usability layer, not the security boundary — RLS in Postgres
 * is what actually stops a 'no_access' account reading data. Blocking here
 * just means they get a clear message instead of a page full of empty tables.
 */
export default function ProtectedRoute({ children, requireAdmin = false, requireSuperAdmin = false }) {
  const { session, profile, profileError, loading, role, signOut, mustSetPassword, passwordLinkPending, profileLoading } =
    useAuth()
  const location = useLocation()

  if (loading || profileLoading) return <Spinner label="Checking your session…" />

  // Two ways to arrive here owing a password: an invited account that has
  // never set one, and a recovery link just redeemed. Checked before the
  // session test, so a link that failed to redeem still reaches the page
  // that explains why rather than a bare sign-in form. Gated here and not
  // on a catch-all route, because "/" matches the dashboard and a catch-all
  // would never see it.
  if (mustSetPassword || passwordLinkPending) {
    return <Navigate to="/reset-password" replace />
  }

  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  if (profileError) {
    return (
      <Shell>
        <Alert tone="error" title="Could not load your profile">
          {profileError}
        </Alert>
      </Shell>
    )
  }

  // Signed in to Supabase but with no matching employees row.
  if (!profile) {
    return (
      <Shell>
        <Alert tone="warning" title="Your account is not linked to an employee record">
          You signed in successfully, but no employee in the system carries this email address.
          Ask an administrator to add you under <strong>Employees</strong> using the same address,
          then sign in again.
        </Alert>
        <div className="mt-4">
          <Button variant="secondary" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </Shell>
    )
  }

  if (role === 'no_access' || profile.is_active === false) {
    return (
      <Shell>
        <Alert tone="error" title="Access denied">
          Your account does not have permission to use this application. Contact HR if you believe
          this is a mistake.
        </Alert>
        <div className="mt-4">
          <Button variant="secondary" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </Shell>
    )
  }

  if (requireSuperAdmin && role !== 'super_admin') {
    return (
      <Shell>
        <Alert tone="warning" title="Super administrators only">
          This page changes company-wide reference data that every report depends on.
        </Alert>
      </Shell>
    )
  }

  if (requireAdmin && role !== 'admin' && role !== 'super_admin') {
    return (
      <Shell>
        <Alert tone="warning" title="Administrators only">
          This page edits company-wide data. Your role is read-only.
        </Alert>
      </Shell>
    )
  }

  return children
}

function Shell({ children }) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <Card className="p-6">{children}</Card>
    </div>
  )
}
