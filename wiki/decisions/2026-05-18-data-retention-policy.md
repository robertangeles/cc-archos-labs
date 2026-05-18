---
title: Data retention policy + enforcement
category: decision
created: 2026-05-18
updated: 2026-05-18
related: [[index]], [[backlog]]
---

Two retention windows are codified in source AND in the `/privacy` page, and enforced by daily cron jobs. Both windows are hardcoded constants — not Settings rows — so an admin cannot silently drift from the published policy.

## The windows

1. **Request metadata — 30 days.** `assessment_session.ip_address` and `assessment_session.user_agent` are nulled out 30 days after `created_at`. The session row itself, answers, scores, and report remain on the longer lead-account window. Constant: `SESSION_METADATA_RETENTION_DAYS` in `lib/retention/purge-session-metadata.ts`.

2. **Lead accounts — 24 months from last activity.** A `lead` row plus all linked `assessment_session` (+ `report_output` + `share_token` via cascade) and `magic_link_token` rows are deleted 24 months after the most recent of: `lead.updated_at`, `assessment_session.created_at`, `magic_link_token.consumed_at`. Constant: `LEAD_INACTIVITY_RETENTION_MONTHS` in `lib/retention/purge-inactive-leads.ts`.

## Why these numbers

- **30 days for IP/UA** is the industry baseline (AWS CloudTrail, Cloudflare, GitHub all sit in the 7–90 day band) and gives ~4× the typical abuse-investigation window without inviting questions under APP 11.2 / GDPR Art. 5(1)(e).
- **24 months for lead accounts** matches the enterprise transformation sales cycle (6–18 months from first contact to engagement signature) plus a buffer. Long enough that an exec who took the diagnostic in Q1 2026 can still reference it from a Q4 2027 board paper. Short enough to defend as "minimum necessary for the stated purpose."

## Why hardcoded, not Settings-backed

CLAUDE.md user-memory rule: default to DB-backed Settings for anything Rob may want to change without dev help. Retention windows are an explicit exception. The number is coupled to the published `/privacy` page text — if admin lowered it to 7 via Settings, the policy text would silently mis-state retention. Locking the constant in source forces the change to go through a code review where the policy text update sits in the same diff.

## Schema decision: explicit two-step delete, not cascade

`assessment_session.lead_id` is `ON DELETE SET NULL` by original design (sessions begin anonymously before registration; the FK is nullable). For the retention purge that's the wrong cascade direction — we want the data *gone*, not anonymised. So `purgeInactiveLeads` runs in a single transaction with two explicit DELETEs:

1. Delete sessions belonging to inactive leads → cascades `report_output` + `share_token`.
2. Delete the leads themselves → cascades `magic_link_token`.

The `SET NULL` cascade is preserved for "delete on request" / future GDPR-style deletion flows where anonymising vs deleting is a separate decision.

## Render Cron setup (Rob owns this — not done by code)

Two new daily jobs in the Render dashboard. Both POST with the shared `CRON_SECRET` Bearer header.

```
# Daily 03:00 UTC — IP/UA purge on assessment_session rows older than 30 days
curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  https://archoslabs.xyz/api/cron/purge-session-metadata

# Daily 03:05 UTC — lead account purge for accounts inactive 24+ months
curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  https://archoslabs.xyz/api/cron/purge-inactive-leads
```

5-minute offset between the two so log lines don't interleave during debugging.

## Coupling check before changing either constant

Anyone editing `SESSION_METADATA_RETENTION_DAYS` or `LEAD_INACTIVITY_RETENTION_MONTHS` must update:

1. The constant in the lib file.
2. The matching text on `app/privacy/page.tsx` (the "How long we keep it" + "What we collect" sections).
3. This decision page's "The windows" section.
4. The unit test that asserts the constant value (catches drift in CI).
