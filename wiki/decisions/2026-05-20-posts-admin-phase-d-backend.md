---
title: Posts Admin (Phase D) — backend slice
category: decision
created: 2026-05-20
updated: 2026-05-20
related: [[translation-layer]], [[2026-05-20-translation-layer-public-render]], [[2026-05-18-pages-cms-expansion]], [[deployment-architecture]], [[book-a-call-architecture]]
---

Phase D of the Translation Layer adds the per-post admin so the 120 needs_review posts can be cleared without raw SQL and net-new posts can be authored + scheduled. Shipping as two slices because the cathedral surface (~4-5k lines) is too large to ship + verify in one PR without quality drift.

This decision covers **Slice A — backend only**: schema migration, service layer, API routes, scheduled-publisher cron, side-effect orchestration, unit tests. The UI (list, editor, live preview, link suggestions drawer, revisions page, Playwright E2E) ships in Slice B.

## Locked-in decisions

- **Approach C (cathedral, HOLD SCOPE).** Pages-CMS pattern + needs_review queue (filter) + AI-assist (regenerate OG + suggest internal links via embeddings) + scheduled publishing. No further expansion in v1.
- **URL placement: `/admin/blog/posts/*`** (nested under the existing `/admin/blog` toggle page, which will be reshaped into a tabbed parent in Slice B).
- **Cron mechanism: new dedicated route `/api/cron/process-scheduled-posts`** mirroring the existing `/api/cron/process-scheduled` (booking emails) exactly — Bearer auth via `CRON_SECRET`, `cron_heartbeat` row with `id='posts-publisher'`, `FOR UPDATE SKIP LOCKED` poll, constant-time secret compare.
- **Slug uniqueness via PG `unique` constraint;** 23505 → `DuplicateSlugError` → 409.
- **Optimistic locking via `expectedUpdatedAt` round-trip;** mismatch → `ConcurrentEditError` → 409 with `reason:"stale_updated_at"` + `currentUpdatedAt`. UI banner mirrors the Pages CMS "Someone else saved this" pattern.
- **Side effects (OG regen + embedding regen) run AFTER tx commit,** inside `Promise.allSettled`, with each failure surfaced to the response as a non-blocking warning rather than rolled back. Rationale: holding a row lock during a 1-2s OpenRouter call is worse than re-running the side effect later if it fails.
- **Embedding regen fires when `contentMd diffSizePct > 5%`.** Cheap edits (typos) don't burn API credits; substantial edits do.
- **OG regen fires when `title` OR `excerpt` changes.** Author/category/tag changes don't touch the OG card. (Note: `lib/og.ts` is still a stub — the regen returns the empty-path sentinel until the satori + Geist + R2 pipeline lands. The infrastructure is wired so the moment that PR merges, both the migration script and the admin button light up without API changes.)
- **`scheduledPublishAt` column added to `post` table** (timestamp with time zone, nullable). Partial index `post_due_for_publish_idx WHERE status='scheduled'` keeps the cron's poll query tiny.
- **Schedule invariants enforced at TWO layers:** Zod `.superRefine()` at the API boundary (catches client-side bugs) + service-layer `enforceScheduleInvariant` (catches slow-client / queued-retry edge cases where the wall clock advanced past the picked time).
- **`/admin/blog/posts/*` and `/api/admin/posts/*` are auth-gated by the existing `proxy.ts` middleware** — verified by smoke tests returning 401 on all 10 new admin endpoints. The cron route mounts outside the proxy and validates the Bearer itself.

## Architectural decisions

### Reuse `lib/posts.ts` as-is; new code at `lib/posts-admin/`

The existing `lib/posts.ts` is the public reader for `/blog` — imported by 13 files (sitemap, llms.txt, /blog index + slug + category, read-next, structured-data tests, etc.). Pages CMS chose `lib/pages/` because it was greenfield; Posts has pre-existing reader code that shouldn't be disturbed. New surface: `lib/posts-admin/` sibling, with index/types/schema/word-count/similarity/scheduled-publisher splits matching the Pages CMS shape.

### `lib/og.ts` + `lib/embeddings.ts` extracted into `lib/`

Both the migration pipeline and the admin button need the same primitives:
- `lib/og.ts` — shared OG generation (currently stub, future satori). Migration script becomes a typed adapter that delegates.
- `lib/embeddings.ts` — shared Voyage/OpenRouter embedding call with retry. Migration script becomes a typed adapter that preserves the per-post `sourceWpId` in error messages for the manifest.

This is the only reason `scripts/migrate-wp/og-generate.ts` and `scripts/migrate-wp/embed.ts` change in this PR — they now thinly wrap `lib/` instead of containing the logic inline.

