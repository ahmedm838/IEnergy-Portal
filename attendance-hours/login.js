import { supabase } from "./supabaseClient.js";
import { codeToEmail, normalizeCode } from "./auth.js";
import { qs, showToast, isNonEmptyString } from "./utils.js";

const codeEl = qs("#code");
const passEl = qs("#password");
const btn = qs("#btnLogin");
const hint = qs("#loginHint");

async function redirectIfLoggedIn(){
  const { data } = await supabase.auth.getSession();
  if (data?.session) window.location.href = "./index.html";
}
redirectIfLoggedIn();

async function tryLogin(email, password){
  return supabase.auth.signInWithPassword({ email, password });
}

btn.addEventListener("click", async () => {
  const code = normalizeCode(codeEl.value);
  const password = String(passEl.value || "");

  if (!isNonEmptyString(code) || !isNonEmptyString(password)) {
    showToast("Please enter Employee Code and Password.", "warn");
    return;
  }

  btn.disabled = true;
  hint.textContent = "Signing in...";

  try {
    const email1 = codeToEmail(code);
    let res = await tryLogin(email1, password);

    // Fallback: alternate email domain (optional)
    if (res?.error && !code.includes("@")) {
      if (email2) res = await tryLogin(email2, password);
    }

    if (res?.error) throw res.error;

    showToast("Login successful.", "good");
    window.location.href = "./index.html";
  } catch (e) {
    console.error(e);
    showToast(e?.message || "Login failed.", "danger");
  } finally {
    btn.disabled = false;
    hint.textContent = "";
  }
});

[codeEl, passEl].forEach((el) => el.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") btn.click();
}));