// =====================================================================
// set-employee-password
//
// Lets an administrator give an employee a temporary password, so a new
// hire can be onboarded without any email being sent. The employee is
// forced to choose their own password on first sign-in.
//
// Setting someone else's password is impersonation if it is not fenced,
// so the rules are enforced here rather than in the browser:
//
//   * the caller must be an active admin or super admin
//   * only a super admin may set the password of another admin or of a
//     super admin -- otherwise any admin could take over the account that
//     controls Settings, and the role separation would be decorative
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

const ADMIN_LEVEL = ['admin', 'super_admin']

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'Not signed in.' }, 401)

    const caller = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })

    const { data: userData, error: userError } = await caller.auth.getUser()
    if (userError || !userData?.user) {
      return json({ error: 'Your session has expired. Sign in again.' }, 401)
    }

    // my_role() resolves through the database and already returns
    // 'no_access' for an inactive employee.
    const { data: callerRole, error: roleError } = await caller.rpc('my_role')
    if (roleError) return json({ error: roleError.message }, 400)
    if (!ADMIN_LEVEL.includes(callerRole)) {
      return json({ error: 'Only an active administrator can set a password.' }, 403)
    }

    const { employee_id, password } = await req.json().catch(() => ({}))
    if (!employee_id) return json({ error: 'No employee specified.' }, 400)
    if (typeof password !== 'string' || password.length < 8) {
      return json({ error: 'The temporary password must be at least 8 characters.' }, 400)
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data: employee, error: employeeError } = await admin
      .from('employees')
      .select('id, name, code, email, role, is_active, auth_user_id')
      .eq('id', employee_id)
      .maybeSingle()

    if (employeeError) return json({ error: employeeError.message }, 400)
    if (!employee) return json({ error: 'Employee not found.' }, 404)
    if (!employee.email) {
      return json({ error: `${employee.name} has no email address, which is their username.` }, 400)
    }

    if (ADMIN_LEVEL.includes(employee.role) && callerRole !== 'super_admin') {
      return json(
        { error: `Only a super admin can set the password of another administrator.` },
        403,
      )
    }

    // must_set_password survives until they choose their own, so a
    // temporary password cannot quietly become a permanent one.
    if (employee.auth_user_id) {
      const { data: existing } = await admin.auth.admin.getUserById(employee.auth_user_id)
      const metadata = { ...(existing?.user?.user_metadata ?? {}), must_set_password: true }

      const { error } = await admin.auth.admin.updateUserById(employee.auth_user_id, {
        password,
        user_metadata: metadata,
      })
      if (error) return json({ error: error.message }, 400)

      return json({
        ok: true,
        created: false,
        message: `Temporary password set for ${employee.name}. They must choose their own on first sign-in.`,
      })
    }

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: employee.email,
      password,
      email_confirm: true, // no confirmation mail, which is the point
      user_metadata: {
        employee_code: employee.code,
        full_name: employee.name,
        must_set_password: true,
      },
    })
    if (createError) return json({ error: createError.message }, 400)

    // The database trigger links by email, but set it explicitly so the
    // caller never sees a half-created account if that ever changes.
    await admin
      .from('employees')
      .update({ auth_user_id: created.user.id })
      .eq('id', employee.id)

    return json({
      ok: true,
      created: true,
      message: `Login created for ${employee.name} with a temporary password. They must choose their own on first sign-in.`,
    })
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unexpected error' }, 500)
  }
})
