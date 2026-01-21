# Leave Manager (GitHub Pages + Supabase)

This repository contains:

- **Frontend**: React (Vite) single-page app, designed to deploy to **GitHub Pages**.
- **Backend**: Supabase (Postgres + Auth) schema, RLS policies, and **Edge Functions** for admin user management.

It implements the requirements from the attached specification:
- Two roles (**Admin**, **User**) and a login page with light/dark theme.
- Dashboard shows: code, name, hiring date, beginning balances (Planned/Un-Planned), utilized, remaining, plus totals for other leave types.
- Leave records section for the logged-in user.
- Admin can: add employee, add multiple leaves (bulk), edit leaves, view employee status/history, and reset passwords.

---

## 1) Supabase setup

1. Create a new Supabase project.
2. In **SQL Editor**, run scripts in this order:

- `supabase/sql/01_schema.sql`
- `supabase/sql/02_policies.sql`
- `supabase/sql/03_seed.sql`
- `supabase/sql/04_bootstrap_admin.sql` (one-time, to create the *first* Admin row)

3. Deploy Edge Functions:

- `admin-invite` (create employee + auth user)
- `admin-reset-password` (reset an auth user's password)

You can deploy from the Supabase dashboard (Functions) by pasting the code, or using the CLI.

### Required Function Secrets (Project Settings → Functions → Secrets)

- `SUPABASE_URL` = your project URL
- `SUPABASE_SERVICE_ROLE_KEY` = service role key (keep secret)

(Edge Functions use the service role key to validate the caller and manage users.)

---

## 2) Frontend setup (local)

```bash
cd frontend
npm install
cp .env.example .env
# edit .env to set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev
```

---

## 3) Deploy to GitHub Pages

This repo includes a GitHub Actions workflow that builds and deploys `frontend/dist` to Pages.

Steps:
1. Push this repo to GitHub.
2. In GitHub: **Settings → Pages**
   - Source: **GitHub Actions**
3. Add repo secrets:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`

The workflow injects them at build time.

---

## 4) Login convention (User ID)

The specification asks for a **User ID** that contains **only letters/numbers and dots**.
Supabase Auth requires an email format, so this app uses the convention:

- If a user logs in with `john.smith`, it is treated as `john.smith@ienergy.local`
- If they type an email already, it is used as-is.

Admins create users using the **Admin → Employees → Add Employee** screen.

---

## Notes / constraints

- Leave days are computed as **inclusive**: `end_date - start_date + 1`
- For annual renewal logic, balances are calculated **per calendar year**.
- To keep year logic correct, leave records are restricted to a **single calendar year** (cross-year leaves must be split).

