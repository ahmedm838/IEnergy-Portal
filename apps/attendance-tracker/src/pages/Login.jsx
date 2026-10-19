import { useState } from 'react'
import ThemeToggle from '../components/ThemeToggle'
import Logo from '../components/Logo'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { Alert, Button, Card, Field, Input, Spinner } from '../components/ui'

export default function Login() {
  const { session, loading, signIn } = useAuth()
  const location = useLocation()

  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(
    location.state?.reason === 'idle'
      ? 'You were signed out after 10 minutes of inactivity.'
      : null,
  )

  if (loading) return <Spinner label="Checking your session…" />
  if (session) return <Navigate to={location.state?.from?.pathname || '/'} replace />

  async function handleSubmit(event) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setNotice(null)
    const { error: signInError } = await signIn(identifier, password)
    if (signInError) {
      // Supabase returns the same message for unknown account and wrong
      // password, which is the behaviour we want — don't leak which it was.
      setError(
        signInError.message === 'Invalid login credentials'
          ? 'Those sign-in details do not match an account.'
          : signInError.message,
      )
    }
    setBusy(false)
  }

  return (
    <div className="relative flex min-h-full items-center justify-center px-4 py-12">
      <ThemeToggle className="absolute right-4 top-4" />
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <Logo className="mx-auto mb-4 h-14" />
          <h1 className="text-xl font-semibold text-ink">Attendance Tracker</h1>
          <p className="mt-1 text-sm text-ink-3">Sign in to continue</p>
        </div>

        <Card className="p-6">
          <form onSubmit={handleSubmit} className="grid gap-4">
            {error && <Alert tone="error">{error}</Alert>}
            {notice && <Alert tone="success">{notice}</Alert>}

            <Field label="Username or email" hint="Your username is the part before the @.">
              <Input
                type="text"
                autoComplete="username"
                required
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
              />
            </Field>

            <Field label="Password">
              {/* The eye starts off, so a password is hidden unless
                  somebody asks to see it. The button is not a tab stop:
                  tabbing from the password box should reach Sign in. */}
              <div className="relative">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pr-10"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPassword((on) => !on)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  title={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute inset-y-0 right-0 flex w-10 items-center justify-center
                             text-ink-4 transition hover:text-ink-2"
                >
                  <EyeIcon off={!showPassword} />
                </button>
              </div>
            </Field>

            <Button type="submit" size="lg" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>

            {/* No self-service reset: a super admin sets a temporary
                password instead, so there is nothing to click here. */}
            <p className="text-center text-xs text-ink-4">
              Forgotten your password? Ask a super admin to set a new one for you.
            </p>
          </form>
        </Card>
      </div>
    </div>
  )
}

/**
 * An eye, struck through when the password is hidden.
 *
 * Drawn here rather than pulled from an icon set: it is two paths, and
 * the sign-in page is the one screen that must not wait on anything.
 */
function EyeIcon({ off }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z" />
      <circle cx="12" cy="12" r="2.8" />
      {off && <path d="M4 20 20 4" />}
    </svg>
  )
}
