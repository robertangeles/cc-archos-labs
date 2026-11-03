---
title: X Article publishing
category: entity
created: 2026-11-03
updated: 2026-11-03
related: [[2026-11-03-x-articles-autopost]], [[integration-config]], [[news-draft-pipeline]], [[deployment-architecture]], [[2026-11-02-remove-skills-workflows-social]]
---

Every blog post that goes live is also posted to X as an Article on the brand account. **Status 2026-11-03: PR1 (the spike wave) is built and dormant.** Mode is Off, there is no table and the cron route is unchanged. PR2 (the queue) has not started and needs Rob's explicit database go.

## What PR1 ships

- **The X card** at `/admin/integrations/x`: four OAuth 1.0a codes (API key, API secret, access token, access token secret), a Test button that reads `GET /2/users/me` and says "Connected to X as @handle", and a Mode select: Off, Draft only (saved to the X drafts, nothing public) or Publish automatically. Default Off. The three secrets are encrypted in the `integration_secrets` blob like every other key ([[integration-config]]).
- **`lib/x-articles`**: `oauth1.ts` (HMAC-SHA1 signer on `node:crypto`), `client.ts` (`getMe`, `uploadMedia`, `createDraft`, `publishDraft`, each failure mapped to a kind: auth, rate limited, rejected, transient, ambiguous), `content-state.ts` (Markdown to X's `content_state`; an allowlist that refuses by default).
- **A row lock** in `updateIntegrationSecret`: the read is `FOR UPDATE`, so two overlapping saves can no longer drop one another (it could have restored an old mode after an admin switched it Off). The proof needs a real Postgres: `tests/real-pg/integration-lock.real-pg.test.ts`, skipped unless `REAL_PG_URL` is set and the host is local.
- **`app/api/cron/process-scheduled-posts/route.test.ts`**: pins the five behaviors of the blog scheduler route against the unedited route. The route had no test before.

## What PR2 will add (not built)

The queue, planned in [[2026-11-03-x-articles-autopost]]: after the publish step in the same cron route each tick, a second phase sweeps `post` for rows published in the last 24 hours with no X record, queues them in `x_article_publication`, and drains up to three. One module owns every write (`queue.ts`), each state change is one conditional update fenced by `claimed_by` and the expected status.

```
queued -> working -> drafted -> publishing -> published        (terminal)
              |          '--> draft_only                       (Draft mode, terminal, never promoted)
              '-- release -> queued / drafted
 any -> skipped (post no longer public) | needs_attention (a person looks)
 a `publishing` row whose lease expires ALWAYS becomes needs_attention (publish may have been sent)
```

## Rules that bite

- **X has no edit, delete, get or schedule endpoint for Articles.** A wrong Article is deleted by hand on x.com. That is why Draft mode comes first and why an ambiguous publish is never retried.
- **Publish is treated as Draft unless `RENDER` is the string `"true"`.** DEV holds a clone of PROD data and must never post to the brand account.
- **The migration is hand-written** (`drizzle/0046_x_article_publication.sql`). Never run `pnpm db:generate`: the drizzle snapshot stops at 0030 and would emit a huge migration.
- **The sweep looks back 24 hours.** Posts that go live while Mode is Off are picked up if Mode is switched on within 24 hours; older ones are not.
- **Unverified until the live spike:** the price and rate limits of the Articles endpoints (X's pricing page does not list them), whether JSON bodies are excluded from the OAuth signature, X's offset units in `content_state`, and how the cover image is cropped.

## Follow-ups

Recorded in [[backlog]] and [[open-followups]]: monitor the blog scheduler's own heartbeat and move its Render cron to `curl -fsS`; decide after 20 published Articles whether they bring readers back.
