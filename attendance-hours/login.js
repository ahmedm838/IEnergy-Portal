import { supabase, initError } from "./supabaseClient.js";
import { codeToEmails, normalizeCode } from "./auth.js";
import { qs, showToast, isNonEmptyString } from "./utils.js";

const codeEl = qs("#code");
const passEl = qs("#password");
const btn = qs("#btnLogin");
const hint = qs("#loginHint");

// IMPORTANT:
// We intentionally do NOT auto-redirect if a session exists.
// The portal button must always show the login page first.

async function tryLogin(email, password){
  return supabase.auth.signInWithPassword({ email, password });
}

// If Supabase failed to initialize (most commonly: config placeholders not injected),
// show a clear message and disable login.
if (initError) {
  showToast(initError, "danger");
  hint.textContent = initError;
  btn.disabled = true;
}

btn.addEventListener("click", async () => {
  if (initError || !supabase) {
    showToast(initError || "Supabase is not initialized.", "danger");
    return;
  }
  const code = normalizeCode(codeEl.value);
  const password = String(passEl.value || "");

  if (!isNonEmptyString(code) || !isNonEmptyString(password)) {
    showToast("Please enter Employee Code and Password.", "warn");
    return;
  }

  btn.disabled = true;
  hint.textContent = "Signing in...";

  try {
    const candidates = codeToEmails(code);
    if (!candidates.length) {
      showToast("Please enter Employee Code or Email.", "warn");
      return;
    }

    let lastErr = null;
    let success = null;

    for (const email of candidates) {
      const res = await tryLogin(email, password);
      if (!res?.error) { success = res; break; }
      lastErr = res.error;
    }

    if (!success) throw lastErr;

    showToast("Login successful.", "good");
    window.location.href = "./index.html";
  } catch (e) {
    console.error(e);
    // Provide a clearer hint to align with Leave Manager credential expectations.
    const msg = String(e?.message || "Login failed.");
    if (msg.toLowerCase().includes("invalid login credentials")) {
      showToast("Invalid login credentials. Use the same Employee Code and Password used in Leave Manager. If your Leave Manager username is a full email, enter the full email here.", "danger");
    } else {
      showToast(msg, "danger");
    }
  } finally {
    btn.disabled = false;
    hint.textContent = "";
  }
});

[codeEl, passEl].forEach((el) => el.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") btn.click();
}));