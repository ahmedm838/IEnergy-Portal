// =====================================================================
// invite-employee
//
// Sends a set-your-own-password invitation to an employee.
//
// Inviting requires the service_role key, which bypasses every RLS
// policy and must never reach a browser. It lives here, server-side, and
// this function is the only thing that touches it. Every request is
// checked twice before it is used: the caller must present a valid JWT,
// and the employee row behind that JWT must carry role = 'admin'.
// =====================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader.startsWith('Bearer ')) {
      return json({ error: 'Not signed in.' }, 401)
    }

    // Identify the caller with their own token, under their own RLS.
    const caller = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })

    const { data: userData, error: userError } = await caller.auth.getUser()
    if (userError || !userData?.user) {
      return json({ error: 'Your session has expired. Sign in again.' }, 401)
    }

    const { data: me, error: meError } = await caller
      .from('employees')
      .select('id, role, is_active')
      .eq('auth_user_id', userData.user.id)
      .maybeSingle()

    if (meError) return json({ error: meError.message }, 400)
    if (!me || me.role !== 'admin' || !me.is_active) {
      return json({ error: 'Only an active administrator can send invitations.' }, 403)
    }

    const { employee_id, redirect_to } = await req.json().catch(() => ({}))
    if (!employee_id) return json({ error: 'No employee specified.' }, 400)

    // From here on, service_role — but only for the one employee named,
    // and only after the checks above.
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data: employee, error: employeeError } = await admin
      .from('employees')
      .select('id, name, code, email, auth_user_id')
      .eq('id', employee_id)
      .maybeSingle()

    if (employeeError) return json({ error: employeeError.message }, 400)
    if (!employee) return json({ error: 'Employee not found.' }, 404)
    if (!employee.email) {
      return json({ error: `${employee.name} has no email address yet.` }, 400)
    }
    if (employee.auth_user_id) {
      return json(
        { error: `${employee.name} already has a login. Use "Send reset" instead.` },
        409,
      )
    }

    const { data: invited, error: inviteError } =
      await admin.auth.admin.inviteUserByEmail(employee.email, {
        redirectTo: redirect_to || undefined,
        data: { employee_code: employee.code, full_name: employee.name },
      })

    if (inviteError) {
      // A mailbox that already exists in auth but was never linked is a
      // recoverable state, not a failure: adopt it instead.
      if (inviteError.status === 422) {
        const { data: list } = await admin.auth.admin.listUsers()
        const existing = list?.users?.find(
          (u) => (u.email ?? '').toLowerCase() === employee.email.toLowerCase(),
        )
        if (existing) {
          await admin
            .from('employees')
            .update({ auth_user_id: existing.id })
            .eq('id', employee.id)
          return json({
            ok: true,
            linked: true,
            message: `${employee.name} already had an account; it is now linked to their employee record.`,
          })
        }
      }
      return json({ error: inviteError.message }, 400)
    }

    return json({
      ok: true,
      message: `Invitation sent to ${employee.email}.`,
      user_id: invited?.user?.id ?? null,
    })
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unexpected error' }, 500)
  }
})
