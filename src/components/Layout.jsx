import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { Badge, Button, cx } from './ui'

const NAV = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/attendance', label: 'Attendance', adminOnly: true },
  { to: '/employee-report', label: 'Employee report' },
  { to: '/monthly-report', label: 'Monthly report' },
  { to: '/adjustments', label: 'Adjustments', adminOnly: true },
  { to: '/employees', label: 'Employees', adminOnly: true },
  { to: '/settings', label: 'Settings', adminOnly: true },
]

export default function Layout() {
  const { profile, isAdmin, signOut } = useAuth()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)

  const items = NAV.filter((item) => !item.adminOnly || isAdmin)

  async function handleSignOut() {
    await signOut()
    navigate('/login', { replace: true })
  }

  return (
    <div className="flex min-h-full flex-col">
      <header className="no-print sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] items-center gap-4 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
              iE
            </div>
            <span className="text-sm font-semibold text-slate-900">Attendance Tracker</span>
          </div>

          <nav className="hidden flex-1 items-center gap-1 lg:flex">
            {items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cx(
                    'rounded-lg px-3 py-1.5 text-sm font-medium transition',
                    isActive
                      ? 'bg-brand-50 text-brand-700'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium text-slate-900">{profile?.name}</p>
              <p className="text-xs text-slate-500">
                #{profile?.code} · {profile?.departments?.name ?? '—'}
              </p>
            </div>
            <Badge tone={isAdmin ? 'blue' : 'slate'}>{isAdmin ? 'Admin' : 'User'}</Badge>
            <Button variant="secondary" size="sm" onClick={handleSignOut}>
              Sign out
            </Button>
            <button
              className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
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
          <nav className="grid gap-1 border-t border-slate-200 px-4 py-3 lg:hidden">
            {items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) =>
                  cx(
                    'rounded-lg px-3 py-2 text-sm font-medium',
                    isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100',
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        )}
      </header>

      <main className="print-full mx-auto w-full max-w-[1600px] flex-1 px-4 py-6">
        <Outlet />
      </main>

      <footer className="no-print border-t border-slate-200 px-4 py-4 text-center text-xs text-slate-400">
        IEnergy Attendance Tracker
      </footer>
    </div>
  )
}
