// Was pinned to "@supabase/supabase-js@2" -- a range, so the CDN could
// have shipped a different minor version here than every other page
// was using. Now the same one file as the rest of the site.
import { createClient } from "../vendor/supabase-js-2.45.4.js";
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
