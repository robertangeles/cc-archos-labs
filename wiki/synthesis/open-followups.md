---
title: Open follow-ups (dated checkpoints)
category: synthesis
created: 2026-05-24
updated: 2026-05-24
related: [[index]], [[log]]
---

Time-sensitive items that need a check on a specific future date. **Read this at session start** alongside [[index]] — items here are forward-looking ("come back to this on date X") not historical record.

When a check is done, either delete the entry or mark it `✅ RESOLVED 2026-MM-DD — outcome.` Keep resolved entries for ~2 weeks of history then prune. If a check fails or surfaces new work, follow the linked PR / decision page and add a new entry for whatever the next checkpoint becomes.

---

## Check by 2026-05-27 — GSC sitemap "Couldn't fetch" should now show Success

**Context:** [[2026-05-24-sitemap-cold-start-cacheable]] + the regression fix in the log entry above. After the `?retry=1` cache-buster trick unstuck GSC, the sitemap submission should transition `Couldn't fetch → Success` within ~hours-to-72h.

**What to check** in GSC → Sitemaps:
1. The entry `https://archoslabs.xyz/sitemap.xml?retry=1` shows **Status: Success** (not "Couldn't fetch")
2. **Last read** has a populated timestamp (not empty)
3. **Discovered pages: 314** (matches what /sitemap.xml currently serves)

**If all three:** great, mark resolved here. Optionally housekeeping: remove the `?retry=1` entry and re-add the clean `sitemap.xml` URL — by now GSC's per-URL failure cache on the clean URL will have expired. Purely cosmetic; functional either way.

**If still "Couldn't fetch" after 2026-05-27:** the deferred follow-up from [[2026-05-24-sitemap-cold-start-cacheable]] becomes worth shipping. Specifically: rename the route from `/sitemap.xml` to `/sitemap` to bypass Cloudflare's edge handling of `.xml` URLs (which forces `cf-cache-status: DYNAMIC` and may also affect Google's fetcher behaviour). Update `robots.txt` to point at the new URL, redirect `/sitemap.xml → /sitemap` 301 for any external references, re-submit in GSC. Strongest research lead is [Jake Saunders' Oct 2025 writeup](https://blog.jakesaunders.dev/fix-google-sitemap-could-not-be-read/) — same symptom, same fix.

**If still "Couldn't fetch" after 2026-06-07 (2 weeks):** something deeper is wrong; revisit with fresh eyes — possibly the R2 image cross-domain issue noted in the decision page, possibly a property-prefix mismatch in GSC (Domain vs URL Prefix property), possibly something not yet considered.
