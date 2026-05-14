---
title: Remove env vars from Render dashboard after migrating to DB
category: runbook
created: 2026-05-14
updated: 2026-05-14
related: [[integration-config]]
---

The post-deploy checklist for moving secrets from Render dashboard env vars into the encrypted DB row. Run this AFTER PR B deploys, the migration has run, and you've verified `/admin/integrations` shows the values correctly.

## Pre-flight (do once, before removing anything)

- [ ] `INTEGRATION_FALLBACK_ENABLED=true` is set on Render dashboard.
- [ ] PR A merged and the `integration_secret_audit` table exists.
- [ ] PR B merged and `/admin/integrations` is reachable.
- [ ] You ran `pnpm migrate-integration-secrets` (no `--dry-run`) and saw "X field(s) written" output.
- [ ] You signed in to `/admin/integrations` and every section shows real redacted values (`••••••••XXXX`), not empty/error states.
- [ ] You clicked **Test Resend** → ✓
- [ ] You clicked **Test OpenRouter** → ✓

If any of the above failed, **stop**. Do not start removing env vars. Investigate the failure first.

## Removal procedure — ONE env var at a time

The procedure for each env var is the same:

1. **Smoke-test the corresponding flow first** (table below).
2. **Remove the env var from Render dashboard** (Environment tab → click the trash icon → save).
3. **Wait for Render to restart the service** (~2-4 min).
4. **Re-run the smoke test** — this proves the DB-backed value is actually being read.
5. **If the smoke test fails**, re-add the env var to Render (paste from your password manager — you SHOULD have a copy). Service restarts again, recovery in ~3 min.

**Rule**: never remove two env vars in the same deploy. One at a time, with verification between each.

## Env-var-by-env-var checklist

### `RESEND_API_KEY`

- [ ] Click **Test Resend** in `/admin/integrations` → ✓ (proves DB-backed key works while env still set)
- [ ] Remove `RESEND_API_KEY` from Render dashboard
- [ ] Wait for redeploy
- [ ] Click **Test Resend** again → ✓
- [ ] Submit a contact form from `/contact` → email arrives in `CONTACT_RECIPIENT_EMAIL` inbox

### `RESEND_FROM_EMAIL`

- [ ] Open `/sign-in` → request a magic-link → email arrives → check the **From** address matches what's in `/admin/integrations`
- [ ] Remove `RESEND_FROM_EMAIL` from Render dashboard
- [ ] Wait for redeploy
- [ ] Request another magic-link → email arrives with the same **From** address

### `CONTACT_RECIPIENT_EMAIL`

- [ ] Submit a contact form from `/contact` → email arrives at the right address
- [ ] Remove `CONTACT_RECIPIENT_EMAIL` from Render dashboard
- [ ] Wait for redeploy
- [ ] Submit another contact form → email still arrives at the right address

### `OPENROUTER_API_KEY`

- [ ] Click **Test OpenRouter** in `/admin/integrations` → ✓
- [ ] Remove `OPENROUTER_API_KEY` from Render dashboard
- [ ] Wait for redeploy
- [ ] Click **Test OpenRouter** again → ✓
- [ ] Complete a real diagnostic at `/tools/ai-readiness` → report generates with Claude output

### `CLAUDE_MODEL_ID` (only if you had it set)

- [ ] In `/admin/integrations` → AI Model section → confirm Model ID field shows the value you'd configured (or `null` if unset)
- [ ] Remove `CLAUDE_MODEL_ID` from Render dashboard
- [ ] Wait for redeploy
- [ ] Generate a diagnostic → confirm the report uses the expected model (visible in `report_output.model_id` column in DB if you want to be sure)

### `ADMIN_PASSWORD`

- [ ] Sign out of `/admin`
- [ ] Sign back in with the current password → succeeds (proves DB-backed password works)
- [ ] Remove `ADMIN_PASSWORD` from Render dashboard
- [ ] Wait for redeploy
- [ ] Sign out and sign back in again → succeeds

**Special caution**: removing `ADMIN_PASSWORD` while signed out and the DB row hasn't migrated cleanly = lockout. Verify you can sign in BEFORE removing the env var.

## After all env vars are removed

- [ ] All 6 env vars (`RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `CONTACT_RECIPIENT_EMAIL`, `OPENROUTER_API_KEY`, `CLAUDE_MODEL_ID`, `ADMIN_PASSWORD`) are GONE from Render dashboard
- [ ] These three env vars REMAIN on Render dashboard (they must):
  - `DATABASE_URL`
  - `BOOKING_ENCRYPTION_KEY`
  - `AUTH_SECRET`
  - (also `NEXT_PUBLIC_SITE_URL`, `PORT`, etc. — anything that isn't an integration secret)
- [ ] `INTEGRATION_FALLBACK_ENABLED=true` can stay for 7 more days as a safety net, then flip to `false` or remove

## 7 days later — finalising the cutover

After a week of stable operation with everything DB-backed:

- [ ] Set `INTEGRATION_FALLBACK_ENABLED=false` on Render dashboard (or remove it entirely)
- [ ] Restart the service to clear any cached fallback behaviour
- [ ] Re-run **Test Resend** and **Test OpenRouter** to confirm nothing is silently relying on env-fallback
- [ ] PR C will remove the env-fallback code path from `lib/integration-config.ts`. Until that ships, the fallback is dormant but present.

## Rollback in case of catastrophic failure

If you've removed all env vars AND the DB row becomes corrupted/unreachable:

1. Generate a new `BOOKING_ENCRYPTION_KEY` if needed (the original is in env still).
2. Re-add each env var to Render dashboard with its known-good value (you SHOULD have these in a password manager — if not, rotate them at the source and use the new values).
3. Set `INTEGRATION_FALLBACK_ENABLED=true` so the loader falls back to env.
4. Restart service.
5. App is back online reading from env.
6. Investigate what corrupted the DB row separately.

The 7-day window is exactly this: a buffer where you can revert without re-rotating every underlying credential.

## Final hardening (PR C — much later)

When PR C ships:
- The env-fallback code path is removed entirely from `lib/integration-config.ts`.
- `INTEGRATION_FALLBACK_ENABLED` becomes a no-op.
- The 3 stays-in-env vars stay.

After PR C, the only way to recover from "DB row missing" is to restore from backup or run the migration script with env vars temporarily re-added. The 7-day grace window is the only chance to undo without that level of effort.
