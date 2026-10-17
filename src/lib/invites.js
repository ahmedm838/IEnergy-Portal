import { supabase } from './supabase'

/**
 * Where an invite or reset link should land the user.
 *
 * Supabase returns its tokens in the URL fragment, and the app uses
 * HashRouter, which also owns the fragment. Pointing redirectTo at
 * "#/reset-password" produces two fragments in one URL and the token is
 * lost. So the marker goes in the QUERY string: Supabase appends its
 * fragment after it, supabase-js consumes the fragment to build the
 * session, and ?mode=set-password survives for the router to act on.
 *
 * This origin must be listed under Authentication -> URL Configuration
 * in Supabase, or the link bounces to the site root with no token.
 */
export function authRedirectUrl() {
  return `${window.location.origin}${window.location.pathname}?mode=set-password`
}

/**
 * Ask the server to invite an employee.
 *
 * Inviting needs the service_role key, so it happens in the
 * invite-employee Edge Function, which re-checks that the caller is an
 * active admin before using it. The browser only ever holds the anon key.
 */
export async function inviteEmployee(employeeId) {
  const { data, error } = await supabase.functions.invoke('invite-employee', {
    body: { employee_id: employeeId, redirect_to: authRedirectUrl() },
  })

  // A non-2xx reply carries the reason in the body, not in error.message,
  // so surface that rather than a bare "Edge Function returned a non-2xx".
  if (error) {
    let detail = ''
    try {
      detail = (await error.context?.json())?.error ?? ''
    } catch {
      detail = ''
    }
    throw new Error(detail || error.message)
  }
  if (data?.error) throw new Error(data.error)
  return data
}

/** Send a password-reset link to an employee who already has a login. */
export async function sendPasswordReset(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: authRedirectUrl(),
  })
  if (error) throw new Error(error.message)
  return { ok: true, message: `Reset link sent to ${email}.` }
}

/**
 * Give an employee a temporary password, creating their login if needed.
 *
 * No email is involved: the administrator reads the password out and hands
 * it over. The account is flagged must_set_password, so the temporary one
 * stops working as soon as the employee chooses their own.
 */
export async function setTemporaryPassword(employeeId, password) {
  const { data, error } = await supabase.functions.invoke('set-employee-password', {
    body: { employee_id: employeeId, password },
  })

  if (error) {
    let detail = ''
    try {
      detail = (await error.context?.json())?.error ?? ''
    } catch {
      detail = ''
    }
    throw new Error(detail || error.message)
  }
  if (data?.error) throw new Error(data.error)
  return data
}

/**
 * A readable temporary password: no look-alike characters, and chosen with
 * crypto rather than Math.random, since this briefly protects a real account.
 */
export function generateTemporaryPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  const bytes = new Uint32Array(14)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (n) => alphabet[n % alphabet.length]).join('')
}
