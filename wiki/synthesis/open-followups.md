---
title: Open follow-ups (dated checkpoints)
category: synthesis
created: 2026-05-24
updated: 2026-11-03
related: [[index]], [[log]], [[x-article-publishing]]
---

Time-sensitive items that need a check on a specific future date. **Read this at session start** alongside [[index]] — items here are forward-looking ("come back to this on date X") not historical record.

When a check is done, either delete the entry or mark it `✅ RESOLVED 2026-MM-DD — outcome.` Keep resolved entries for ~2 weeks of history then prune. If a check fails or surfaces new work, follow the linked PR / decision page and add a new entry for whatever the next checkpoint becomes.

---

## ✅ RESOLVED 2026-10-24 — GSC sitemap "Couldn't fetch" (was due 2026-05-27)

The `https://archoslabs.xyz/sitemap.xml?retry=1` entry shows **Success** (365 pages discovered on 2026-10-24). The plain `/sitemap.xml` entry stayed stuck on "Sitemap could not be read" because Search Console caches the per-URL failure; it was removed instead.

**Keep the `?retry=1` entry.** An earlier version of this note suggested removing it and re-adding the clean URL; that is wrong, because the clean URL is the one with the cached failure. The `/sitemap` rename in [[2026-05-24-sitemap-cold-start-cacheable]] was not needed. Prune this entry after 2026-11-07.

---

## X Article spike: finish the bisect after 2026-11-04 06:59 UTC

**Due:** after the X draft limit (10 per 24 hours) resets, 2026-11-04 06:59 UTC. All ten slots were used on 2026-11-03. Find which of `header-three`, bullet, numbered item or quote makes the draft endpoint answer 503 (one draft each), then send one draft with the cover and a bold range after an emoji, have Rob check the drafts on x.com, and only then run the one test publish. Rob deletes the test drafts and the test Article by hand. Findings so far in [[x-article-publishing]].

---

## Check after 20 published X Articles: do they bring readers back?

**Due:** when 20 Articles are public, about a week after Publish mode is switched on (3 a day). Not before: until then there is nothing to compare.

Nobody has published numbers on X Articles against link posts, and a full copy on X keeps the reader on X. Each Article ends with a backlink tagged `utm_source=x`. Compare the views X shows for each Article (only visible in the X interface, copy them by hand) with the GA4 visits from `utm_source=x`, then decide one of: keep the full-text Articles; move to a short teaser with a link; stop. Write the outcome as a decision page and record the number that counted as success. See [[x-article-publishing]] and [[2026-11-03-x-articles-autopost]].
