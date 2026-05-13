---
title: Integration config — DB-backed secrets with env-rooted master key
category: concept
created: 2026-05-13
updated: 2026-05-13
related: [[transactional-email-rendering]], [[lead-session-and-owner-only-reports]]
---

How Resend, OpenRouter, the admin password, and the contact/from email addresses are stored encrypted in the database and edited from `/admin/integrations`, while a few env-rooted secrets (`DATABASE_URL`, `BOOKING_ENCRYPTION_KEY`, `AUTH_SECRET`) stay outside the DB by design.

## Why this exists

Two motivations:

1. **Operational**: rotating an API key today requires a Render dashboard trip + service redeploy. `/admin/integrations` lets the admin rotate from the same surface where they read reports, without leaving the app or waiting on a deploy.
2. **Hygiene**: shrinks `.env.local` on the laptop from 7 prod secrets to 3 (`DATABASE_URL`, `BOOKING_ENCRYPTION_KEY`, `AUTH_SECRET`). Not a complete fix for laptop-loss (those 3 + a copy of the prod DB still unlock everything), but a meaningful reduction.

The full design rationale, including the rejected alternatives, lives in the CEO plan + eng review at `~/.gstack/projects/robertangeles-cc-archos-labs/ceo-plans/2026-05-13-integrations-settings.md`.

## Boundary between env and DB

| Value | Storage | Why |
|---|---|---|
| `DATABASE_URL` | env | Chicken-and-egg — you can't read the URL from the DB it points at. |
| `BOOKING_ENCRYPTION_KEY` (master) | env | Trust chain root. If it lived in the DB, the DB would be self-decrypting and encryption-at-rest would be meaningless. |
| `AUTH_SECRET` | env | `proxy.ts` runs in the Edge runtime and verifies the admin session JWT on every `/admin/**` request. Edge can't connect to Postgres or use `node:crypto`, so the secret has to be readable from env synchronously. |
| `ADMIN_PASSWORD` | DB (encrypted) | Verification happens in the Node-runtime login route only. Lives in `lib/admin-password.ts` (split from `lib/auth.ts` for exactly this reason). |
| `RESEND_API_KEY` | DB (encrypted) | Node-only consumers in `lib/resend.ts`. |
| `OPENROUTER_API_KEY` | DB (encrypted, stored as `llmApiKey`) | Node-only consumers in `lib/claude.ts`. Stored under a provider-agnostic name so future provider swaps don't require a schema change. |
| `CONTACT_RECIPIENT_EMAIL` | DB (plaintext) | Config, not secret. Admin may want to swap recipients without redeploying. |
| `RESEND_FROM_EMAIL` | DB (plaintext) | Config. |
| `CLAUDE_MODEL_ID` | DB (plaintext, nullable, stored as `llmModelId`) | Config. `null` falls back to `DEFAULT_MODEL_ID` in `lib/claude.ts`. Provider-agnostic field name. |

## Storage shape

One row in `site_setting` with `key = 'integration_secrets'`. The `value` JSONB blob holds every field — encrypted ciphertext (base64 from `lib/booking-crypto.ts` `encrypt()`) for the secret fields, plaintext for the config fields.

```json
{
  "adminPassword": "aGVsbG8gd29ybGQ=…",    // AES-256-GCM ciphertext, base64
  "resendApiKey": "GZpbGwgaW4uLi4=…",
  "llmApiKey": "c2tfb3JfYWJjMTIz…",
  "contactRecipientEmail": "rob@archoslabs.xyz",
  "resendFromEmail": "Archos Labs <hello@archoslabs.xyz>",
  "llmModelId": null
}
```

Per-field encryption (not row-level) so the audit log can record "you rotated `resendApiKey`" rather than "you rotated the whole row." `ENCRYPTED_FIELDS` in `lib/integration-config-shared.ts` is the authoritative list.

## Loader contract

Server-side callers consume `getIntegrationConfig()` from `lib/integration-config.ts`. The function:

1. Checks `BOOKING_ENCRYPTION_KEY` is set; throws `MasterKeyMissingError` if not.
2. Reads the `integration_secrets` row from `site_setting`.
3. If missing AND `INTEGRATION_FALLBACK_ENABLED=true` → falls back to env vars (the 7-day grace window).
4. If missing AND fallback disabled → throws `IntegrationConfigNotFoundError`.
5. Validates the JSONB shape against `StoredIntegrationConfigSchema` (Zod).
6. Decrypts every `ENCRYPTED_FIELDS` entry with the master key.
7. Validates the decrypted result against `IntegrationConfigSchema` (Zod, with min-length / email-format / etc. rules).
8. Caches the result module-level. Subsequent calls return the cached value.

