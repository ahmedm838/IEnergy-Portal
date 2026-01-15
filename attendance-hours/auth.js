import { supabase } from "./supabaseClient.js";
import { CONFIG } from "./config.js";

export function normalizeCode(code){
  return String(code||"").trim();
}

export function codeToEmail(code){
  const c = normalizeCode(code);
  if(c.includes("@")) return c;
  return `${c}@${CONFIG.AUTH_EMAIL_DOMAIN}`;
}


export async function getSession(){
  const { data, error } = await supabase.auth.getSession();
  if(error) throw error;
  return data.session;
}

export async function signOut(){
  await supabase.auth.signOut();
  window.location.href = "./login.html";
}

export async function getCurrentEmployeeProfile(){
  const { data: { user }, error: uerr } = await supabase.auth.getUser();
  if(uerr) throw uerr;
  if(!user) return null;

  // Expect employees.user_id == auth.users.id
  const { data, error } = await supabase
    .from("employees")
    .select("id, code, name, user_id, role_id, roles(name)")
    .eq("user_id", user.id)
    .maybeSingle();

  if(error) throw error;
  if(!data) return null;

  const roleName = data.roles?.name || data.roles?.[0]?.name || null;
  return { ...data, role_name: roleName };
}

export function isAdmin(profile){
  const r = String(profile?.role_name || "").toLowerCase();
  return r === "admin";
}
