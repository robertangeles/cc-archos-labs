---
title: Translation Layer — Phase C cutover (post-mortem + remaining steps)
category: decision
created: 2026-05-20
updated: 2026-05-20
related: [[2026-05-20-translation-layer-public-render]], [[2026-05-19-translation-layer-migration]]
---

Phase C of the rosy-bee plan was framed as a "prod cutover": run the migration against prod, flip the flag, set the apex 301. **The framing was wrong.** Archos Labs has a single Render Postgres — `.env.local`'s `DATABASE_URL` and the Render web service both point at it. There is no separate prod DB. Every operation we called "dev" was already prod.

## What was actually true the whole time

- **One Render Postgres** (`archos_labs_pdb` @ `dpg-d7u1upd0lvsc73ekq010-a.singapore-postgres.render.com`).
- The May 19 migration run (253 posts) wrote directly to prod.
- The author rename + photo/bio backfill wrote directly to prod.
- The `blog_enabled` flag was flipped ON in prod during the dev walk-through.
- PR #64 (Phase B render code) auto-deployed via Render on merge and immediately served the live data.

By the time anyone asked "should we do Phase C?", Phase C was effectively done.

## What's actually live on archoslabs.xyz

Verified by curl on 2026-05-20:

- `/blog` → 200 (paginated index, thumbnails, 257 sitemap entries)
- `/blog/[slug]` → 200 (article, JSON-LD ×3, R2 hero image, byline photo)
- `/blog/category/[slug]` → 200
- `/llms.txt` → 200 (top-20 posts)
- `/llms-full.txt` → 200 (1.1 MB corpus)
- `/sitemap.xml` → 200 (5 static pages + 1 /blog + 4 categories + 252 posts)
- `/robots.txt` → 200 (10 AI bots named, all allowed)

## What's actually left to do

| # | Step | Effort |
|---|---|---|
| 1 | Submit `https://archoslabs.xyz/sitemap.xml` to Google Search Console | ~5 min |
| 2 | Submit the same URL to Bing Webmaster Tools | ~5 min |
| 3 | Apex 301 from `robertangeles.com/*` → `https://archoslabs.xyz/blog` in the domain registrar (GoDaddy/Cloudflare/wherever the domain lives). Pick **Permanent (301)**, not 302. | ~15 min |
| 4 | Calendar reminder: 30–60 days post-step-3, schedule `robertangeles.com` for non-renewal and decommission the WP install (keep one offline SQL dump as an archive — never published anywhere). | ~30 sec to add the reminder |

All four are operational, none require code. Phase C as a "PR" was a category error on my part.

## Operational utilities that stay

The migration + seed scripts remain useful for the rare case of a content refresh:

- `pnpm migrate-wp:apply` — re-runs the WP → Postgres pipeline. Idempotent on `source_wp_id`, so re-running is safe and updates any post whose content has changed at source. Use only if you re-edit something on the WP source before decommissioning.
- `pnpm seed:blog-author` — idempotent UPDATE on the single author row. Use if you ever change your byline / photo / LinkedIn / bio so the prod row reflects the new values.

Both read `DATABASE_URL` from `.env.local`. With single-DB, that's correct — there's no "wrong" target.

## What I removed in PR #66

PR #65 introduced `--prod` + `--confirm-prod` flags on both scripts plus a `PROD_DATABASE_URL` shell-env override. That whole construct was solving an imaginary problem (separate prod DB) and added defensive noise to scripts that don't need defending. PR #66 strips it back to the single-DB reality:

- Removed `prod` + `confirmProd` fields from `MigrationConfig`
- Removed `--prod` / `--confirm-prod` CLI flag handling from both scripts
- Removed the `validateApplyEnv` prod-branching and the `TARGET: PRODUCTION DB` banner
- Removed `pnpm migrate-wp:apply-prod` from `package.json`
- Updated the manifest test fixture

The `seed:blog-author` script's actual UPDATE logic is unchanged — only the (unneeded) prod-target plumbing came out.
