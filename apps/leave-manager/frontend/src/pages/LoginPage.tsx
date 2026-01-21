
import { useState } from "react";
import { supabase } from "../lib/supabase";
import { normalizeLogin } from "../lib/auth";

export default function LoginPage() {
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const email = normalizeLogin(userId);
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-md mx-auto">
      <div className="card p-6">
        <h1 className="text-xl font-bold">Log in</h1>
        <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">
          Use your User ID (dots allowed) or your email.
        </p>

        <form className="mt-6 space-y-4" onSubmit={onSubmit}>
          <div>
            <div className="label mb-1">User ID</div>
            <input className="input" value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="e.g. ahmed.moustafa" />
          </div>
          <div>
            <div className="label mb-1">Password</div>
            <input className="input" value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="••••••" />
          </div>

          {err && (
            <div className="rounded-xl border border-red-300/60 bg-red-50 dark:bg-red-950/40 dark:border-red-800/60 p-3 text-sm">
              {err}
            </div>
          )}

          <button disabled={busy} className="btn w-full">
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
