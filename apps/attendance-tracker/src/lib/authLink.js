/**
 * Captures the credentials an email link carries, before anything else can
 * destroy them.
 *
 * Supabase returns recovery and invite tokens in the URL fragment. This app
 * uses HashRouter, which also owns the fragment and rewrites it on mount —
 * so the tokens were being wiped before supabase-js could read them. The
 * link then did nothing, the app loaded with whatever session the browser
 * already held, and the reset screen offered to change THAT account's
 * password. An admin opening a colleague's reset link would have changed
 * their own password while believing they were setting someone else's.
 *
 * This module must be imported first, ahead of the router and the Supabase
 * client, so it reads the URL while it is still intact.
 */

function collect(source, keys) {
  const found = {}
  for (const key of keys) {
    const value = source.get(key)
    if (value) found[key] = value
  }
  return found
}

function capture() {
  const search = new URLSearchParams(window.location.search)

  // The fragment is only auth data when it is not a route. HashRouter paths
  // start with "/", Supabase parameters never do.
  const rawHash = window.location.hash.replace(/^#/, '')
  const fragment =
    rawHash && !rawHash.startsWith('/') ? new URLSearchParams(rawHash) : new URLSearchParams()

  return {
    // Implicit flow: tokens arrive in the fragment.
    ...collect(fragment, ['access_token', 'refresh_token', 'type', 'error', 'error_code', 'error_description']),
    // PKCE flow: a single-use code in the query.
    // Token-hash flow: used when the link is opened in a different browser
    // from the one that requested it, which is the norm for admin-sent links.
    ...collect(search, ['code', 'token_hash', 'type', 'error', 'error_code', 'error_description']),
  }
}

const captured = capture()

export const authLink = {
  accessToken: captured.access_token ?? null,
  refreshToken: captured.refresh_token ?? null,
  code: captured.code ?? null,
  tokenHash: captured.token_hash ?? null,
  type: captured.type ?? null,
  error: captured.error_description ?? captured.error ?? null,
}

/** True when this page load came from an email link of any shape. */
export const hasAuthLink = Boolean(
  authLink.accessToken || authLink.code || authLink.tokenHash || authLink.error,
)

/** Recovery and invite links must land on the password screen. */
export const wantsPasswordScreen =
  hasAuthLink && (authLink.type === 'recovery' || authLink.type === 'invite' || !authLink.type)

if (hasAuthLink) {
  // Strip the credentials from the address bar: it keeps them out of the
  // browser history, stops a refresh replaying a token that is already
  // spent, and leaves HashRouter a clean URL to start from.
  window.history.replaceState({}, '', window.location.pathname)
}
