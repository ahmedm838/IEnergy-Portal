import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { ONLY } from '../lib/only'
import { Badge, Button, cx } from './ui'
import ThemeToggle from './ThemeToggle'
import Logo from './Logo'
import IdleTimeout from './IdleTimeout'
import UpdateBanner from './UpdateBanner'

/* The portal is the document above this one. Relative, for the same
   reason the Vite base is: so it holds wherever this is published. */
const PORTAL = '../'

const NAV = [
  { to: '/attendance', label: 'Attendance', adminOnly: true },
  { to: '/employee-report', label: 'Employee report' },
  { to: '/monthly-report', label: 'Monthly report', adminOnly: true },
  { to: '/hours-report', label: 'Hours report', adminOnly: true },
  { to: '/adjustments', label: 'Adjustments', adminOnly: true },
  { to: '/employees', label: 'Employees', adminOnly: true },
]

/* Settings is deliberately absent from the list above. It is a super
   admin's job, not a daily one, so it has its own tile on the portal
   and opens here on its own: the tracker's shell with a single button
   in the nav. */
const SETTINGS_NAV = [{ to: '/settings', label: 'Settings' }]

export default function Layout() {
  const { profile, isAdmin, isSuperAdmin, signOut } = useAuth()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)

  const items =
    ONLY === 'report'
      ? []
      : ONLY === 'settings'
        ? SETTINGS_NAV
        : NAV.filter((item) => !item.adminOnly || isAdmin)

  /* Opened as Settings, it says Settings. The tile that got you here
     said so, and these settings are the site's rather than this app's,
     so carrying the tracker's name over would misdescribe the page. */
  const wordmark = ONLY === 'settings' ? 'Settings' : 'Attendance Tracker'

  /* There is one session for the whole site, so signing out here signs
     you out of the portal and the Employee Database too. The landing
     place is the portal's sign-in, which is the only one there is. */
  async function handleSignOut() {
    await signOut()
    window.location.replace(PORTAL)
  }

  return (
    <div className="flex min-h-full flex-col">
      <IdleTimeout />
      <header className="no-print sticky top-0 z-30 border-b border-line bg-panel/90 backdrop-blur">
        <div className="flex w-full items-center gap-4 px-3 py-3 sm:px-5">
          <div className="flex items-center gap-2.5">
            <Logo className="h-8" />
            <span className="text-sm font-semibold text-ink">{wordmark}</span>
          </div>

          <nav className="hidden flex-1 items-center gap-1 lg:flex">
            {items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cx(
                    'whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition',
                    isActive
                      ? 'bg-brand-50 text-brand-700'
                      : 'text-ink-2 hover:bg-hover hover:text-ink',
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium text-ink">{profile?.name}</p>
            </div>
            <Badge tone={isSuperAdmin ? 'green' : isAdmin ? 'blue' : 'slate'}>
              {isSuperAdmin ? 'Super admin' : isAdmin ? 'Admin' : 'User'}
            </Badge>
            <ThemeToggle />
            {/* Back to the portal with the session intact -- the other
                button is the one that ends it.

                A real link, so it opens in a new tab like anything else
                that goes somewhere. It called location.assign() before:
                the same destination, with none of that on offer. */}
            <Button variant="secondary" size="sm" href={PORTAL}>
              Main page
            </Button>
            <Button variant="secondary" size="sm" onClick={handleSignOut}>
              Sign out
            </Button>
            <button
              hidden={items.length === 0}
              className="rounded-lg p-2 text-ink-2 hover:bg-hover lg:hidden"
              onClick={() => setMenuOpen((open) => !open)}
              aria-label="Toggle navigation"
              aria-expanded={menuOpen}
            >
              <span className="block h-0.5 w-5 bg-current" />
              <span className="mt-1 block h-0.5 w-5 bg-current" />
              <span className="mt-1 block h-0.5 w-5 bg-current" />
            </button>
          </div>
        </div>

        {menuOpen && (
          <nav className="grid gap-1 border-t border-line px-4 py-3 lg:hidden">
            {items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) =>
                  cx(
                    'rounded-lg px-3 py-2 text-sm font-medium',
                    isActive ? 'bg-brand-50 text-brand-700' : 'text-ink-2 hover:bg-hover',
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        )}
      </header>

      <main className="print-full w-full min-w-0 flex-1 px-3 py-6 sm:px-5">
        <UpdateBanner />
        <Outlet />
      </main>

      <footer className="no-print border-t border-line px-4 py-4 text-center text-xs text-ink-4">
        IEnergy Attendance Tracker
      </footer>
    </div>
  )
}
