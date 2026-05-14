---
title: Rotate the master encryption key
category: runbook
created: 2026-05-14
updated: 2026-05-14
related: [[integration-config]]
---

How to rotate `BOOKING_ENCRYPTION_KEY` — the master key that encrypts every secret in the `integration_secrets` row. Use this runbook on a planned cadence (annual hygiene) or immediately if you suspect the key has leaked.

## When to rotate

- **Suspected leak**: laptop loss, accidental commit, Render dashboard breach. Rotate immediately.
- **Hygiene**: annually. Industry-standard practice for keys with no telemetry on their use.
- **Staff change**: if a contractor with prod access leaves, rotate.

## What rotation does NOT do

Rotating the master key does not decompromise:

- **DB backups encrypted with the old key.** They remain decryptable if the leaked key is also leaked. After a real compromise, rotate the master key AND rotate every underlying secret at its source (Resend dashboard, OpenRouter dashboard, change admin password) because those secrets were also exposed.
- **Anyone who copied a secret while the old key was active.** Same recovery — rotate the underlying secret.

Rotation is a containment action, not a cleanup. It stops further reads from the old key onward.

## Two ways to rotate

| Path | When |
|---|---|
| **UI** (`/admin/integrations` → "Rotate master key…") | Default. You're signed in to admin, no incident pressure. |
| **CLI** (`pnpm rotate-master-key`) | Recovery. Admin UI inaccessible (forgot password, page broken). You have shell access to a machine with `DATABASE_URL` set. |

Both do the same DB transaction; the UI just generates a key for you.

## UI path (recommended)

1. Sign in to `/admin/login`.
2. Open `/admin/integrations`.
3. Scroll to **Authentication** → **Master encryption key** → click **Rotate master key…**
4. Read the warning, then click **Rotate now**.
5. A new key appears. **DO NOT CLOSE THE MODAL YET.**
6. Click **Copy to clipboard**.
7. Open Render dashboard → service → Environment.
8. Update `BOOKING_ENCRYPTION_KEY` to the new key. Save.
9. Render auto-restarts the service.
10. Wait 2–4 min for the redeploy to finish.
11. Hard-refresh `/admin/integrations`.
12. If the page loads with secrets displayed (redacted), rotation is verified.

If step 11 fails (config-unreadable error): you have ~30 seconds to either:
- Revert the Render env var back to the OLD key (rollback)
- Or paste the new key back into the UI's recovery flow (not yet implemented — use CLI path)

## CLI path

Use when the UI is unreachable or you're rotating from a shell after an incident.

```powershell
# 1. Generate a new 32-byte key. Save it somewhere safe immediately.
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# 2. Run the rotation. --old defaults to the BOOKING_ENCRYPTION_KEY env var
#    (which the script reads via --env-file=.env.local). Pass --new explicitly.
pnpm rotate-master-key --new "<paste-new-key-here>"

# Or pass both explicitly:
pnpm rotate-master-key --old "<current-key>" --new "<new-key>"
```

Output on success:

```
✓ Rotated 3 encrypted field(s).

NEXT STEPS — do these in order:
  1. Update Render dashboard BOOKING_ENCRYPTION_KEY env var:
     <new key here>
  2. Trigger a manual restart on Render (or wait for env-change auto-redeploy).
  3. Sign in to /admin/integrations and verify all values render.
  4. If anything is broken, revert the env var to the old key and re-run
     this script with --old/--new swapped.
```

## Recovery if rotation half-fails

The DB rotation transaction is atomic — it either commits all 3 encrypted fields with the new key, or rolls back. So the DB is never in a mixed-key state.

The risk window is between:
- (a) The DB commits the new ciphertext
- (b) The Render env var still has the old key

During this window:
- The running process has the OLD key cached at module level
- Every call to `getIntegrationConfig()` decrypts the NEW ciphertext with the OLD key → `IntegrationConfigDecryptError`
- The app starts failing on any code path that touches integration config (admin login, contact form, lead notification, OpenRouter calls)

**Recovery options:**

1. **Update the env var and restart**. The process picks up the new key, decrypts successfully. ~3 min recovery.

2. **Roll back the rotation**: run `pnpm rotate-master-key --old <new-key> --new <old-key>` from a shell. Swaps the keys back. Then the running process can decrypt with the old key again. ~30 sec recovery.

3. **Worst case — master key permanently lost**: there's no way to decrypt the DB row. Restore from a backup taken before the rotation, OR run `pnpm reset-admin-password` + re-enter every secret via the admin UI after generating a fresh master key. See `wiki/runbooks/reset-admin-password.md`.

## After a real compromise — rotation alone is not enough

If you're rotating because the old key actually leaked, every secret encrypted with that key must be assumed compromised. Do the rotation AND:

1. **Resend**: log in to Resend dashboard → API Keys → revoke the old key → create a new one → update via `/admin/integrations` → click "Test Resend".
2. **OpenRouter**: same procedure at openrouter.ai/keys.
3. **Admin password**: change it via `/admin/integrations`. The old password may have been seen by whoever has the old key + a backup.
4. **Database**: if the laptop with `DATABASE_URL` is the leak source, rotate the DB password too (Render dashboard → Postgres service → Connection → Rotate password).

The master key rotation is a "stop the bleeding" action; the underlying credentials need their own rotations because they were exposed.

## Verification checklist (post-rotation)

- [ ] `/admin/integrations` loads without an error banner
- [ ] Each secret shows a new redacted display (`••••••••` + last 4 chars of plaintext)
- [ ] **Test Resend** button → ✓
- [ ] **Test OpenRouter** button → ✓
- [ ] Sign out and sign back in to `/admin/login` with the admin password (proves admin password decrypts correctly)
- [ ] Submit a contact form from `/contact` and confirm email arrives at the configured recipient (proves the whole pipeline still works)

If any of these fail: see "Recovery if rotation half-fails" above.
