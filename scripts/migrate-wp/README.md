# scripts/migrate-wp/ — Translation Layer migration (rosy-bee)

One-shot tooling that migrates the published posts from robertangeles.com (WordPress) into the Archos Labs blog at `/blog` (brand: "The Translation Layer"). Per the [design doc](../../docs/designs/translation-layer.md), this is a multi-phase rollout; this directory is Phase A4 (skeleton) + Phase B (full pipeline) fused.

## Pipeline shape

```
WP MySQL (uhiz_*)
    │
    ▼ extract.ts          (mysql2 → typed records, JOINs author/category/tags/meta)
    │
    ▼ transform.ts        (HTML → markdown via Turndown, slug normalisation, reading time)
    │
    ▼ claude-polish.ts    (Claude via OpenRouter — excerpt + currency check + topic tags + needs_review flag)
    │
    ▼ embed.ts            (Voyage voyage-3-large 1024-dim embedding)
    │
    ▼ media-rehost.ts     (download WP images → Cloudflare R2 → rewrite markdown URLs)
    │
    ▼ og-generate.ts      (@vercel/og branded image template → R2)
    │
    ▼ insert.ts           (Drizzle upsert into Archos Labs Postgres, idempotent on source_wp_id)
    │
    ▼ Side outputs:
        - redirect-rules.ts  emits apex 301 rule for robertangeles.com → archoslabs.xyz/blog
        - llms-txt.ts        regenerates /llms.txt + /llms-full.txt from post table
        - manifest.ts        per-post decisions log (markdown table)
```

## Modes

```powershell
# Dry-run — extract + transform only, no writes anywhere. Manifest tells you
# what WOULD migrate. Safe to run repeatedly.
pnpm migrate-wp:dry-run

# Full apply — runs the entire pipeline including Claude, Voyage, R2, Postgres.
# Idempotent on `source_wp_id`; re-runs upsert the same rows.
pnpm migrate-wp:apply
```

Optional flags (passed after `--`):

```powershell
pnpm migrate-wp:dry-run -- --limit 5                  # only first 5 posts
pnpm migrate-wp:apply  -- --limit 5 --skip-media       # skip R2 uploads (debug)
pnpm migrate-wp:apply  -- --slug ai-governance-framework   # single post by slug
```

## Required env

See [`.env.example`](../../.env.example) for the full list. Migration-specific:

- `WP_DATABASE_URL` — MySQL connection to the source. GoDaddy blocks external 3306; **set up Docker MySQL locally + import dump** (see [Local MySQL setup](#local-mysql-setup)).
- `WP_TABLE_PREFIX` — `uhiz_` for robertangeles.com.
- `VOYAGE_API_KEY` — for embeddings.
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_URL` — for media + OG image hosting.
- `OPENROUTER_API_KEY` — already wired for the rest of the app; reused for Claude polish.
- `DATABASE_URL` — Archos Labs Postgres write target. Same as `pnpm db:migrate`.

## Local MySQL setup (one-time)

GoDaddy shared hosting blocks external port 3306 at the firewall (verified 2026-05-19), so we run MySQL locally and import the WP dump.

Two equally good paths — pick whichever fits your machine:

### Path A — WSL2 + MariaDB (recommended on Windows if WSL is set up)

```powershell
# Windows: ensure WSL is installed (one-time, may require reboot)
wsl --install              # installs WSL2 + Ubuntu by default
wsl --status               # confirm WSL2 + a distro is registered
```

Then inside WSL:

```bash
# Install MariaDB
sudo apt update
sudo apt install -y mariadb-server
sudo service mariadb start

# Set the root password (or run sudo mysql_secure_installation for a guided flow)
sudo mariadb -e "ALTER USER 'root'@'localhost' IDENTIFIED BY 'local';"
sudo mariadb -e "CREATE DATABASE i3664903_x7et1;"

# Import the dump (Windows paths are exposed under /mnt/c/...)
mysql -u root -plocal i3664903_x7et1 < /mnt/c/path/to/i3664903_x7et1.sql
```

WSL's MariaDB binds to `127.0.0.1` on the Windows side too. Add to `.env.local`:

```
WP_DATABASE_URL=mysql://root:local@127.0.0.1:3306/i3664903_x7et1
WP_TABLE_PREFIX=uhiz_
```

### Path B — MariaDB native Windows installer (if you don't want WSL)

1. Download the MSI from https://mariadb.org/download (latest stable, ~50 MB)
2. Run the installer; set a root password; install as a Windows service
3. From PowerShell (after install):

```powershell
mysql -u root -p -e "CREATE DATABASE i3664903_x7et1;"
mysql -u root -p i3664903_x7et1 < "C:\path\to\i3664903_x7et1.sql"
```

4. Same `.env.local` shape as Path A (substitute your root password).

### Tear down

WSL: `sudo service mariadb stop` (keeps the DB; safe to restart later) or `sudo apt purge mariadb-server` (full removal).
Native Windows: uninstall MariaDB from Windows Settings → Apps.

## Idempotency

The migration is idempotent on `post.source_wp_id`:

- Re-running upserts the same posts; no duplicates.
- Re-running on a partial state continues from the next un-migrated post.
- The `__migrate_wp_manifest.json` file (written next to the script) tracks per-post decisions so you can diff between runs.

## Cost ceiling

- Claude (OpenRouter, anthropic/claude-sonnet-4-6): 253 posts × 3 calls × ~$0.001 = **~$0.80 total**
- Voyage embeddings: 253 posts × ~2K tokens × $0.18/1M tokens = **~$0.10**
- Cloudflare R2 storage: ~400 MB images + OG images → $0.06/month forever
- R2 egress: $0 (Cloudflare's zero-egress differentiator)

Total one-time migration cost: under $1. Ongoing: under $0.10/month.

## Archive policy

Per the [eng review](../../docs/designs/translation-layer.md#eng-section-10--long-term-trajectory), this directory is one-shot tooling. After Phase C ships and the migration is stable, archive (don't delete) this folder for audit-trail value.
