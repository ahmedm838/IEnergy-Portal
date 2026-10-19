import { supabase } from './supabase'
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
