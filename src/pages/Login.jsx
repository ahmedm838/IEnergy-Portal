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
                placeholder="ahmed.moustafa"
              />
            </Field>

            <Field label="Password">
              <Input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
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
