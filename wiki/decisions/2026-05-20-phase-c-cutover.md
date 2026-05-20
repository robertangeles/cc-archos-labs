---
title: Translation Layer — Phase C cutover runbook
category: decision
created: 2026-05-20
updated: 2026-05-20
related: [[2026-05-20-translation-layer-public-render]], [[2026-05-19-translation-layer-migration]]
---

Operational runbook for cutting /blog live on archoslabs.xyz. Phase C is **not a code-change phase** beyond the safety-gate scaffolding shipped in PR #65 — the steps below run the prod migration, backfill the byline, flip the flag, and start redirecting `robertangeles.com`.

## Prerequisites

- PR #65 merged (provides `pnpm migrate-wp:apply-prod` + `pnpm seed:blog-author --prod --confirm-prod`)
- Phase B code (PR #64) is already live on prod with the feature flag defaulting to FALSE — meaning /blog and friends currently 404 publicly.
- Your local WSL MariaDB is still running with the WP source. Verify `pnpm inventory:wp` returns 253 posts before starting.
- Render dashboard → Web Service → Environment → External `DATABASE_URL` revealed. **Copy it to clipboard** (it will live in your shell session for ~10 min and then get unset).

## Why two scripts have `--prod` + `--confirm-prod` instead of one

Cheap double-confirmation. Accidentally running `pnpm migrate-wp:apply` from a shell that has `PROD_DATABASE_URL` exported can't fire against prod — the script reads `DATABASE_URL` (dev) by default. Explicit `--prod` is required to switch targets, AND `--confirm-prod` is required on top of that to actually proceed. Single typo can't nuke prod.

Same gate applies to `pnpm seed:blog-author --prod --confirm-prod`.

## Runbook (in order)

### Step 0 — Set the prod URL in your shell

PowerShell:

```powershell
$env:PROD_DATABASE_URL = "postgres://<paste-from-render>"
```

Bash / WSL:

```bash
export PROD_DATABASE_URL='postgres://<paste-from-render>'
```

Verify (without echoing the URL):

```powershell
if ($env:PROD_DATABASE_URL) { "set, length=$($env:PROD_DATABASE_URL.Length)" } else { "NOT SET" }
```

### Step 1 — Confirm prod blog is silent

The Phase B code on prod has the flag default to FALSE. Curl-confirm before changing anything:

```powershell
curl -s -o $null -w "blog: %{http_code}`n" "https://archoslabs.xyz/blog"
curl -s -o $null -w "llms.txt: %{http_code}`n" "https://archoslabs.xyz/llms.txt"
```

Expect: `blog: 404`, `llms.txt: 404`. If either returns 200, **stop** — the flag was already flipped, this runbook needs adjustment.

### Step 2 — Run prod migration

```powershell
pnpm migrate-wp:apply-prod -- --confirm-prod
```

Wall-clock: ~30–60 min for 253 posts. Cost: ~$2.50 USD on OpenRouter + R2 ops (same as the dev run; R2 PUTs are idempotent, so re-uploading the same images is harmless).

The script prints a `TARGET: PRODUCTION DB (host)` banner at the top. Sanity-check the host string matches the Render-Postgres external hostname before letting it proceed.

Manifest lands at `scripts/migrate-wp/output/manifest-{ISO}.json`. Inspect totals at the end: should read 253 / 253 / 253 across every stage and 0 failed.

### Step 3 — Backfill author byline

```powershell
pnpm seed:blog-author -- --prod --confirm-prod
```

Idempotent — runs UPDATE on the single author row, sets name + photo + LinkedIn + bio. Re-running is a no-op.

### Step 4 — Spot-check posts in prod DB

```powershell
# psql via Render's external URL, or use any client of your choice:
psql $env:PROD_DATABASE_URL -c "SELECT COUNT(*) FROM post WHERE source_wp_id IS NOT NULL;"
# expect: 253
psql $env:PROD_DATABASE_URL -c "SELECT name, photo_url FROM author;"
# expect: ('Rob Angeles', '/images/ran-square.png')
```

### Step 5 — Flip the flag from `/admin/blog`

Visit `https://archoslabs.xyz/admin/blog`, sign in, click the toggle. The PUT endpoint invalidates the in-memory cache so the next request sees the new value immediately. No redeploy needed.

Alternative (if admin UI is unreachable for some reason):

```powershell
psql $env:PROD_DATABASE_URL -c "INSERT INTO site_setting (key, value) VALUES ('blog_enabled', '{\"enabled\": true}') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();"
```

⚠️ Direct SQL won't invalidate the in-memory cache on the running Render container — the routes will continue to 404 until the Node process restarts (next deploy or container recycle). The admin UI is strongly preferred.

### Step 6 — Smoke prod

```powershell
curl -s -o $null -w "blog index: %{http_code}`n" "https://archoslabs.xyz/blog"
curl -s -o $null -w "post: %{http_code}`n" "https://archoslabs.xyz/blog/ai-change-management"
curl -s -o $null -w "category: %{http_code}`n" "https://archoslabs.xyz/blog/category/ai-as-strategy"
curl -s -o $null -w "llms.txt: %{http_code}`n" "https://archoslabs.xyz/llms.txt"
curl -s -o $null -w "llms-full.txt: %{http_code}`n" "https://archoslabs.xyz/llms-full.txt"
curl -s -o $null -w "sitemap.xml: %{http_code}`n" "https://archoslabs.xyz/sitemap.xml"
curl -s "https://archoslabs.xyz/blog/ai-change-management" | Select-String -Pattern 'application/ld\+json' | Measure-Object | % { "JSON-LD scripts: $($_.Count) (expect 3)" }
```

All expected `200`. JSON-LD count expects `3` (Article + Person + Breadcrumb).

### Step 7 — Submit sitemap

- Google Search Console → archoslabs.xyz property → Sitemaps → submit `https://archoslabs.xyz/sitemap.xml`
- Bing Webmaster Tools → archoslabs.xyz property → Sitemaps → submit same URL

### Step 8 — Apex 301 from robertangeles.com

In the domain registrar's DNS / forwarding settings, set a 301 permanent redirect:

```
robertangeles.com/*  →  https://archoslabs.xyz/blog
```

Most registrars (GoDaddy, Cloudflare, Namecheap) have a "Domain forwarding" feature that handles this without DNS-record gymnastics. Pick "Permanent (301)" not "Temporary (302)".

Verify:

```powershell
curl -sI "https://robertangeles.com/some-old-post" | Select-String -Pattern '^HTTP|^Location:'
```

Expect: `HTTP/2 301` (or `HTTP/1.1 301`) + `Location: https://archoslabs.xyz/blog` (or wherever).

### Step 9 — Cleanup

```powershell
# Remove prod URL from shell so it doesn't linger across sessions
Remove-Item Env:PROD_DATABASE_URL

# (Optional) Clear PowerShell command history of any line that contains the URL
Clear-History

# Verify
$env:PROD_DATABASE_URL  # should print nothing
```

### Step 10 — Calendar reminders

- T+30 days: review redirect traffic from `robertangeles.com`. If negligible, schedule the domain non-renewal.
- T+60 days: domain lapses. WordPress install can be decommissioned (keep one offline SQL dump as an archive — never published anywhere).

## Failure modes + rollback

| Failure | Rollback |
|---|---|
| Migration halts mid-run | Re-run `pnpm migrate-wp:apply-prod -- --confirm-prod` — idempotent on `source_wp_id`. |
| Post renders broken markdown / images | The post row is in the DB. Edit via `/admin/posts/[id]` (Phase D) OR `UPDATE post SET visibility='unlisted' WHERE slug='foo'` to hide while you fix. |
| Flag was flipped, /blog 500s instead of rendering | Flip flag OFF from `/admin/blog`. Posts stay in DB. Investigate the 500 (logs in Render dashboard). |
| robertangeles.com 301 points at the wrong destination | Re-set forwarding in registrar. No DNS-cache panic — 301 from a forwarding service is cheaply reversible. |
| Sitemap fails Google validation | Inspect `https://archoslabs.xyz/sitemap.xml` directly. Common cause: a post has `published_at = null` (would have been caught by Phase B but worth a defensive check). |

## What this PR contains

- `scripts/migrate-wp/types.ts` + `index.ts` — `--prod` + `--confirm-prod` flag pair, `PROD_DATABASE_URL` env override, target banner before any writes, refusal to run if the two URLs match.
- `scripts/seed/blog-author-backfill.ts` — idempotent author UPDATE with the same safety gate.
- `package.json` — new `pnpm migrate-wp:apply-prod` + `pnpm seed:blog-author` scripts.
- `scripts/migrate-wp/manifest.test.ts` — updated MigrationConfig fixture.
- `wiki/decisions/2026-05-20-phase-c-cutover.md` — this runbook.

No application code changes. Phase B (PR #64) already shipped everything that runs on prod.
