---
title: X Article publishing runbook
category: runbook
created: 2026-11-03
updated: 2026-11-03
related: [[x-article-publishing]], [[2026-11-03-x-articles-autopost]], [[deployment-architecture]]
---

Every blog post that goes live is also posted to X as an Article on `@archoslabsxyz`. This is how to read it, switch it on, and fix it. What it is and why: [[x-article-publishing]], [[2026-11-03-x-articles-autopost]].

## Reading the health check

`GET /api/health/cron?id=x-articles` (public, no auth). It answers 200 only when all of these hold, and 503 otherwise:

| Field | Healthy | If not |
|---|---|---|
| `stale` | `false` (a heartbeat in the last 10 minutes) | The posts cron stopped. Check the Render cron `process-scheduled-posts`. |
| `lastRunJobsFailed` | `0` | The X phase threw. Read the Render log line `[cron/process-scheduled-posts] x-articles phase threw:`. Usual causes: the master key or the Integrations blob cannot be read; Mode is on but one of the four keys is missing (`X keys incomplete`); the table does not exist yet (migration 0046 not applied while Mode is on). |
| `needsAttention` | `0` | A row needs a person. See "Fixing a needs_attention row". |

**`mode` versus `effectiveMode`.** `mode` is what the card says. `effectiveMode` is what the runner really does: Publish runs as Draft unless the environment variable `RENDER` is exactly `true`. DEV is a clone of PROD and X has no delete call, so a laptop can never post publicly. If PROD shows `mode: publish` and `effectiveMode: draft`, `RENDER` is not set on the service, and nothing is going public.

Mode Off is alive but does nothing: the cron still writes the heartbeat, the runner never touches the table.

Log lines from the runner start with `[x-articles]` and carry row ids and reasons only. They never carry a key, a title, post text or an X answer.

## The daily caps

X limits the Articles calls per user per 24 hours, and none of it is on X's pricing or rate-limit pages. It is only in response headers (`x-user-limit-24hour-remaining`).

- **10 draft calls** and **5 publishes**. The window opens at the first call.
- **A refused draft still uses a slot.** X answers a bare 503 for content it dislikes, every try burns one of the 10, and the third counted try ends in `needs_attention` (`attempts_exhausted`).
- The runner stops draining when 2 draft calls or 1 publish is left, and holds the rest of the batch for an hour. 3 Articles a day sits well inside the caps; a backlog does not.
- To see what is left, read the header on any call, or wait: the runner reports it by stopping (`stopped: daily_limit` in the `[x-articles] tick` log line).

## What gets posted, and when

- Each tick the runner queues every public, listed, un-archived post published **in the last 24 hours** that has no row yet, and handles up to 3 rows. Switching Mode on therefore catches up posts from the last 24 hours and nothing older.
- To post one older post, queue it by hand (it is then handled like any other, and goes stale 24 hours after this insert):

```sql
INSERT INTO x_article_publication (post_id) VALUES ('<post id>');
```

- The Article is a **snapshot** taken when the draft is made. X has no edit call, so a later edit to the post never reaches X. Fix the Article by hand on x.com if it matters.
- The cover is cropped to 5:2 (1500 x 600) before upload. If the cover cannot be fetched or uploaded the Article goes without one (`cover_status = 'failed'`); it never blocks the Article. Covers are fetched only from the host in `R2_PUBLIC_URL`, so if that variable is missing on the service every cover fails.
- A post whose body uses something the converter will not send (a table, code, an image, raw HTML, a nested list, a link that is not http or https) becomes `needs_attention` with `converter_refused` and nothing is sent. About 1 to 2 percent of posts.

## Taking down a wrong Article

X has no delete call. On x.com, signed in as `@archoslabsxyz`, open the post, use the "…" menu and Delete. The row stays `published` and the post is never queued again (one row per post). If more are going wrong, set Mode to Off on `/admin/integrations/x` first; nothing public can happen while it is Off.

## Fixing a needs_attention row

List them:

```sql
SELECT id, post_id, attention_reason, attention_detail, article_id, cover_status, attempts, updated_at
FROM x_article_publication WHERE status = 'needs_attention' ORDER BY updated_at;
```

`attention_detail` holds X's own status and error text, or a plain sentence from the runner. It never holds article text.