**Fail-closed rule**: a decrypt failure NEVER silently substitutes a default or falls back to env. It throws `IntegrationConfigDecryptError`, which the caller (typically a route handler entry point) logs and re-raises. The app should exit if this happens during boot — the alternative is silently degraded auth, which is worse.

## Cache semantics

```typescript
let cachedConfigPromise: Promise<IntegrationConfig> | null = null;
```

Promise-based so concurrent first-call requests share one DB query (no thundering herd). Writers (`updateIntegrationSecret`, `rotateMasterKey`, `migrateEnvToDB`) call `clearIntegrationConfigCache()` to invalidate; the next read re-fetches.

**Single-instance assumption**: Render web service runs one container, so in-process invalidation is sufficient. If we ever scale to multiple instances, this becomes incoherent — two instances would have diverging cached values until each restarts. Future fix: version column on `site_setting` + cheap version-check on every read.

## Audit log

Every mutation writes one row to `integration_secret_audit`:

| Column | Notes |
|---|---|
| `key_name` (snake_case) | The integration-config field that was mutated, or `_master_key` for whole-row rotation. |
| `operation` | `created` (first write), `updated` (admin edit), `revealed` (plaintext shown to admin), `rotated_master_key`. |
| `actor` | `admin` (UI), `migration` (CLI seeding), `cli` (recovery scripts). |
| `created_at` | Append-only — no `updated_at` because rows are immutable. |

The value itself is **never** stored. If you need to know what the value was, you've already lost — the audit log answers "who/what/when," not "what was the old value."

## Master-key rotation

`scripts/rotate-master-key.mjs` is the operational primitive. Reads the current row, decrypts every field with `--old`, re-encrypts with `--new`, writes back inside a single transaction. After it succeeds:

1. Copy the new key into Render dashboard `BOOKING_ENCRYPTION_KEY`.
2. Restart the service.
3. Verify `/admin/integrations` loads.

Doing the env update before the script means the running process can't decrypt the current row — recovery is "revert env, re-run script."

**A leaked master key is a full compromise of every encrypted secret.** Rotation alone does NOT decompromise:
- Old DB backups encrypted with the old key. They remain decryptable.
- Anyone who copied a secret value while the old key was active.

After a master-key leak: rotate the master key AND rotate every underlying secret at its source (Resend dashboard, OpenRouter dashboard, change admin password via the UI).

## Where to look

- `lib/integration-config-shared.ts` — Zod schema, encrypted-field list, defaults. Client-safe.
- `lib/integration-config.ts` — server-side loader, writer, rotation, migration. `server-only`.
- `lib/admin-password.ts` — Node-only admin password verification. Reads from `getIntegrationConfig()`.
- `lib/auth.ts` — Edge-safe JWT helpers. **Must not** import anything that pulls in `node:crypto` or the DB.
- `lib/errors/integration-config.ts` — named error classes.
- `lib/booking-crypto.ts` — AES-GCM helpers reused for at-rest encryption.
- `scripts/migrate-integration-secrets.mjs` — one-off migration from env to encrypted DB.
- `scripts/rotate-master-key.mjs` — master-key rotation.
- `scripts/reset-admin-password.mjs` — emergency admin-password recovery.
- `drizzle/0005_aspiring_squadron_supreme.sql` — DDL for `integration_secret_audit`.

## What this does NOT solve

- **Laptop loss against a sophisticated attacker**: `.env.local` still has `DATABASE_URL` (pointing at prod) + `BOOKING_ENCRYPTION_KEY`. Together those unlock everything in the new DB row. The dev/prod DB split (deferred per CEO plan D2) is the fix for this.
- **Defense against a compromised admin session**: if an attacker steals the admin cookie, they can read/edit every secret via the UI. Same surface as a Render-dashboard takeover today. Mitigated by the password-re-confirm modal on reveal (cherry-pick D7 in the CEO plan).
- **Defense against backup theft + leaked master key**: encryption-at-rest is the line. Backup-only theft is mitigated; backup theft + key leak is full compromise.
