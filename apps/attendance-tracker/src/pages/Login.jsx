import { useEffect } from 'react'
import Logo from '../components/Logo'
import { Spinner } from '../components/ui'

/**
 * There is no sign-in here any more.
 *
 * The tracker is part of the iEnergy Portal, which has the only sign-in
 * on the site. Arriving here without a session means somebody opened the
 * tracker directly -- a bookmark, a link, or a refresh after the ten
 * minute idle timeout -- so this hands them to the portal rather than
 * asking for a password the portal has already asked for.
 *
 * A location change rather than a <Navigate>: the portal is a separate
 * document, not a route in this app. The path is relative for the same
 * reason the Vite base is -- so it holds wherever this is published --
 * and it replaces the history entry, so Back does not bounce straight
 * back here from the portal's sign-in screen.
 */
const PORTAL = '../'

export default function Login() {
  useEffect(() => {
    const timer = setTimeout(() => window.location.replace(PORTAL), 500)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="text-center">
        <Logo className="mx-auto h-12" />
        <h1 className="mt-4 text-xl font-semibold text-ink">Attendance Tracker</h1>
        <p className="mt-1 text-sm text-ink-3">Taking you to iEnergy Home to sign in…</p>
        <div className="mt-6">
          <Spinner />
        </div>
        <p className="mt-4 text-sm">
          <a
            className="font-medium text-brand-600 underline-offset-2 hover:underline dark:text-brand-400"
            href={PORTAL}
          >
            Go there now
          </a>
        </p>
      </div>
    </div>
  )
}
