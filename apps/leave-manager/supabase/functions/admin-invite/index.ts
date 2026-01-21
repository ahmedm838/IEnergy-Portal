
// supabase/functions/admin-invite/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

// Inline CORS (Option A) to avoid bundling issues with ../_shared/cors.ts
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Payload = {
  code: string;
  name: string;
  user_id: string; // dots allowed
  hiring_date: string; // YYYY-MM-DD
  role: "Admin" | "User";
  password: string;
  planned_annual_balance?: number;
  unplanned_annual_balance?: number;
};

function toEmail(user_id: string) {
  return user_id.includes("@") ? user_id : `${user_id}@ienergy.local`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    // Validate caller JWT and ensure they are an Admin in employees table
    const jwt = authHeader.replace("Bearer ", "");
    const { data: userData, error: userErr } = await adminClient.auth.getUser(jwt);
    if (userErr || !userData?.user?.id) {
      return new Response(JSON.stringify({ error: "Invalid JWT" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const callerUid = userData.user.id;

    const { data: callerEmp, error: callerErr } = await adminClient
      .from("employees")
      .select("id, roles(name)")
      .eq("auth_user_id", callerUid)
      .maybeSingle();

    if (callerErr || !callerEmp || callerEmp.roles?.name !== "Admin") {
      return new Response(JSON.stringify({ error: "Not authorized" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json()) as Payload;

    if (!/^[2][0-9]{5}$/.test(body.code)) {
      return new Response(JSON.stringify({ error: "Code must be 6 digits and start with 2" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!/^[A-Za-z0-9]+(\.[A-Za-z0-9]+)*$/.test(body.user_id)) {
      return new Response(JSON.stringify({ error: "User ID allows letters/numbers and dots only" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!body.password || body.password.length < 6) {
      return new Response(JSON.stringify({ error: "Password must be at least 6 characters" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const email = toEmail(body.user_id);

    // Get role_id
    const { data: roleRow, error: roleErr } = await adminClient
      .from("roles")
      .select("id")
      .eq("name", body.role)
      .single();
    if (roleErr) throw roleErr;

    // Create auth user (or keep existing)
    const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
      email,
      password: body.password,
      email_confirm: true,
    });

    if (createErr && !String(createErr.message || "").includes("already registered")) {
      throw createErr;
    }

    // If already exists, fetch by email
    let authUserId = created?.user?.id;
    if (!authUserId) {
      const { data: users, error: listErr } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 2000 });
      if (listErr) throw listErr;
      const found = users.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
      authUserId = found?.id;
    }
    if (!authUserId) {
      return new Response(JSON.stringify({ error: "Could not resolve auth user" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Insert / upsert employee row (password is stored securely in Supabase Auth)
    const { error: upsertErr } = await adminClient.from("employees").upsert({
      auth_user_id: authUserId,
      code: body.code,
      name: body.name,
      user_id: body.user_id,
      hiring_date: body.hiring_date,
      role_id: roleRow.id,
      planned_annual_balance: body.planned_annual_balance ?? 14,
      unplanned_annual_balance: body.unplanned_annual_balance ?? 7,
      password_hash: null,
    }, { onConflict: "code" });
    if (upsertErr) throw upsertErr;

    return new Response(JSON.stringify({ ok: true, auth_user_id: authUserId, email }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