### Side effects run synchronously, not as a queue

Considered: enqueue OG/embedding regen into the existing `scheduled_job` table (booking-emails queue). Rejected because the `scheduled_job` table is FK'd to `bookingRequest` and posts aren't bookings — shoehorning posts in via polymorphic FK is a smell. Considered: a generic queue. Rejected for v1 — overcomplicated for the post-save-frequency we expect. The current synchronous-await-with-Promise.allSettled inside the request handler is fine for 2-3s save times, surfaces failures clearly, and avoids the operational surface of a queue.

If the per-save cost ever becomes too high, the right move is a generic `lib/job-queue.ts` that both bookings and posts can enqueue into — not retrofitting the booking-specific scheduler.

### Schema invariants in the app layer, not check constraints

`status='scheduled' ↔ scheduledPublishAt IS NOT NULL AND > now()` could be a CHECK constraint, but the "in the future" half changes with every wall-clock tick and would block legitimate "publish now" backfills. Enforced in Zod + service instead. The "scheduledPublishAt MUST be null when status != 'scheduled'" half is structurally enforceable but adds noise — the service `normalisePostInput` clears it on save regardless.

## What ships in Slice A

| Surface | New files | Purpose |
|---|---|---|
| Migration | `drizzle/0014_post_scheduled_publish_at.sql` + journal entry | adds column + partial index |
| Schema | `lib/db/schema.ts` (edit) | `scheduledPublishAt` column + partial index entry |
| Shared lib | `lib/og.ts`, `lib/embeddings.ts` | extracted from `scripts/migrate-wp/*` |
| Service | `lib/posts-admin/{index,types,schema,word-count,similarity,scheduled-publisher}.ts` | full CRUD + similarity search + cron logic |
| API | `app/api/admin/posts/{route,[id]/route,[id]/restore/route,[id]/revisions/route,[id]/revisions/[revId]/restore/route,[id]/regenerate-og/route,[id]/suggest-links/route}.ts` | 7 admin routes |
| Cron | `app/api/cron/process-scheduled-posts/route.ts` | new heartbeat row `id='posts-publisher'` |
| Tests | `lib/og.test.ts`, `lib/embeddings.test.ts`, `lib/posts-admin/{word-count,schema,diff}.test.ts` | 5 unit test files |

Verification: `pnpm tsc` + `pnpm test` (40 files / 526 tests / all green), smoke test confirms 10×401 on the admin routes + 503 cron without `CRON_SECRET` (matching existing booking-cron behaviour).

## Out of scope (deferred to Slice B or beyond)

- **All UI** — list view, editor, live preview, link suggestions drawer, revisions page, tab reshape of `/admin/blog`, Playwright E2E. Slice B.
- **Featured-image upload UI** to override `ogImagePath` manually. Backlog.
- **AI-generate-excerpt button** (Claude call, costs $ per click). Backlog.
- **Draft auto-archive (>90 days).** Backlog.
- **RSS/sitemap auto-regen on publish.** Backlog (RSS already an open item).
- **Multi-author UX** (only one admin today). Backlog.
- **Inline image upload in editor** (separate R2 endpoint work). Backlog.
- **Internal-link auto-insertion** (suggestions are manual-insert only in v1). Backlog.
- **Post-performance analytics** (view counts, engagement). Backlog.
- **Comments / discussion, A/B title testing, LinkedIn auto-cross-post.** Backlog.

## Operational follow-ups required after merge

1. Run `pnpm drizzle-kit push` (or `pnpm db:migrate`) against the single Postgres to apply `0014_post_scheduled_publish_at.sql`. Idempotent if re-run.
2. In Render dashboard → Cron Jobs → add a new cron: every minute, POST to `https://archoslabs.xyz/api/cron/process-scheduled-posts` with header `Authorization: Bearer ${CRON_SECRET}`. Same `CRON_SECRET` already in use by the booking cron.
3. Smoke-test the authenticated routes via curl after login (runbook in the PR description). Confirms the full happy path before Slice B builds the UI.

## Why this slicing

The cathedral surface is ~4-5k lines across ~25 files. CLAUDE.md is explicit: "Unused or experimental code must not ship." Slicing backend / UI lets each PR ship fully tested with no half-built code, and the backend slice has standalone value — curl + Render Cron prove scheduling works end-to-end before any pixel exists. Slice B opens with a fresh context window so the second half doesn't ride a mid-implementation compaction.

Architectural cost of slicing: ~30 min of branch setup + reading already done. Architectural benefit: each PR is independently reviewable, CI-green, smoke-tested.
