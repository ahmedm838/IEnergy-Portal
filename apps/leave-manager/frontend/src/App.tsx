
import { useEffect, useRef, useState } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { supabase } from "./lib/supabase";
import { initTheme, toggleTheme } from "./lib/theme";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";

// Max session duration: 15 minutes from the moment the user signs in.
// User can also end the session earlier via Logout.
const MAX_SESSION_MS = 15 * 60 * 1000;
const SESSION_STARTED_AT_KEY = "lm_session_started_at";

export default function App() {
  const [sessionChecked, setSessionChecked] = useState(false);
  const [session, setSession] = useState<any>(null);
  const nav = useNavigate();

  const expireTimeoutRef = useRef<number | null>(null);
  const expireIntervalRef = useRef<number | null>(null);
  // Keep session start time stable even if Supabase refreshes tokens (which updates the session object)
  // or if localStorage is blocked.
  const startedAtRef = useRef<number | null>(null);

  function clearExpiryTimers() {
    if (expireTimeoutRef.current !== null) {
      window.clearTimeout(expireTimeoutRef.current);
      expireTimeoutRef.current = null;
    }
    if (expireIntervalRef.current !== null) {
      window.clearInterval(expireIntervalRef.current);
      expireIntervalRef.current = null;
    }
  }

  function getStartedAt(): number {
    // Prefer the in-memory ref (stable within the tab)
    if (startedAtRef.current !== null) return startedAtRef.current;

    // Fall back to persisted storage (survives reload)
    try {
      const stored = Number(localStorage.getItem(SESSION_STARTED_AT_KEY) ?? "");
      if (stored && !Number.isNaN(stored)) {
        startedAtRef.current = stored;
        return stored;
      }
    } catch {
      // ignore storage failures
    }

    // Last resort: start now (best effort)
    const now = Date.now();
    startedAtRef.current = now;
    try {
      localStorage.setItem(SESSION_STARTED_AT_KEY, String(now));
    } catch {
      // ignore storage failures
    }
    return now;
  }

  // "Effective" session is a local concept: once MAX_SESSION_MS elapses, we treat the user as logged out
  // regardless of Supabase token refresh behavior or signOut reliability.
  const sessionExpired = session ? Date.now() - getStartedAt() >= MAX_SESSION_MS : false;
  const effectiveSession = session && !sessionExpired ? session : null;

  function isExpired(): boolean {
    if (!session) return false;
    return Date.now() - getStartedAt() >= MAX_SESSION_MS;
  }

  function hardClearSupabaseAuthStorage() {
    // Supabase JS stores auth session in localStorage (key typically like: sb-<project>-auth-token).
    // If signOut fails (offline / blocked), this ensures the app cannot silently re-hydrate the session.
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (!k) continue;
        if (/^sb-.*-auth-token$/.test(k)) localStorage.removeItem(k);
      }
    } catch {
      // ignore
    }
  }

  async function forceLogout() {
    clearExpiryTimers();
    startedAtRef.current = null;
    try {
      localStorage.removeItem(SESSION_STARTED_AT_KEY);
    } catch {
      // ignore storage failures
    }
    // Immediately drop local session to prevent route loops (login -> dashboard).
    setSession(null);
    setSessionChecked(true);
    try {
      // Local scope is sufficient for this app and avoids relying on network.
      // If unavailable in the current client version, the catch below handles it.
      // @ts-ignore
      await supabase.auth.signOut({ scope: "local" });
    } catch {
      try {
        await supabase.auth.signOut();
      } catch {
        // ignore
      }
    }
    hardClearSupabaseAuthStorage();
    nav("/login", { replace: true });
  }

  useEffect(() => {
    initTheme();
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionChecked(true);

      // If there is an existing session (e.g., page refresh) and we don't have a
      // session start time, record it now.
      if (data.session) {
        // Prefer persisted value; otherwise set now.
        void getStartedAt();
      }
    });
    const { data: sub } = supabase.auth.onAuthStateChange((evt, s) => {
      setSession(s);
      setSessionChecked(true);

      // Only set session start time on explicit sign-in.
      if (evt === "SIGNED_IN") {
        const now = Date.now();
        startedAtRef.current = now;
        try {
          localStorage.setItem(SESSION_STARTED_AT_KEY, String(now));
        } catch {
          // ignore storage failures
        }
      }
      if (evt === "SIGNED_OUT") {
        clearExpiryTimers();
        startedAtRef.current = null;
        try {
          localStorage.removeItem(SESSION_STARTED_AT_KEY);
        } catch {
          // ignore storage failures
        }
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Enforce max session time = 15 minutes from session start.
  useEffect(() => {
    clearExpiryTimers();

    if (!effectiveSession) return;

    // Immediate check (covers returning to a sleeping laptop/tab)
    if (sessionExpired || isExpired()) {
      void forceLogout();
      return;
    }

    const startedAt = getStartedAt();
    const remaining = startedAt + MAX_SESSION_MS - Date.now();

    expireTimeoutRef.current = window.setTimeout(() => {
      void forceLogout();
    }, Math.max(0, remaining));

    // Backup checks: run more frequently and also on focus/visibility changes.
    const check = () => {
      if (sessionExpired || isExpired()) void forceLogout();
    };

    expireIntervalRef.current = window.setInterval(check, 10_000);
    window.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);

    return () => {
      clearExpiryTimers();
      window.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
    };
    // IMPORTANT: depend on user id, not the full session object (token refreshes would otherwise reset timers).
  }, [effectiveSession?.user?.id, sessionExpired]);

  async function logout() {
    clearExpiryTimers();
    startedAtRef.current = null;
    try {
      localStorage.removeItem(SESSION_STARTED_AT_KEY);
    } catch {
      // ignore
    }
    setSession(null);
    setSessionChecked(true);
    try {
      // @ts-ignore
      await supabase.auth.signOut({ scope: "local" });
    } catch {
      try {
        await supabase.auth.signOut();
      } catch {
        // ignore
      }
    }
    hardClearSupabaseAuthStorage();
    nav("/login");
  }

  if (!sessionChecked) {
    return (
      <div className="min-h-screen grid place-items-center">
        <div className="card p-6">Loading…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200/60 dark:border-slate-800/60">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="font-bold text-lg">Leave Manager</div>
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={toggleTheme}>Theme</button>
            {effectiveSession && <button className="btn" onClick={logout}>Logout</button>}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">
        <Routes>
          <Route path="/login" element={effectiveSession ? <Navigate to="/" /> : <LoginPage />} />
          <Route path="/" element={effectiveSession ? <DashboardPage /> : <Navigate to="/login" />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </div>
  );
}
