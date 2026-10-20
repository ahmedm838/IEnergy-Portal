import { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { supabase, isConfigured } from './supabase'
import { clearLookupsCache } from './useLookups'

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
/**
 * Remove any stored Supabase session.
 *
 * signOut() alone is not enough: it does its own work through the stored
 * session, so when that session is stale or malformed it can fail and leave
 * the entry behind. Deleting the key directly is unconditional, and the
 * whole point here is that the previous user's session must not survive
 * into someone else's password link.
 */
function purgeStoredSession() {
  try {
    const keys = []
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i)
      if (key && /^sb-.*-auth-token$/.test(key)) keys.push(key)
    }
    keys.forEach((key) => localStorage.removeItem(key))
  } catch {
    // Storage can be unavailable in private mode; signOut below still runs.
  }
}

/* There is no link to redeem any more.

   Recovery and invite links are gone: a password is set by a super
   admin in Settings, handed over in person, and the account is flagged
   to make the person choose their own on first sign-in. Nothing arrives
   by email, so nothing needs catching out of the URL.

   What that removes is a standing risk. A recovery link is a password
   reset for whoever holds it, it travels by email, and it works in any
   browser -- which is why the code that read one had to be so careful
   about reading it before the router could destroy it. None of that
   has to be got right if the links do not exist. */

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
  // Distinguishes "the profile has not arrived yet" from "this account has
  // no employee record". Without it the gap between setting the session and
  // the deferred fetch returning renders the not-linked warning for a frame.
  const [profileLoading, setProfileLoading] = useState(false)
  // Which user the loaded profile belongs to, so a token refresh for the
  // same person does not re-query and churn the context for no reason.
  const loadedForUser = useRef(null)
  // Starts true when this load came from a recovery or invite link, and is
  // cleared once the password is set. A module constant cannot be used
  // directly: it would still be true after saving and bounce the user
  // straight back to the password screen.

  const loadProfile = useCallback(async (activeSession) => {
    if (!activeSession?.user) {
      setProfile(null)
      setProfileLoading(false)
      loadedForUser.current = null
      return
    }
    setProfileLoading(true)
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
      loadedForUser.current = activeSession.user.id
    } catch (err) {
      // A rejected fetch (offline, DNS, blocked request) would otherwise
      // propagate and skip the code that clears the loading flag.
      setProfileError(err?.message ?? 'Could not load your profile.')
      setProfile(null)
    } finally {
      setProfileLoading(false)
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

      // A token refresh for the same signed-in user needs no new profile.
      // Chrome fires one every time the tab regains focus, and refetching
      // churns the context on each one for no gain.
      if (nextSession?.user && nextSession.user.id === loadedForUser.current) {
        return
      }

      // Set before deferring, not inside the timeout: otherwise there is
      // still a frame with a session and no profile, which is the whole bug.
      if (nextSession?.user) setProfileLoading(true)

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
      profileLoading,
      isSuperAdmin: role === 'super_admin',
      isAdmin: role === 'admin' || role === 'super_admin',
      canRead: role === 'admin' || role === 'super_admin' || role === 'user',
      refreshProfile: () => loadProfile(session),
      signIn: async (identifier, password) =>
        supabase.auth.signInWithPassword({
          email: await resolveEmail(identifier),
          password,
        }),
      /**
       * Sign out, and mean it.
       *
       * The old version returned supabase.auth.signOut() and trusted it.
       * That call revokes the session on the server, and when the server
       * refuses -- an expired or already-rotated refresh token answers
       * 403 session_not_found, which is exactly the state someone is in
       * after sitting idle -- it reports the error and leaves the stored
       * token where it is. No SIGNED_OUT event follows, so the context
       * keeps its session and the next page load restores it from
       * storage. The button appeared to do nothing.
       *
       * So: ask the server to revoke, but never depend on the answer.
       * What actually keeps someone signed in is the entry in
       * localStorage, and that is removed either way.
       */
      signOut: async () => {
        // Reference data is cached at module scope for the session. Two
        // people signing in from the same browser must not inherit each
        // other's, even though RLS would have filtered it the same way.
        clearLookupsCache()

        try {
          const { error } = await supabase.auth.signOut()
          if (error) throw error
        } catch {
          // Server unreachable, or it does not recognise the session any
          // more. Either way this browser is done with it.
          await supabase.auth.signOut({ scope: 'local' }).catch(() => {})
        }
        purgeStoredSession()

        // onAuthStateChange is what normally clears these, and it does not
        // fire when the call above failed. Clearing them here means the UI
        // leaves immediately instead of waiting for an event that may
        // never come.
        loadedForUser.current = null
        setSession(null)
        setProfile(null)
        setProfileError(null)
        setProfileLoading(false)
      },
    }
  }, [session, profile, profileError, profileLoading, loading, loadProfile])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
