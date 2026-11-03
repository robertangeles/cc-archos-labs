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

## Live spike, 2026-11-03 (private drafts only, nothing published)

Run from a scratchpad script against the real API with the brand account's keys (`@archoslabsxyz`, access level `read-write-directmessages`, project on Pay Per Use). Ten draft calls in all, five accepted and five refused.

**Confirmed**
- `GET /2/users/me` 200. Limit 75 per 15 minutes.
- `POST /2/media/upload` 200 with the JSON base64 body. Response `data`: `id`, `media_key`, `expires_after_secs: 86400`, `image: {h, w, image_type}`, `size`. The client's `data.id` read is right. A 3168 x 1092 JPEG (a real post cover, 156 KB) is accepted. **An uploaded cover expires after 24 hours.** Limit 500 per 15 minutes.
- `POST /2/articles/draft` answers **201** with `data: {id, title}`. The OAuth 1.0a signature with a JSON body (body not signed) is accepted, so that premise holds.
- **The draft endpoint has a per-user limit of 10 calls per 24 hours** (`x-user-limit-24hour-limit: 10`, with `-remaining` and `-reset` headers). It is not on any X docs page. A refused call (503) uses a slot like an accepted one. The 24 hour window opened at the first call, 2026-11-03 06:59 UTC.
- Accepted drafts: a single plain paragraph; bold, italic and strikethrough ranges plus a link entity; a divider (atomic block with a divider entity); accents, curly quotes, an em dash and an emoji in plain text; a `header-two` followed by a paragraph.

- **Drafts made through the API do appear in the X editor**, under Articles, Drafts tab, on the brand account, titled as sent, with the first lines as the preview. Seen by Rob 25 minutes after creation: all five, with accents, curly quotes, em dash and emoji intact. X has no call to list or read a draft, so this screen is the only way to see one. Draft mode is therefore a real place to look before anything is public. (An earlier guess in this session that API drafts might be hidden was wrong.)
- **Checked by Rob in the editor, 2026-11-03:** bold, italic, strikethrough and a link render correctly (probe B), and a divider renders as a line between "Before" and "After" (probe C). The empty cover slot says "We recommend an image with a 5:2 aspect ratio for best results", so 5:2 is a recommendation, not a hard rule. **X prints the author's name and handle under the title itself**, so PR2 must not add a byline block (the converter's optional `byline` stays unused).
- **Publish works:** `POST /2/articles/{id}/publish` answered 200 in 0.6 s with `data.post_id`, with no body sent and the OAuth 1.0a signature accepted. **Publish has its own per-user limit of 5 per 24 hours** (`x-user-limit-24hour-limit: 5`), separate from the draft limit of 10. The test Article (probe B) is at `https://x.com/archoslabsxyz/status/2117523613310234800` until Rob deletes it by hand.
- The brand account `@archoslabsxyz` is X Premium and verified (`GET /2/users/me?user.fields=subscription_type` returns `Premium`), so the account needed for Articles is the right one.

**Refused: HTTP 503 `Service Unavailable` with a bare body, every time, never a 4xx**
- The same payload fails again on a re-send, so it is deterministic and not an outage. Removing the cover does not help. Adding a cover is not the cause.
- Failing payloads contain `header-three`, `unordered-list-item`, `ordered-list-item` or `blockquote` (one or more of the four; `header-one` was only ever sent together with them). `header-two` is fine, and non-ASCII text is fine.
- **Not yet isolated** which of the four triggers it. 2026-11-04 after 06:59 UTC: one draft per suspect, then a draft with the cover and a bold range after an emoji.

**What this changes in PR2**
- A 503 on a draft is not a harmless transient: it can repeat forever and each try burns one of ten daily slots. The retry rule "transient failures do not touch attempts" must not apply to a 503 from the draft call. Count it as an attempt (cap 3) so one bad post cannot empty the day.
- Read `x-user-limit-24hour-remaining` from every draft answer and stop draining when it reaches 2, so a manual check or a re-draft is always possible. Three posts a day at three attempts each is nine slots, so a converter that sends content X refuses can starve the queue.
- **At most 5 Articles a day can be published** (publish limit), and a failed publish is never retried, so 5 is a hard ceiling on the posting rate. Read `x-user-limit-24hour-remaining` from publish answers too and stop publishing when it reaches 1.
- Re-upload the cover on every draft attempt that follows a failure more than a few hours later (the media id lives 24 hours).
- **Crop every cover to exactly 5:2 ourselves before upload** (Rob: X Article covers are 5:2, target 1500 x 600). All 342 published posts have a cover, and every cover with recorded dimensions is about 2.9:1 (3168 x 1092, 1856 x 640, 1600 x 552, 1200 x 414), so a centered crop removes about 7% from each side. Checked by eye on two real covers: the subject stays in frame. 253 posts have no dimensions recorded, so read them from the image bytes. `sharp` is already a dependency (`lib/image-pipeline.ts`), so no new package. The first spike sent the uncropped 3168 x 1092 JPEG and never saw how X treats it, because that draft was refused for another reason.
- The converter must not send the block types X refuses until the failing one is known (bullets, numbered items, quotes, `header-three`). A refusal there is `unsupported_markup` and lands in needs-attention.
- **Not verified:** the price of any call (read it in the X console usage page), how the cover is cropped, and how bold ranges land after an emoji (offset units). Rob opens the drafts in the editor to check bold, italic, strikethrough, the link and the divider.

## Rules that bite

- **X has no edit, delete, get or schedule endpoint for Articles.** A wrong Article is deleted by hand on x.com. That is why Draft mode comes first and why an ambiguous publish is never retried.
- **Publish is treated as Draft unless `RENDER` is the string `"true"`.** DEV holds a clone of PROD data and must never post to the brand account.
- **The migration is hand-written** (`drizzle/0046_x_article_publication.sql`). Never run `pnpm db:generate`: the drizzle snapshot stops at 0030 and would emit a huge migration.
- **The sweep looks back 24 hours.** Posts that go live while Mode is Off are picked up if Mode is switched on within 24 hours; older ones are not.
- **Still unverified after the first spike day:** the price of the Articles endpoints (X's pricing page does not list them), the publish endpoint's rate limit, X's offset units in `content_state`, and how the cover image is cropped. See the spike section above for what is settled.

## Follow-ups

Recorded in [[backlog]] and [[open-followups]]: monitor the blog scheduler's own heartbeat and move its Render cron to `curl -fsS`; decide after 20 published Articles whether they bring readers back.
