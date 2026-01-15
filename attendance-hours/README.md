# iEnergy Portal — Attendance Tracker (GitHub Pages)

This is a **static (no-build)** Attendance Tracker module designed to be placed inside your **iEnergy Portal** repository and served via GitHub Pages.

## Backend / Supabase model

To keep **the same login credentials as Leave Manager**, this module must point to the **same Supabase project** used by Leave Manager (same Auth + same DB).

## 1) Copy into your portal repo

Copy the folder:

```
attendance-hours/
```

Then link your portal button to:

- `attendance-hours/login.html`

## 2) Create the new table (run SQL in Leave Manager project)

Open Supabase (Leave Manager project) → SQL Editor → run:

- `attendance-hours/sql/supabase_schema.sql`

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

This repo includes a ready workflow: `.github/workflows/deploy-gh-pages.yml`.

In GitHub repo settings, ensure **Pages → Build and deployment → Source = GitHub Actions**.

If you maintain your own workflow, add a step **before** the deploy step:

```yaml
- name: Inject Supabase config (Attendance Tracker)
  shell: bash
  run: |
    python - <<'PY'
    import os
    from pathlib import Path

    p = Path('attendance-hours/config.js')
    s = p.read_text(encoding='utf-8')
    s = s.replace('__SUPABASE_URL__', os.environ['SUPABASE_URL'].strip())
    s = s.replace('__SUPABASE_ANON_KEY__', os.environ['SUPABASE_ANON_KEY'].strip())
    p.write_text(s, encoding='utf-8')
    PY
  env:
    SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
    SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}
```

## 4) Email mapping must match Leave Manager

Attendance Tracker uses the same approach as Leave Manager:

- Users sign in with **Employee Code + Password**
- The code is mapped to an email as: `<CODE>@<DOMAIN>`

The domain is configured in:

- `attendance-hours/config.js` → `AUTH_EMAIL_DOMAIN`

Set it to the exact domain used in Leave Manager when you created users (for example: `ie.local`).
