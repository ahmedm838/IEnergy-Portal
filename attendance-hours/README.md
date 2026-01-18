# iEnergy Attendance Tracker (GitHub Pages)

## Login must match Leave Manager
This Attendance Tracker uses **Supabase Auth** (email+password) and is intended to use the **same Supabase project as Leave Manager** so the same users/passwords work.

### Employee Code / Email
Users can enter either:
- **Full email** (if they normally login with email), or
- **Employee Code** (e.g., `1001`) which the app converts to an email like: `1001@<domain>`.

The `<domain>` **must match** how users were created in Leave Manager.

## Configure the email domain
Edit `attendance-hours/config.js`:

```js
AUTH_EMAIL_DOMAIN: "ie.local",
AUTH_EMAIL_DOMAINS: ["ie.local"],
```

Set it to the domain you see in **Supabase Dashboard → Authentication → Users** (for Leave Manager).
Example: if your users are `1001@ienergy-portal.com`, then set:

```js
AUTH_EMAIL_DOMAIN: "ienergy-portal.com",
AUTH_EMAIL_DOMAINS: ["ienergy-portal.com"],
```

## GitHub Secrets (required)
Add repo secrets:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

Deploy via GitHub Actions (Pages). The workflow injects these values into `attendance-hours/config.js`.
