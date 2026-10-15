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
  }, [])

  useEffect(() => {
    if (!isConfigured) {
      setLoading(false)
      return
    }

    let cancelled = false

    supabase.auth.getSession().then(async ({ data }) => {
      if (cancelled) return
      setSession(data.session)
      await loadProfile(data.session)
      if (!cancelled) setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, nextSession) => {
      if (cancelled) return
      setSession(nextSession)
      await loadProfile(nextSession)
      setLoading(false)
    })

    return () => {
      cancelled = true
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
          redirectTo: `${window.location.origin}${window.location.pathname}#/reset-password`,
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
