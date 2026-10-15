import { useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { Alert, Button, Card, Field, Input, Spinner } from '../components/ui'

export default function Login() {
  const { session, loading, signIn, resetPassword } = useAuth()
  const location = useLocation()

  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)

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

  async function handleReset() {
    if (!identifier.trim()) {
      setError('Enter your username or email first, then choose “Forgot password”.')
      return
    }
    setBusy(true)
    setError(null)
    const { error: resetError } = await resetPassword(identifier)
    setBusy(false)
    if (resetError) setError(resetError.message)
    else setNotice(`If that account exists, a reset link is on its way.`)
  }

  return (
    <div className="flex min-h-full items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 text-lg font-bold text-white">
            iE
          </div>
          <h1 className="text-xl font-semibold text-slate-900">Attendance Tracker</h1>
          <p className="mt-1 text-sm text-slate-500">Sign in to continue</p>
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

            <button
              type="button"
              onClick={handleReset}
              disabled={busy}
              className="text-center text-xs text-slate-500 underline-offset-2 hover:text-brand-700 hover:underline"
            >
              Forgot password?
            </button>
          </form>
        </Card>
      </div>
    </div>
  )
}
