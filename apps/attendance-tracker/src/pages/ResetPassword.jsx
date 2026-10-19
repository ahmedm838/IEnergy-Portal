import { useState } from 'react'
import ThemeToggle from '../components/ThemeToggle'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { Alert, Button, Card, Field, Input } from '../components/ui'

/**
 * Landing page for the Supabase recovery link. By the time this renders the
 * SDK has already exchanged the link for a session, so updateUser is all
 * that remains.
 */
export default function ResetPassword() {
  const navigate = useNavigate()
  const { mustSetPassword, refreshProfile, user, session, loading, linkError, clearPasswordLink } =
    useAuth()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    setError(null)

    if (password.length < 8) {
      setError('Use at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('The two passwords do not match.')
      return
    }

    setBusy(true)
    // Clear the invite flag in the same call that sets the password, so the
    // two cannot disagree: the account is never left able to sign in while
    // still being bounced back here.
    const { error: updateError } = await supabase.auth.updateUser({
      password,
      data: { must_set_password: false },
    })
    setBusy(false)

    if (updateError) {
      setError(
        `${updateError.message}. If the link has expired, request a new one from the sign-in page.`,
      )
      return
    }
    setDone(true)
    clearPasswordLink()
    await refreshProfile()
    setTimeout(() => navigate('/', { replace: true }), 1500)
  }

  return (
    <div className="relative flex min-h-full items-center justify-center px-4 py-12">
      <ThemeToggle className="absolute right-4 top-4" />
      <div className="w-full max-w-sm">
        <h1 className="mb-2 text-center text-xl font-semibold text-ink">
          {mustSetPassword ? 'Set your password' : 'Choose a new password'}
        </h1>
        {mustSetPassword && (
          <p className="mb-6 text-center text-sm text-ink-3">
            Your account is ready. Choose a password to finish signing in.
          </p>
        )}
        <Card className="p-6">
          {linkError && (
            <Alert tone="error" title="That link could not be used">
              {linkError} Ask for a new one from the sign-in page.
            </Alert>
          )}

          {!loading && !session && !linkError && (
            <Alert tone="warning" title="This link is no longer valid">
              Password links expire and can only be used once. Request a new one from the sign-in
              page.
            </Alert>
          )}

          {!loading && session && !done && (
            <Alert tone="info" title="Check this is the right account">
              You are about to set the password for <strong>{user?.email}</strong>. If that is not
              the account you expected, sign out and open the link again.
            </Alert>
          )}

          {done ? (
            <Alert tone="success" title={mustSetPassword ? 'Password set' : 'Password updated'}>
              Taking you to the dashboard…
            </Alert>
          ) : !session ? null : (
            <form onSubmit={handleSubmit} className="mt-4 grid gap-4">
              {error && <Alert tone="error">{error}</Alert>}
              <Field label="New password" hint="At least 8 characters.">
                <Input
                  type="password"
                  autoComplete="new-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>
              <Field label="Confirm new password">
                <Input
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </Field>
              <Button type="submit" size="lg" disabled={busy}>
                {busy ? 'Saving…' : 'Update password'}
              </Button>
            </form>
          )}
        </Card>
      </div>
    </div>
  )
}
