
// supabase/functions/admin-reset-password/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

// Inline CORS (Option A) to avoid bundling issues with ../_shared/cors.ts
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Payload = {
  user_id: string;  // username (dots) OR email
  new_password: string;
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

    // Validate caller JWT and ensure they are Admin
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
      .select("roles(name)")
      .eq("auth_user_id", callerUid)
      .maybeSingle();

    if (callerErr || !callerEmp || callerEmp.roles?.name !== "Admin") {
      return new Response(JSON.stringify({ error: "Not authorized" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json()) as Payload;
    if (!body.new_password || body.new_password.length < 6) {
      return new Response(JSON.stringify({ error: "Password must be at least 6 characters" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const email = toEmail(body.user_id);

    const { data: users, error: listErr } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 2000 });
    if (listErr) throw listErr;

    const found = users.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (!found?.id) {
      return new Response(JSON.stringify({ error: "User not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: updErr } = await adminClient.auth.admin.updateUserById(found.id, {
      password: body.new_password,
    });
    if (updErr) throw updErr;

    return new Response(JSON.stringify({ ok: true }), {
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
