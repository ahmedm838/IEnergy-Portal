import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { Button, Card } from './ui'

/** Sign out after this long with no user action. */
const IDLE_MS = 10 * 60 * 1000
/** Warn this long before it happens. */
const WARN_MS = 60 * 1000
/** Don't write to storage on every mousemove. */
const THROTTLE_MS = 5000

const STORAGE_KEY = 'attendance-last-activity'

const ACTIVITY_EVENTS = [
  'mousedown',
  'mousemove',
  'keydown',
  'touchstart',
  'wheel',
  'scroll',
]

function readShared() {
  try {
    const value = Number(localStorage.getItem(STORAGE_KEY))
    return Number.isFinite(value) && value > 0 ? value : 0
  } catch {
    return 0
  }
}

function writeShared(at) {
  try {
    localStorage.setItem(STORAGE_KEY, String(at))
  } catch {
    // Blocked storage just means other tabs will not see this tab's
    // activity. This tab still times out correctly on its own.
  }
}

/**
 * Signs the user out after IDLE_MS without interaction.
 *
 * Activity is shared between tabs through localStorage, so working in one
 * tab does not let another tab expire and sign everyone out from under you.
 *
 * The warning exists because the attendance grid holds unsaved edits in
 * memory: dropping someone straight to the login screen at the ten minute
 * mark would silently discard a part-entered month.
 */
export default function IdleTimeout() {
  const { session, signOut } = useAuth()
  const navigate = useNavigate()

  const lastActivity = useRef(Date.now())
  const warningRef = useRef(false)
  const signingOut = useRef(false)
  const [warning, setWarning] = useState(false)
  const [remaining, setRemaining] = useState(Math.ceil(WARN_MS / 1000))

  const markActive = useCallback((shareNow = false) => {
    const now = Date.now()
    // While the warning is up, only the explicit button clears it --
    // otherwise a brush of the mouse would dismiss it unnoticed.
    if (warningRef.current && !shareNow) return
    lastActivity.current = now
    if (shareNow || now - readShared() > THROTTLE_MS) writeShared(now)
  }, [])

  const staySignedIn = useCallback(() => {
    warningRef.current = false
    setWarning(false)
    lastActivity.current = Date.now()
    writeShared(Date.now())
  }, [])

  useEffect(() => {
    if (!session) return undefined

    lastActivity.current = Date.now()
    writeShared(Date.now())
    warningRef.current = false
    setWarning(false)
    signingOut.current = false

    const onActivity = () => markActive(false)
    for (const type of ACTIVITY_EVENTS) {
      window.addEventListener(type, onActivity, { passive: true })
    }

    // Another tab reporting activity keeps this one alive.
    const onStorage = (event) => {
      if (event.key !== STORAGE_KEY) return
      const shared = Number(event.newValue)
      if (Number.isFinite(shared) && shared > lastActivity.current) {
        lastActivity.current = shared
        if (warningRef.current) {
          warningRef.current = false
          setWarning(false)
        }
      }
    }
    window.addEventListener('storage', onStorage)

    const tick = setInterval(async () => {
      const newest = Math.max(lastActivity.current, readShared())
      lastActivity.current = newest
      const idle = Date.now() - newest

      if (idle >= IDLE_MS) {
        if (signingOut.current) return
        signingOut.current = true
        clearInterval(tick)
        try {
          await signOut()
        } finally {
          navigate('/login', { replace: true, state: { reason: 'idle' } })
        }
        return
      }

      if (idle >= IDLE_MS - WARN_MS) {
        warningRef.current = true
        setWarning(true)
        setRemaining(Math.max(0, Math.ceil((IDLE_MS - idle) / 1000)))
      } else if (warningRef.current) {
        warningRef.current = false
        setWarning(false)
      }
    }, 1000)

    return () => {
      for (const type of ACTIVITY_EVENTS) window.removeEventListener(type, onActivity)
      window.removeEventListener('storage', onStorage)
      clearInterval(tick)
    }
  }, [session, markActive, signOut, navigate])

  if (!warning) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="idle-title"
    >
      <Card className="w-full max-w-sm p-6 text-center">
        <h2 id="idle-title" className="text-base font-semibold text-ink">
          Still there?
        </h2>
        <p className="mt-2 text-sm text-ink-3">
          You will be signed out in{' '}
          <span className="tabular font-semibold text-ink">{remaining}s</span> because of
          inactivity. Any unsaved attendance changes would be lost.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <Button onClick={staySignedIn}>Stay signed in</Button>
          <Button
            variant="secondary"
            onClick={async () => {
              await signOut()
              navigate('/login', { replace: true })
            }}
          >
            Sign out now
          </Button>
        </div>
      </Card>
    </div>
  )
}
