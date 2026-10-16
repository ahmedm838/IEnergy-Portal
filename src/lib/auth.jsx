import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react'
import { supabase, isConfigured } from './supabase'
import { authLink, hasAuthLink, wantsPasswordScreen } from './authLink'

const AuthContext = createContext(null)

/**
 * Turn the credentials from an email link into a session.
 *
 * Any session already in this browser is discarded first. An admin who
 * sends a colleague a reset link and then opens it is otherwise left
 * signed in as themselves, on a screen offering to change "their"
 * password -- which would change the admin's own. Starting from no
 * session means a link that fails to redeem lands on sign-in rather than
 * inside the wrong account.
 */
async function redeemAuthLink() {
  if (!hasAuthLink) return { redeemed: false, error: null }

  if (authLink.error) {
    await supabase.auth.signOut({ scope: 'local' }).catch(() => {})
    return { redeemed: false, error: authLink.error }
  }

  await supabase.auth.signOut({ scope: 'local' }).catch(() => {})

  try {
    if (authLink.accessToken && authLink.refreshToken) {
      const { error } = await supabase.auth.setSession({
        access_token: authLink.accessToken,
        refresh_token: authLink.refreshToken,
      })
      if (error) throw error
      return { redeemed: true, error: null }
    }

    if (authLink.tokenHash) {
      // Works in a browser that never requested the link, which is the
      // normal case for one an administrator sent.
      const { error } = await supabase.auth.verifyOtp({
        token_hash: authLink.tokenHash,
        type: authLink.type || 'recovery',
      })
      if (error) throw error
      return { redeemed: true, error: null }
    }

    if (authLink.code) {
      const { error } = await supabase.auth.exchangeCodeForSession(authLink.code)
      if (error) throw error
      return { redeemed: true, error: null }
    }
  } catch (err) {
    return { redeemed: false, error: err?.message ?? 'That link could not be used.' }
  }

  return { redeemed: false, error: null }
}

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
  const [linkError, setLinkError] = useState(null)

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

    redeemAuthLink()
      .then((result) => {
        if (cancelled) return undefined
        if (result.error) setLinkError(result.error)
        return supabase.auth.getSession()
      })
      .then((res) => {
        if (cancelled || !res) return undefined
        setSession(res.data.session)
        return loadProfile(res.data.session)
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
      // Super admins are admins with extra rights, so every existing
      // admin-gated screen keeps working for them unchanged.
      // Set when an account was invited and has not chosen a password yet.
      mustSetPassword: session?.user?.user_metadata?.must_set_password === true,
      // True for this page load only: the session came from an email link,
      // so the password screen should own the user until they finish.
      fromAuthLink: wantsPasswordScreen,
      linkError,
      isSuperAdmin: role === 'super_admin',
      isAdmin: role === 'admin' || role === 'super_admin',
      canRead: role === 'admin' || role === 'super_admin' || role === 'user',
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
  }, [session, profile, profileError, linkError, loading, loadProfile])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
