# iEnergy Portal — Attendance Tracker (GitHub Pages)

This is a **static (no-build)** Attendance Tracker module designed to be placed inside your **iEnergy Portal** repository and served via GitHub Pages.

## Backend / Supabase model

To keep **the same login credentials as Leave Manager**, this module must point to the **same Supabase project** used by Leave Manager (same Auth + same DB).

## 1) Copy into your portal repo

Copy the folder:

```
attendance-tracker/
```

Then link your portal button to:

- `attendance-tracker/login.html`

## 2) Create the new table (run SQL in Leave Manager project)

Open Supabase (Leave Manager project) → SQL Editor → run:

- `attendance-tracker/sql/supabase_schema.sql`

This script:
- Creates `public.attendance_records`
- Adds trigger logic for leave rows (forces 08:00–16:00 and 8 hours)
- Enables RLS so:
  - Admin can manage all records
  - User can view only their own records

## 3) GitHub Pages secrets (only URL + anon key)

Add these GitHub repo secrets:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

Then in your GitHub Actions deploy workflow, add a step **before** the deploy step:

```yaml
- name: Inject Supabase config (Attendance Tracker)
  shell: bash
  run: |
    sed -i "s|__SUPABASE_URL__|${SUPABASE_URL}|g" attendance-tracker/config.js
    sed -i "s|__SUPABASE_ANON_KEY__|${SUPABASE_ANON_KEY}|g" attendance-tracker/config.js
  env:
    SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
    SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}
```

## 4) Email mapping must match Leave Manager

Attendance Tracker uses the same approach as Leave Manager:

- Users sign in with **Employee Code + Password**
- The code is mapped to an email as: `<CODE>@<DOMAIN>`

The domain is configured in:

- `attendance-tracker/config.js` → `AUTH_EMAIL_DOMAIN`

Set it to the exact domain used in Leave Manager when you created users (for example: `ie.local`).
