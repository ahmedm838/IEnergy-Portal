import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { CONFIG } from "./config.js";

function isValidHttpUrl(value){
  try {
    const u = new URL(String(value || ""));
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export const initError = (() => {
  // Common deployment mistake: placeholders not replaced by GitHub Actions.
  if (String(CONFIG.SUPABASE_URL || "").includes("__SUPABASE_URL__") || String(CONFIG.SUPABASE_ANON_KEY || "").includes("__SUPABASE_ANON_KEY__")) {
    return "Supabase config is not injected. Add GitHub secrets SUPABASE_URL and SUPABASE_ANON_KEY and redeploy.";
  }
  if (!isValidHttpUrl(CONFIG.SUPABASE_URL)) {
    return "Invalid Supabase URL. It must start with http:// or https://";
  }
  if (!CONFIG.SUPABASE_ANON_KEY || String(CONFIG.SUPABASE_ANON_KEY).length < 30) {
    return "Invalid Supabase anon key. Check GitHub secret SUPABASE_ANON_KEY.";
  }
  return null;
})();

export const supabase = initError ? null : createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
