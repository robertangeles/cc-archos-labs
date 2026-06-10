---
title: GBrain security hardening — debug endpoints, PII, and schema validation
category: lessons-learned
created: 2026-06-10
updated: 2026-06-10
related: [[2026-06-10-gbrain-multi-user-integration]]
---

Security hardening of the GBrain integration. Seven fixes, three lessons.

## Problem 1: Debug endpoint shipped to production

A `/api/brain/debug` route exposed the GBrain infrastructure URL, user OAuth client IDs, and hardcoded PII ("Rob Angeles from Bundoora VIC") to any authenticated user. It was created during implementation for pipeline tracing and never removed.

### Fix
Deleted the endpoint entirely. No frontend or backend code referenced it.

### Rule
Never ship debug endpoints to production. If you need one during implementation, gate it behind `NODE_ENV === "development"` from the start, or delete it before the PR.

## Problem 2: Zod schema validation can crash the config loader

Adding `.refine()` to enforce HTTPS on `gbrainUrl` in `IntegrationConfigSchema` (the runtime read schema) would crash the entire config loader if any existing DB row or env var contained `http://`. This would break all features, not just brain.

### Fix
Moved HTTPS enforcement to `getGBrainUrl()` in `lib/brain/client.ts` — the point of use. Returns `null` for `http://` URLs (graceful degradation). Config schemas remain permissive on read; validation happens at the point where credentials would be transmitted.

### Rule
Never add restrictive validation to a read-path schema that existing data must pass through. Validate at the write path (admin settings PATCH) or at the point of use (the function that sends credentials). A schema refine that rejects existing data is a production outage disguised as a security fix.

## Problem 3: Conversations stored verbatim in external service

`extractMemories()` sent full `userMessage` and `assistantResponse` to GBrain without any filtering. If a user shared a credit card number, API key, TFN, or email in chat, it was stored as plaintext in an external Supabase instance.

### Fix
Created `lib/brain/sanitize.ts` with regex-based PII detection (credit cards with Luhn validation, emails, AU phone/TFN/Medicare/passport, API keys). Called before every `put_page` in `extract.ts`. Redacts and continues — doesn't block extraction.

### Rule
Any data pipeline to an external service must sanitize PII before transmission. "We trust the external service" is not a security posture — it's a liability. Redact at the boundary, not at the destination.
