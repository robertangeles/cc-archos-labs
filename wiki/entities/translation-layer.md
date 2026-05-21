---
title: The Translation Layer
category: entity
created: 2026-05-20
updated: 2026-05-20
related: [[2026-05-19-translation-layer-migration]], [[2026-05-20-translation-layer-public-render]], [[2026-05-20-phase-c-cutover]], [[2026-05-20-posts-admin-phase-d-backend]], [[2026-05-20-posts-admin-phase-d-ui]], [[deployment-architecture]], [[wp-inventory-2026-05-19]]
---

The Translation Layer is the publication brand at `/blog` on archoslabs.xyz — Archos Labs' owned content surface, populated by the 253 posts migrated from robertangeles.com (the rosy-bee migration). It is **distinct** from The Modelling Room, which stays as a LinkedIn-native newsletter. Never conflate the two.

## What it is

- **Surface:** `/blog`, `/blog/[slug]`, `/blog/category/[slug]` on archoslabs.xyz
- **Brand:** "The Translation Layer" — Archos Labs' voice on data architecture, AI delivery, and enterprise reality
- **Corpus:** 253 published posts migrated 2026-05-20 from robertangeles.com (single author: Rob Angeles)
- **Stack:** Server-rendered Next.js routes + pgvector HNSW for /blog read-next and /search
- **Gating:** `site_setting.blog_enabled` feature flag — set TRUE after Phase C cutover

## What it is not

- **Not The Modelling Room.** The Modelling Room is a LinkedIn newsletter — separate channel, separate cadence, owned outside the site. The Translation Layer is the on-site publication. They serve different audiences; the LinkedIn surface drives top-of-funnel, the on-site surface anchors AIEO + practitioner credibility.
- **Not a SEO-equity migration.** robertangeles.com is being retired; the apex 301 redirects for a 30–60-day cool-off then the domain lapses. The 253 posts become a *seed corpus* for AIEO + practitioner credibility — they are not preserved for their original ranking signal. See [[2026-05-19-translation-layer-migration]] D6 for the framing call.

## Why "rosy-bee"

"rosy-bee" is the internal project codename for the WordPress → /blog migration (Phases A1 → D). It appears in branch names (`feature/rosy-bee-phase-*`), scripts (`scripts/migrate-wp/`), and conversational reference. It is not a brand name and does not appear on the site. The brand is **The Translation Layer**.

## Architecture pointers

- [[2026-05-19-translation-layer-migration]] — Phase A1 schema + WP inventory + design decisions (CEO + Eng + Design reviews)
- [[2026-05-20-translation-layer-public-render]] — Phase B public render layer (routes, AIEO chrome, admin toggle)
- [[2026-05-20-phase-c-cutover]] — Phase C cutover runbook (flag flip + apex 301)
- [[deployment-architecture]] — single-DB runtime topology the Translation Layer ships on
- [[wp-inventory-2026-05-19]] — frozen source-DB snapshot the migration used

## Phase D (post-launch follow-ups)

Listed in the [backlog](../backlog/backlog.md) under "Phase 3 — Translation Layer follow-ups": newsletter capture, /search + Cmd-K, admin needs_review queue (120 posts flagged), RSS feed, per-post editor.

**Status update — per-post editor (items 37 + 38): SHIPPED.**
- **Slice A (backend)** shipped 2026-05-20: schema migration (`scheduledPublishAt` + partial index), service layer at [`lib/posts-admin/`](../../lib/posts-admin/), full admin API surface at [`app/api/admin/posts/`](../../app/api/admin/posts/), scheduled-publisher cron at [`/api/cron/process-scheduled-posts`](../../app/api/cron/process-scheduled-posts/route.ts) (heartbeat row `id='posts-publisher'`), AI-assist routes (regenerate OG + suggest internal links via existing post embeddings), unit tests. See [[2026-05-20-posts-admin-phase-d-backend]].
- **Slice B (UI)** shipped 2026-05-20: `/admin/blog` reshaped into tabbed parent (Settings + Posts) via new layout + sub-nav; list view with filter pills (All | Draft | Scheduled | Published | Needs review | Archived) + URL-driven state + pagination; PostForm with author/category dropdowns, datetime-local schedule picker, split-pane live preview (client-side react-markdown mirroring `PostBody`), AI-assist buttons (regenerate OG, suggest internal links drawer, mark reviewed), optimistic-locking via `expectedUpdatedAt`; revisions page with restore + auto-published tagging. See [[2026-05-20-posts-admin-phase-d-ui]].
- **Deferred to follow-up PRs:** Playwright E2E infrastructure (no existing config to mirror); authenticated visual QA flow via `scripts/screenshot.mjs`.
