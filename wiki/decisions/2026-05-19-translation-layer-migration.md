---
title: Translation Layer migration (rosy-bee) — design + Phase A1 schema
category: decision
created: 2026-05-19
updated: 2026-05-19
related: [[wp-inventory-2026-05-19]], [[2026-05-18-pages-cms-expansion]]
---

The Translation Layer is the brand of the Archos Labs blog at `/blog`, populated by absorbing the ~253 published posts from robertangeles.com. The Modelling Room remains separate (LinkedIn newsletter). Phase A1 ships the schema; Phases B–D ship public render, bulk cutover, and polish.

## Context

robertangeles.com is being retired. SEO equity from the source domain is low (Rob's call — D6 in the rosy-bee plan), so the migration is a build-from-scratch SEO/AIEO play on archoslabs.xyz, not an equity-transfer migration. Apex 301 only; domain lapses after a 30–60-day cool-off. The 253 posts become the seed corpus for The Translation Layer.

Full design + review chain lives in [docs/designs/translation-layer.md](../../docs/designs/translation-layer.md) — CEO review (7 expansions surfaced, 6 accepted), Eng review (95-path test coverage diagram, 0 critical gaps), Design review (6.5/10 → 9/10, full DESIGN.md token map for every new component).

## Phase A1 schema (shipped — branch `feature/rosy-bee-phase-a1-schema`)

Five new tables in `lib/db/schema.ts`:

- `post` — time-stamped editorial; sibling of `page` (not subtype). Includes `vector(1024)` embedding column for Voyage `voyage-3-large` semantic search.
- `author` — single-row today (Rob), schema multi-author from day one.
- `category` — Yoast-source taxonomy (4 categories: AI as Strategy, Data as a Decision Infrastructure, Human-Centered Transformation, The Execution Layer).
- `post_revision` — append-only audit trail, mirrors `page_revision`.
- `newsletter_signup` — capture + double-opt-in for Resend Audiences integration.

Migration `drizzle/0013_natural_hedge_knight.sql` enables `CREATE EXTENSION vector` and creates the HNSW index (`m=16, ef_construction=64`, `vector_cosine_ops`) for read-next + `/search` ANN queries.

`CREATE EXTENSION` requires `rds_superuser` (Render Postgres default has it). If it aborts, enable the vector extension via Render dashboard and re-run; the migration is idempotent.

## Inventory findings (frozen snapshot at [[wp-inventory-2026-05-19]])

Real numbers, not estimates:

- **253 published posts** (not 5 from `llms.txt`, not 856 from raw `uhiz_posts` count — the 856 includes 321 revisions + 266 attachments + small misc)
- **Zero shortcodes** across all 11 patterns checked (no Visual Composer, no `[caption]`, no `[edge_*]`) → migration transform is a clean Gutenberg HTML → Turndown markdown pass, with the shortcode normalisation layer **dropped from Phase A4 scope**
- **100% featured-image coverage** → no missing-image fallback path needed
- **One category per post** (effectively — sum 254 vs 253 posts) → schema's one-category-per-post decision holds
- 740 tags total but heavy sprawl; top 14 carry the bulk → Phase A4 filters to `count ≥ 2`
- Yoast focus keyphrase set on 61% of posts → useful signal for Claude polish (E2) topic tagging
- Permalink `/%postname%/` → slug-to-slug 1:1 mapping

## Phase A4 simplifications (vs original plan)

The inventory let us drop several pieces of pre-emptive migration-script complexity:

- DROP Turndown shortcode stripper (`[caption]`, `[gallery]`, etc.)
- DROP Visual Composer HTML un-mangling layer
- DROP edge-cpt custom-post-type extraction branch
- ADD Yoast `primary_term` lookup as multi-category safety net
- ADD tag-frequency filter (`count ≥ 2`) to drop sprawl

Net effect: the migration script is meaningfully smaller than the ENG-review estimate. Validation now happens against real fixture data, not anticipated edge cases.

## Open decisions (post-A1)

- **Public author byline**: WP `display_name` is "Sparq" (legacy alias). Public byline on Archos Labs to be set deliberately when seeding the `author` table. Likely "Rob Angeles" but Rob's call.
- **Scheduled posts (3 rows, `post_status='future'`)**: migration script can either include with `status='scheduled'` or skip until they publish on WP first.

## Source dump

Full WP database dump (45.95 MB SQL) exported on the same day, stored outside the repo (commenter PII). Will be the upstream input for `scripts/migrate-wp/extract.ts` in Phase A4. Path: TBD when Phase A4 begins.

## Related

- Plan source of truth (local): `~/.claude/plans/the-next-work-and-rosy-bee.md`
- Plan in repo: [docs/designs/translation-layer.md](../../docs/designs/translation-layer.md)
- Inventory: [[wp-inventory-2026-05-19]]
- Pages CMS expansion (parallel work): [[2026-05-18-pages-cms-expansion]]
