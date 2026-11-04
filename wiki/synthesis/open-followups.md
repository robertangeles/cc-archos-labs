---
title: Open follow-ups (dated checkpoints)
category: synthesis
created: 2026-05-24
updated: 2026-11-04
related: [[index]], [[log]], [[x-article-publishing]]
---

Time-sensitive items that need a check on a specific future date. **Read this at session start** alongside [[index]] — items here are forward-looking ("come back to this on date X") not historical record.

When a check is done, either delete the entry or mark it `✅ RESOLVED 2026-MM-DD — outcome.` Keep resolved entries for ~2 weeks of history then prune. If a check fails or surfaces new work, follow the linked PR / decision page and add a new entry for whatever the next checkpoint becomes.

---

## ✅ RESOLVED 2026-10-24 — GSC sitemap "Couldn't fetch" (was due 2026-05-27)

The `https://archoslabs.xyz/sitemap.xml?retry=1` entry shows **Success** (365 pages discovered on 2026-10-24). The plain `/sitemap.xml` entry stayed stuck on "Sitemap could not be read" because Search Console caches the per-URL failure; it was removed instead.

**Keep the `?retry=1` entry.** An earlier version of this note suggested removing it and re-adding the clean URL; that is wrong, because the clean URL is the one with the cached failure. The `/sitemap` rename in [[2026-05-24-sitemap-cold-start-cacheable]] was not needed. Prune this entry after 2026-11-07.

---

## X Article spike: finish the checks (PROD went live 2026-11-04; the draft cap reset at 06:59 UTC)

**Update 2026-11-04:** PROD is live in Publish mode and posted its first three Articles (the AI News posts) at 09:55 UTC, so the real-post draft check below is overtaken by events. What is still open: which of `header-three`, bullet, numbered item or quote makes the draft endpoint answer 503 (the converter's fallback hides it), and why the first test post vanished. The one-feature-per-draft tests below still apply, best run on the next quiet day of the caps (10 drafts, 5 publishes per 24 h, shared with PROD's 3 a day).

**Due (original note):** after the X draft limit (10 per 24 hours) resets, 2026-11-04 06:59 UTC. All ten slots were used on 2026-11-03. Find which of `header-three`, bullet, numbered item or quote makes the draft endpoint answer 503 (one draft each), then send one draft with a cover pre-cropped to 5:2 (1500 x 600, centered, via `sharp`) and a bold range after an emoji, have Rob check the drafts on x.com, and only then run the one test publish. Rob deletes the test drafts and the test Article by hand. Findings so far in [[x-article-publishing]].

**Order after the reset (10 drafts, 2 publishes left until 07:45 UTC):** (1) the real post: a live post, "Why Your AI Pilot Never Ships", is already queued on DEV; run the run phase in Draft mode against it (the 2026-11-03 attempt reached X and got a 429 "remaining=0"; cover fetch, crop and upload had worked) and have Rob read the draft in Articles > Drafts: headings, three links, the cropped cover. (2) One feature per draft, published and watched for 2 minutes with the syndication endpoint: link only, bold only, italic only, strikethrough only, then bullets, numbered items, a quote, `header-three` (the first test post, with a link and styles, vanished minutes after publishing and nobody knows why). (3) Flip to native only what X accepts. Delete every test post afterwards through `DELETE /2/tweets/{id}`.

---

## Check after 20 published X Articles: do they bring readers back?

**Due:** when 20 Articles are public, about a week after Publish mode is switched on (3 a day). Not before: until then there is nothing to compare.

Nobody has published numbers on X Articles against link posts, and a full copy on X keeps the reader on X. Each Article ends with a backlink tagged `utm_source=x`. Compare the views X shows for each Article (only visible in the X interface, copy them by hand) with the GA4 visits from `utm_source=x`, then decide one of: keep the full-text Articles; move to a short teaser with a link; stop. Write the outcome as a decision page and record the number that counted as success. See [[x-article-publishing]] and [[2026-11-03-x-articles-autopost]].
