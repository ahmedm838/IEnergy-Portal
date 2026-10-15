import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react'
import { supabase, isConfigured } from './supabase'

const AuthContext = createContext(null)

/**
 * Usernames are the part of an email before the "@", so someone can sign in
 * as either "ahmed.moustafa" or "ahmed.moustafa@ienergyegypt.com".
 *
 * The domain is read from the database through a function the anon role may
 * call, because this has to work before anyone is authenticated. It is
 * cached for the page's lifetime and falls back to passing the input
 * through untouched, so a misconfigured domain degrades to email-only
 * sign-in rather than locking everyone out.
 */
let domainPromise = null

function defaultEmailDomain() {
  if (!domainPromise) {
    domainPromise = supabase
      .rpc('default_email_domain')
      .then(({ data, error }) => (error ? '' : (data ?? '')))
      .catch(() => '')
  }
  return domainPromise
}

export async function resolveEmail(identifier) {
  const input = (identifier ?? '').trim()
  if (!input || input.includes('@')) return input
  const domain = await defaultEmailDomain()
  return domain ? `${input}@${domain}` : input
}

/**
 * Holds the Supabase session plus the matching `employees` row, which is
 * where role, department and the Y/N payroll switches live.
 *
 * The profile is advisory: it drives what the UI offers. Authorisation is
 * enforced by RLS in Postgres, so a user who tampers with client state
 * still cannot read or write anything their policies forbid.
 */
export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [profileError, setProfileError] = useState(null)

  const loadProfile = useCallback(async (activeSession) => {
    if (!activeSession?.user) {
      setProfile(null)
      return
    }
    try {
      const { data, error } = await supabase
      .from('employees')
      .select(
        `id, code, name, title, email, username, role, is_active,
         site_id, department_id,
         has_meal, has_allowance, has_overtime, has_incentive, has_deductions,
         annual_leave_balance, unplanned_leave_balance,
         sites ( id, name ),
         departments ( id, name, sectors ( id, name ) )`,
      )
      .eq('auth_user_id', activeSession.user.id)
      .maybeSingle()

      if (error) {
        setProfileError(error.message)
        setProfile(null)
        return
      }
      setProfileError(null)
      setProfile(data)
    } catch (err) {
      // A rejected fetch (offline, DNS, blocked request) would otherwise
      // propagate and skip the code that clears the loading flag.
      setProfileError(err?.message ?? 'Could not load your profile.')
      setProfile(null)
    }
  }, [])

  useEffect(() => {
    if (!isConfigured) {
      setLoading(false)
      return
    }

    let cancelled = false

    const finish = () => {
      if (!cancelled) setLoading(false)
    }

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (cancelled) return undefined
        setSession(data.session)
        return loadProfile(data.session)
      })
      .catch((err) => {
        if (!cancelled) setProfileError(err?.message ?? 'Could not read your session.')
      })
      .finally(finish)

    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (cancelled) return
      setSession(nextSession)

      // Deliberately not awaited. supabase-js holds an internal auth lock for
      // the duration of this callback, and any Supabase query made inside it
      // waits on that same lock -- a deadlock that leaves the app stuck on
      // "Checking your session…" forever on any visit that already has a
      // stored session. Deferring to a macrotask runs the fetch after the
      // lock is released.
      setTimeout(() => {
        if (cancelled) return
        loadProfile(nextSession).finally(finish)
      }, 0)
    })

    // Last resort: never strand someone on a spinner. If auth has not settled
    // by now, render the UI and let the normal error paths explain themselves.
    const watchdog = setTimeout(finish, 8000)

    return () => {
      cancelled = true
      clearTimeout(watchdog)
      sub.subscription.unsubscribe()
    }
  }, [loadProfile])

  const value = useMemo(() => {
    const role = profile?.role ?? (session ? 'no_access' : null)
    return {
      session,
      user: session?.user ?? null,
      profile,
      profileError,
      loading,
      role,
      isAdmin: role === 'admin',
      canRead: role === 'admin' || role === 'user',
      refreshProfile: () => loadProfile(session),
      signIn: async (identifier, password) =>
        supabase.auth.signInWithPassword({
          email: await resolveEmail(identifier),
          password,
        }),
      signOut: () => supabase.auth.signOut(),
      resetPassword: async (identifier) =>
        supabase.auth.resetPasswordForEmail(await resolveEmail(identifier), {
          redirectTo: `${window.location.origin}${window.location.pathname}?mode=set-password`,
        }),
    }
  }, [session, profile, profileError, loading, loadProfile])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
