import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

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
        detectSessionInUrl: true,
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
