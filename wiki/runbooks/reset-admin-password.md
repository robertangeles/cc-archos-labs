---
title: Reset the admin password
category: runbook
created: 2026-05-14
updated: 2026-05-14
related: [[integration-config]]
---

How to recover `ADMIN_PASSWORD` when you're locked out of `/admin/login`. Two paths depending on what you have access to.

## When to use this runbook

- Forgot the admin password and can't sign in to `/admin/integrations` to change it.
- Suspect the password was leaked and need to rotate it from a shell, not from a UI session that may itself be compromised.
- Master-key rotation went sideways and the admin password field can't be decrypted (you'd reset to a known value here, then re-encrypt with the new master key via the same script).

## Path A — Local laptop with `.env.local` set (fastest)

Your `.env.local` already has `DATABASE_URL` (pointing at prod DB) and `BOOKING_ENCRYPTION_KEY`. The CLI script encrypts the new password with the master key and writes it to the `integration_secrets` row.

```powershell
# Replace with your new password. Use quotes if it has spaces.
pnpm reset-admin-password "your-new-strong-password-here"
```

Output on success:

```
✓ Admin password updated.

You can now sign in to /admin/login with the new password.
```

Constraints enforced by the script:
- New password must be **at least 8 characters** (matches the IntegrationConfigSchema floor).
- Leading/trailing spaces are stripped.

The CLI writes an audit log row with `operation='updated', actor='cli'`. You'll see it next time you load `/admin/integrations`.

## Path B — No local checkout, only DB access

If you don't have the project checked out locally (e.g., recovering from a different laptop), you can do the same operation in two steps:

```powershell
# 1. Generate the encrypted password locally with a one-liner. Needs the
#    same BOOKING_ENCRYPTION_KEY value that's set on Render.
$env:BOOKING_ENCRYPTION_KEY = "<paste-current-master-key>"
node -e @'
const { createCipheriv, randomBytes } = require('crypto');
const password = process.argv[1];
const key = Buffer.from(process.env.BOOKING_ENCRYPTION_KEY, 'base64');
const iv = randomBytes(12);
const cipher = createCipheriv('aes-256-gcm', key, iv);
const ciphertext = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]);
const tag = cipher.getAuthTag();
console.log(Buffer.concat([iv, tag, ciphertext]).toString('base64'));
'@ "your-new-strong-password-here"
```

Save the printed base64 string.

```powershell
# 2. Connect to prod Postgres (Render dashboard → Postgres service → Connect)
#    and run the UPDATE manually. Replace ENCRYPTED_VALUE with the string
#    from step 1. The jsonb_set ensures we only touch the adminPassword
#    field; other secrets stay untouched.
psql "<DATABASE_URL>" -c "UPDATE site_setting SET value = jsonb_set(value, '{adminPassword}', to_jsonb('ENCRYPTED_VALUE'::text)), updated_at = now() WHERE key = 'integration_secrets';"

# 3. Write the audit row.
psql "<DATABASE_URL>" -c "INSERT INTO integration_secret_audit (key_name, operation, actor) VALUES ('admin_password', 'updated', 'cli');"
```

## Path C — Master key is also lost

If the master key is gone too, encrypted secrets are unrecoverable. You need to:

1. Generate a fresh master key: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
2. Update `BOOKING_ENCRYPTION_KEY` in Render dashboard to the new key.
3. Connect to prod DB and DROP the `integration_secrets` row:
   ```sql
   DELETE FROM site_setting WHERE key = 'integration_secrets';
   ```
4. Restart the service.
5. With `INTEGRATION_FALLBACK_ENABLED=true` (still in env), the app falls back to whatever env vars are present. The Render env vars probably still have the old admin password — if so, sign in with that. If not, re-add `ADMIN_PASSWORD` to Render env temporarily.
6. Sign in to `/admin/integrations`, set each secret to its current value (Resend dashboard, OpenRouter dashboard, etc.).
7. After everything is re-set via the UI, remove the env-var copies from Render dashboard.

This is the worst-case recovery. Avoid by:
- Keeping a copy of `BOOKING_ENCRYPTION_KEY` in a password manager (1Password, Bitwarden, etc.) separate from the laptop.
- Documenting where the master key lives in `~/.gstack/` or a private notes app.

## Verification

After any of A/B/C:

- [ ] Sign out (clear the admin cookie if you're still in).
- [ ] Sign in to `/admin/login` with the new password.
- [ ] Verify it lands on `/admin/site` or `/admin/diagnostic` (whichever is the post-login default).
- [ ] Open `/admin/integrations` → confirm the recent-changes audit log shows the password update.

## Why is this not a "Forgot password? Email me a reset link" flow?

There's only one admin. The whole point of the password is that compromising it gives full control of every integration. A self-service email reset would mean compromising the recipient email (`CONTACT_RECIPIENT_EMAIL`) is equivalent to compromising the admin password — that's a worse trust model than "the admin has shell access and a master key."

If we ever add a second admin, this runbook gets revisited.
