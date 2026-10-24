---
title: Open follow-ups (dated checkpoints)
category: synthesis
created: 2026-05-24
updated: 2026-10-24
related: [[index]], [[log]]
---

Time-sensitive items that need a check on a specific future date. **Read this at session start** alongside [[index]] — items here are forward-looking ("come back to this on date X") not historical record.

When a check is done, either delete the entry or mark it `✅ RESOLVED 2026-MM-DD — outcome.` Keep resolved entries for ~2 weeks of history then prune. If a check fails or surfaces new work, follow the linked PR / decision page and add a new entry for whatever the next checkpoint becomes.

---

## ✅ RESOLVED 2026-10-24 — GSC sitemap "Couldn't fetch" (was due 2026-05-27)

The `https://archoslabs.xyz/sitemap.xml?retry=1` entry shows **Success** (365 pages discovered on 2026-10-24). The plain `/sitemap.xml` entry stayed stuck on "Sitemap could not be read" because Search Console caches the per-URL failure; it was removed instead.

**Keep the `?retry=1` entry.** An earlier version of this note suggested removing it and re-adding the clean URL; that is wrong, because the clean URL is the one with the cached failure. The `/sitemap` rename in [[2026-05-24-sitemap-cold-start-cacheable]] was not needed. Prune this entry after 2026-11-07.
