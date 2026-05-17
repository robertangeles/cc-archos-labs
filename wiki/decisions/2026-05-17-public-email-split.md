---
title: consultant.public_email split from internal routing email
category: decision
created: 2026-05-17
updated: 2026-05-17
related: [[book-a-call-architecture]], [[integration-config]]
---

The `consultant` row carries two email fields. `consultant.email` is the internal routing address (OAuth identity, outgoing-mail From: header). `consultant.public_email` is the address surfaced publicly on the booking page's escape-hatch — branded, distinct from any forwarding alias the consultant uses to receive mail.

## Decision

Two columns on `consultant`:
- `email` (NOT NULL UNIQUE) — internal routing
- `public_email` (NULL allowed) — public display, falls back to `email` when null

The booking page renders `public_email ?? email`. The OAuth callback continues to use `email` as the consultant identity lookup key (via `integration_secrets.contactRecipientEmail`).

NOT: a single `email` column doing both jobs.

## Why

Rob's setup uses `trebor.selegna@outlook.com` as the internal routing inbox (`contactRecipientEmail` in `integration_secrets`) — where contact-form submissions land, where OAuth callbacks identify the consultant, where Resend's From: address sends from. But that's not what he wants prospects to see on the booking page; for public display he wants `rob.angeles@archoslabs.xyz` (his branded domain).

Conflating the two means changing the public email forces an OAuth re-grant (because email is the identity key) and breaks notification routing.

## Migration

`drizzle/0008_tearful_black_cat.sql` adds `public_email TEXT` and backfills:

```sql
ALTER TABLE "consultant" ADD COLUMN "public_email" text;

UPDATE "consultant"
SET "public_email" = 'rob.angeles@archoslabs.xyz'
WHERE "email" = 'trebor.selegna@outlook.com';
```

Future consultants default to NULL — the booking page falls back to `email` until the admin explicitly sets `public_email`.

## Code locations

- `lib/db/schema.ts` — `consultant.publicEmail` (nullable)
- `lib/booking.ts` — `getConsultantBySlug` selects both columns
- `app/book/[slug]/page.tsx` — `const publicEmail = consultant.publicEmail ?? consultant.email`
- `app/book/[slug]/booking-form.tsx` — escape-hatch line renders `publicEmail`
- `app/api/admin/google-oauth/cb/route.ts` — still keys consultant lookup on `email`, NOT `public_email`

## What's NOT here

No admin UI yet to edit `public_email`. Admin must update via psql / Drizzle Studio for now. A consultant-profile UI (alongside `/admin/integrations/google-calendar`) is the planned follow-up. The schema is ready for it.

## Consequences

- Booking page never exposes Outlook-aliased addresses (good for brand)
- Internal routing stays decoupled (good for operational flexibility — e.g. switching to a Resend inbox without re-granting OAuth)
- A whole class of "where do I edit my email" admin actions becomes "which email do you mean?" — addressed by the profile UI when it lands
