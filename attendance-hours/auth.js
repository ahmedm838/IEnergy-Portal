import { supabase, initError } from "./supabaseClient.js";
import { CONFIG } from "./config.js";

function requireSupabase(){
  if (initError || !supabase) {
    throw new Error(initError || "Supabase is not initialized.");
  }
  return supabase;
}

export function normalizeCode(code){
  return String(code||"").trim();
}

export function codeToEmail(code){
  const c = normalizeCode(code);
  if(c.includes("@")) return c;
  return `${c}@${CONFIG.AUTH_EMAIL_DOMAIN}`;
}

// Some older Leave Manager deployments used different synthetic email domains.
// To maximize compatibility (and avoid storing extra repo secrets), we allow a
// small ordered list of candidate domains.
export function codeToEmails(code){
  const c = normalizeCode(code);
  if (!c) return [];
  if (c.includes("@")) return [c];

  const domains = Array.isArray(CONFIG.AUTH_EMAIL_DOMAINS) && CONFIG.AUTH_EMAIL_DOMAINS.length
    ? CONFIG.AUTH_EMAIL_DOMAINS
    : [CONFIG.AUTH_EMAIL_DOMAIN].filter(Boolean);

  const uniq = [];
  for (const d of domains) {
    const dom = String(d || "").trim();
    if (!dom) continue;
    const email = `${c}@${dom}`;
    if (!uniq.includes(email)) uniq.push(email);
  }
  return uniq;
}


export async function getSession(){
  const sb = requireSupabase();
  const { data, error } = await sb.auth.getSession();
  if(error) throw error;
  return data.session;
}

export async function signOut(){
  const sb = requireSupabase();
  await sb.auth.signOut();
  window.location.href = "./login.html";
}

export async function getCurrentEmployeeProfile(){
  const sb = requireSupabase();
  const { data: { user }, error: uerr } = await sb.auth.getUser();
  if(uerr) throw uerr;
  if(!user) return null;

  const uid = user.id;
  const email = String(user.email || "");
  const codeFromEmail = email.includes("@") ? email.split("@")[0] : "";

  // DBs may use either:
  // - employees.auth_user_id (recommended)
  // - employees.user_id (legacy)
  // As a final fallback, match by employees.code derived from the auth email.
  const SELECT_V2 = "id, code, name, auth_user_id, role_id, roles(name)";
  const SELECT_V1 = "id, code, name, user_id, role_id, roles(name)";

  let data = null;

  // (1) Preferred: employees.auth_user_id == auth.users.id
  try {
    const res = await sb
      .from("employees")
      .select(SELECT_V2)
      .eq("auth_user_id", uid)
      .maybeSingle();

    if (res.error) throw res.error;
    data = res.data || null;
  } catch (e) {
    // If the column doesn't exist, continue to legacy lookup.
    const msg = String(e?.message || "").toLowerCase();
    if (!msg.includes("auth_user_id")) throw e;
  }

  // (2) Legacy: employees.user_id == auth.users.id
  if (!data) {
    try {
      const res = await sb
        .from("employees")
        .select(SELECT_V1)
        .eq("user_id", uid)
        .maybeSingle();

      if (res.error) throw res.error;
      data = res.data || null;
    } catch (e) {
      const msg = String(e?.message || "").toLowerCase();
      if (!msg.includes("user_id")) throw e;
    }
  }

  // (3) Fallback: employees.code == <email local-part>
  if (!data && codeFromEmail) {
    const res = await sb
      .from("employees")
      .select(SELECT_V2)
      .eq("code", codeFromEmail)
      .maybeSingle();

    if (res.error) throw res.error;
    data = res.data || null;

    // Best-effort self-heal: attach this auth user to the employee row.
    // This will only succeed if RLS allows the current user to update their row.
    if (data && (data.auth_user_id === null || data.auth_user_id === undefined)) {
      try {
        await sb.from("employees").update({ auth_user_id: uid }).eq("id", data.id);
      } catch (_) {
        // ignore
      }
    }
  }

  if(!data) return null;

  const roleName = data.roles?.name || data.roles?.[0]?.name || null;
  return { ...data, role_name: roleName };
}

export function isAdmin(profile){
  const r = String(profile?.role_name || "").toLowerCase();
  return r === "admin";
}
