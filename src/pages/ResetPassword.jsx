import { useState } from 'react'
import ThemeToggle from '../components/ThemeToggle'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Alert, Button, Card, Field, Input } from '../components/ui'

/**
 * Landing page for the Supabase recovery link. By the time this renders the
 * SDK has already exchanged the link for a session, so updateUser is all
 * that remains.
 */
export default function ResetPassword() {
  const navigate = useNavigate()
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
    const { error: updateError } = await supabase.auth.updateUser({ password })
    setBusy(false)

    if (updateError) {
      setError(
        `${updateError.message}. If the link has expired, request a new one from the sign-in page.`,
      )
      return
    }
    setDone(true)
    setTimeout(() => navigate('/', { replace: true }), 1500)
  }

  return (
    <div className="relative flex min-h-full items-center justify-center px-4 py-12">
      <ThemeToggle className="absolute right-4 top-4" />
      <div className="w-full max-w-sm">
        <h1 className="mb-6 text-center text-xl font-semibold text-ink">
          Choose a new password
        </h1>
        <Card className="p-6">
          {done ? (
            <Alert tone="success" title="Password updated">
              Taking you to the dashboard…
            </Alert>
          ) : (
            <form onSubmit={handleSubmit} className="grid gap-4">
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