| `attention_reason` | What happened | What to do |
|---|---|---|
| `converter_refused` | The body uses markup the converter refuses. | Close it (below), and post it by hand on x.com if you want it there. Or fix the post and re-queue it. |
| `x_auth` | X rejected the keys (401 or 403): revoked, or Premium lapsed. | Re-paste the four keys on the card, press Test, then re-queue. |
| `x_rejected` | X refused the request (another 4xx, for example the spending cap or no credits). | Read `attention_detail`, fix the cause in the X console, then re-queue. |
| `attempts_exhausted` | The run died, or X refused the draft, three times. | Re-queue only if something changed (the post, the keys). Otherwise close it. |
| `stale` | Older than 24 hours before it could be posted. | Close it, or re-queue to try anyway. |
| `publish_ambiguous` | The publish call was sent but not confirmed, or X answered OK and the post could not be read back. **It may be live.** | Look on x.com first (below). Never just re-queue. |

**Close it** (never re-queued, the health check goes green). Name yourself in the detail:

```sql
UPDATE x_article_publication
SET status = 'skipped', attention_reason = 'resolved_by_human',
    attention_detail = 'resolved by <name> <YYYY-MM-DD>: <what you did>', updated_at = now()
WHERE id = '<row id>' AND status = 'needs_attention';
```

**Re-queue it** (only when nothing was published; a row that already has a draft goes back to `drafted` and publishes that draft instead of making a second one):

```sql
UPDATE x_article_publication
SET status = CASE WHEN article_id IS NULL THEN 'queued' ELSE 'drafted' END,
    attempts = 0, attention_reason = NULL, attention_detail = NULL,
    next_attempt_at = now(), created_at = now(), updated_at = now()
WHERE id = '<row id>' AND status = 'needs_attention';
```

**`publish_ambiguous`**: open `https://x.com/archoslabsxyz` and look for the Article.
- **It is live:** record it so the row matches reality. The post id is the number at the end of the post's URL:

```sql
UPDATE x_article_publication
SET status = 'published', x_post_id = '<post id>', attention_reason = NULL, attention_detail = NULL, updated_at = now()
WHERE id = '<row id>' AND status = 'needs_attention' AND article_id IS NOT NULL;
```

- **It is not live** and the draft is still in Articles, Drafts: re-queue it, or close it and delete the draft by hand.

A resolved row that is later re-opened by hand is the one case where the database and X can disagree. When in doubt, look at x.com.

## Switching it on (PROD)

Merging code never ships schema. Until Mode is on, the runner does not touch the table, so the order of merge and migration does not matter; the order below does.

1. **Back up PROD:** `pg_dump` to `~/archos_prod_backup_<date>.dump` with `DATABASE_URL_RENDER_PROD` (commented in `.env.local`).
2. **Check what PROD has applied:** read `__drizzle_applied` on PROD. 0046 should be the only untracked migration.
3. **Apply it by hand:** `DATABASE_URL="<PROD>" node scripts/db-apply.mjs`, with the URL inline for that one command, never exported. It is one new table and no change to an existing one.
4. **Set a spending cap** in the X developer console (the project is Pay Per Use). A cap that runs out shows up as `x_rejected`.
5. **Paste the four keys on the PROD card** (`/admin/integrations/x`) and press Test: it must say "Connected to X as @archoslabsxyz". The keys on DEV are not the keys on PROD.
6. **Set Mode to Draft.** Posts from the last 24 hours are queued at the next tick. Let about five real posts through.
7. **Look at them** in x.com, Articles, Drafts, signed in as `@archoslabsxyz`: the title, the formatting, the 5:2 cover, the "Originally published at" link with `utm_source=x` at the end. Drafts stay drafts in this mode.
8. **Add an UptimeRobot monitor** on `https://archoslabs.xyz/api/health/cron?id=x-articles` expecting a 2xx.
9. **Set Mode to Publish.** Check `effectiveMode` in the health body says `publish` (it proves `RENDER` is set). The first Article that goes public: open it on x.com.

**Switching off:** set Mode to Off on the card. Nothing else is needed; queued rows wait.

## Source and use

Built 2026-11-03: [[x-article-publishing]] (what it is, the spike results), [[2026-11-03-x-articles-autopost]] (the decisions). The runner is `lib/x-articles/run.ts`, the table writer `lib/x-articles/queue.ts`, the mode rule `lib/x-articles/mode.ts`. The table is `x_article_publication` (migration 0046).
