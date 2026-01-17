// ====== iEnergy Attendance Tracker - configuration ======
//
// This module is intended to run on GitHub Pages (static hosting).
// It should point to the SAME Supabase backend used by your Leave Manager
// so that Auth (credentials) and the shared tables are the same.
//
// GitHub Pages note:
// The anon key will be present in the deployed JS (normal). Security must be enforced by RLS.
//
// Placeholders below are replaced by GitHub Actions (see README.md).
export const CONFIG = {
  SUPABASE_URL: "__SUPABASE_URL__",
  SUPABASE_ANON_KEY: "__SUPABASE_ANON_KEY__",

  // Login mapping (employeeCode -> email). MUST match Leave Manager.
  // Leave Manager typically creates auth users using a synthetic email like: <EMP_CODE>@ie.local
  // IMPORTANT:
  // - If Leave Manager users were created as <EMP_CODE>@<domain>, set the same domain here.
  // - If you are unsure, keep the primary domain and add fallbacks; the login will try them in order.
  // This is hardcoded to avoid extra repo secrets.
  AUTH_EMAIL_DOMAIN: "ie.local",
  AUTH_EMAIL_DOMAINS: ["ie.local"],

  DEFAULT_SIGN_IN: "08:00",
  DEFAULT_SIGN_OUT: "16:00",
  STANDARD_HOURS_PER_DAY: 8,
  WEEKEND_DAYS_JS: [5, 6], // Fri + Sat
  BASE_PATH: "./"
};
