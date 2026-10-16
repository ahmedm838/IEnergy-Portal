import { createClient } from '@supabase/supabase-js'

/**
 * Strip a byte-order mark and surrounding whitespace.
 *
 * CI secrets are easy to set with an invisible BOM or trailing newline —
 * piping a value into `gh secret set` from Windows PowerShell does exactly
 * that. The build then succeeds and the app dies at runtime on
 * `new URL(...)`, which is a miserable thing to debug from a stack trace in
 * minified code. Normalising here costs nothing.
 */
const clean = (value) => (value ?? '').replace(/^﻿/, '').trim()

const url = clean(import.meta.env.VITE_SUPABASE_URL)
const anonKey = clean(import.meta.env.VITE_SUPABASE_ANON_KEY)

// Fail loudly at startup rather than with a confusing network error later.
export const isConfigured = Boolean(url && anonKey)

if (!isConfigured && import.meta.env.DEV) {
  console.error(
    'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copy .env.example to .env.local and fill them in.',
  )
}

export const supabase = isConfigured
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // Off deliberately. HashRouter rewrites the fragment on mount, so
        // leaving this on is a race the router usually wins, silently
        // discarding the token. src/lib/authLink.js captures the
        // credentials first and lib/auth.jsx redeems them explicitly.
        detectSessionInUrl: false,
      },
    })
  : null

/**
 * Supabase returns `{ data, error }` rather than throwing. Wrapping every
 * call in this keeps the pages free of repeated error plumbing and means a
 * failed RLS check surfaces as a real exception the UI can catch.
 */
export async function run(query) {
  const { data, error } = await query
  if (error) throw new Error(error.message ?? 'Request failed')
  return data
}
