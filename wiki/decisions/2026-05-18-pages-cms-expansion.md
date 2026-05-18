---
title: Pages CMS — SCOPE EXPANSION CEO plan
category: decision
created: 2026-05-18
updated: 2026-05-18
related: [[backlog]], [[state]], [[2026-05-08-minimal-admin-for-seo]], [[integration-config]], [[home-page-section-components]], [[about-page-section-components]], [[design-system]]
status: ACTIVE
mode: SCOPE_EXPANSION
---

WordPress-style Pages CMS for Archos Labs, expanded into a full publishing platform. Triggered by the need to publish materially-updated Privacy + Terms copy: Archos Labs is a sole trader under **ABN 18 379 780 858** (Victoria, Australia) — **not** Pty Ltd — but the current hand-coded `/privacy` and `/terms` pages incorrectly call the entity "Archos Labs Pty Ltd, Sydney." The new copy corrects both the entity designation and the jurisdiction. Lifts the "Custom CMS" deferral noted in [[backlog]].

## Why this exists (the load-bearing motivation)

Two converging forces:

1. **Compliance.** The existing `/privacy` and `/terms` pages at [app/privacy/page.tsx](../../app/privacy/page.tsx) and [app/terms/page.tsx](../../app/terms/page.tsx) are hand-coded JSX with legally incorrect copy — wrong company structure, wrong jurisdiction (Sydney vs Victoria), missing data processors (OpenRouter, Google Calendar/Meet), wrong retention rules. The attached corrected copy needs to ship.

2. **Throughput.** Every future marketing page (Consulting overview, audience-specific landings, Modelling Room landing, case studies) currently requires an engineering deploy. The Pages CMS lifts that constraint and turns publishing into Rob's competitive surface.

Building only for compliance = Approach C (minimal CMS). Building for the full throughput vision = SCOPE EXPANSION.

## 10x Vision

A new visitor lands on `archoslabs.xyz/consulting/data-architecture`. Rob wrote that page in 12 minutes — composed from existing `<Hero>`, `<ProofItem>`, `<ServiceCard>`, `<CtaPair>` blocks. The CMS auto-generated the OG card from the Archos brand template. AI drafted the SEO meta description; Rob edited it in one keystroke. Three hours later, admin shows: 47 visitors, 31 scrolled to CTA, 4 clicked to `/ai-readiness-assessment`, 1 booked a call.

## Platonic ideal

The best version isn't a CMS — it's **a publishing platform where the design system *is* the content language**.

Three principles compound:

1. **Composition over content.** Pages are assemblages of section blocks (the components already shipped in [[home-page-section-components]] and [[about-page-section-components]]), not walls of markdown. Every page looks like archoslabs.xyz because every block IS archoslabs.xyz.
2. **AI as co-author, not author.** Reuses the existing OpenRouter integration. Rob is in the loop on every word.
3. **Closed-loop measurement.** Every page tracks scroll, dwell, and CTA-click via the existing `/api/events` infrastructure. Per-page funnel surfaced next to the edit pane.

## Scope Decisions

All 12 original cherry-picks accepted, plus 9 expansion items. Zero deferrals.

| # | Item | Status | Phase |
|---|---|---|---|
| E1  | Schema.org metadata per page | ACCEPT | 1 |
| E2  | OG image override per page | ACCEPT | 3 |
| E3  | Anchor TOC for long pages | ACCEPT | 1 |
| E4  | Scheduled publish | ACCEPT | 6 |
| E5  | `last_reviewed_at` vs `updated_at` | ACCEPT | 1 |
| E6  | Email notification on material change (D9) | ACCEPT | 5 |
| E7  | Revision diff viewer | ACCEPT | 1 |
| E8  | Soft delete (`archived_at`) | ACCEPT | 1 |
| E9  | `og:type` override | ACCEPT | 1 |
| E10 | Page hierarchy (`parent_id`) | ACCEPT | 4 |
| E11 | Markdown footnotes + GFM tables | ACCEPT | 1 |
| E12 | Broken-slug detection + redirects | ACCEPT | 4 |
| X1  | Section blocks from design system | ACCEPT | 2 |
| X2  | AI authoring via OpenRouter | ACCEPT | 3 |
| X3  | Internal link graph + auto-redirect | ACCEPT | 4 |
| X4  | Per-page scroll + CTA analytics | ACCEPT | 5 |
| X5  | Audience variants via `?utm_audience=` | ACCEPT | 4 |
| X6  | OG card auto-generation (Puppeteer) | ACCEPT | 3 |
| X7  | Magic-link external review | ACCEPT | 5 |
| X8  | Reusable transcluded blocks | ACCEPT | 6 |
| X9  | Internal-link hover previews | ACCEPT | 6 |

## Phasing

Six PRs, each independently shippable. Phase 1 ships the compliance fix (corrected legal copy live).

| Phase | Scope | Effort (human / CC) | Ships | Status |
|---|---|---|---|---|
| 1 | Core CMS + Privacy/Terms cutover | 4-5 days / ~5h | Corrected legal copy live; CMS operational for long-form pages | ✅ shipped 2026-05-18 (PR #58) |
| 2 | Section blocks (X1) | 3-4 days / ~5h | Block registry + 5 block types; admin composer; `/phase-2-test` test page | ✅ shipped 2026-05-18 (feature/pages-cms-phase-2) |
| 3 | AI authoring + OG auto-gen (X2 + X6) | 2-3 days / ~4h | Per-page writing time drops to ~20 min | open |
| 4 | Hierarchy + audience variants + redirects (E10 + X5 + X3) | 3-4 days / ~4h | `/consulting/data-architecture` works; audience-aware copy | open |
| 5 | Analytics + change notification + external review (X4 + E6 + X7) | 3 days / ~4h | Closed-loop measurement; compliance workflow; lawyer-readable links | open |
| 6 | Reusable blocks + hover previews + scheduled publish (X8 + X9 + E4) | 2-3 days / ~3h | DRY content; editorial calendar | open |

## Schema (Phase-gated)

### Phase 1 tables

- `page` — id, slug, parent_id (NULL in Phase 1), title, content_md, excerpt, seo_title, seo_description, template, status, og_type, og_image_url, last_reviewed_at, archived_at, published_at, created_at, updated_at
- `page_revision` — id, page_id (FK CASCADE), title, content_md, seo_title, seo_description, diff_size_pct, saved_by, saved_at

Indexes: unique on (parent_id, slug), status+published_at, archived_at partial, parent_id FK, page_revision (page_id, saved_at DESC).

### Phase 2+ schema additions

- `page_block` (X1) — id, page_id (FK CASCADE), block_type, position, props jsonb, transclude_id FK
- `reusable_block` (X8) — id, name UNIQUE, block_type, props jsonb
- `page_redirect` (X3) — id, from_path UNIQUE, to_page_id FK CASCADE, status (301/302)
- `page_review_link` (X7) — id, page_id (FK CASCADE), token_hash UNIQUE, reviewer_label, expires_at, consumed_at, revoked_at
- `events.page_id` (X4) — extends existing analytics table; no new table

All tables follow CLAUDE.md DB Standards: 2NF, snake_case, UUID PK, created_at + updated_at on mutable rows, every FK indexed, no abbreviations.

## Architecture

### Catch-all routing with hierarchy

`app/[...slug]/page.tsx` resolves the slug array against the `page.parent_id` chain. Reserved-slug guard runs first. Redirects checked before resolution. Audience rules applied at the block prop layer.

### Block registry pattern

A single `BLOCK_REGISTRY` map in `components/pages/block-registry.tsx` ties each block_type to a React component + Zod schema. Adding a block_type is a 3-line change. The CMS extends as the design system extends.

### Render pipeline

```
  GET /consulting/data-architecture
        │
        ▼
  resolveSlugPath(['consulting','data-architecture'])
    → checks redirects → walks hierarchy → applies audience rules
        │
        ▼
  template == 'long_form' ?  ─ yes →  <MarkdownArticle>
        │
        no
        ▼
  getBlocks(page_id) ORDER BY position
    → render each via BLOCK_REGISTRY[block_type]
    → transclude resolves at render
```

## Decisions resolved now (so implementation can stay heads-down)

| Topic | Decision |
|---|---|
| Reserved-slug enforcement | Three layers: Zod refinement at admin save, DB CHECK constraint, boot-time assertion in `lib/pages/resolver.ts` |
| Markdown plugins | `remark-gfm` only (tables, footnotes). NO `rehype-raw`. Custom link renderer for `rel="noopener noreferrer"` |
| Block prop validation | Zod schema per block_type, validated at admin save AND at render (defense in depth) |
| Page templates | `long_form` (content_md only) and `composed` (blocks only) are mutually exclusive per page. No mixing. |
| Slug uniqueness | Per-parent. `/consulting/data-architecture` and `/tools/data-architecture` coexist. Top-level uses sentinel parent UUID for the unique constraint. |
| Redirects on rename | Auto-created by default; admin can delete in redirects view |
| Audience cookie | `archos_audience` 30-day TTL, sameSite=lax, httpOnly=false (needs client read). Documented in Privacy. Cleared on lead sign-out. |
| AI cost ceiling | Per-action cost captured in `cms_ai_usage` audit table. Daily cap configurable in `site_setting`. |
| Redirect-loop guard | Cap at 3 hops, then 404 |
| Transclusion depth | Cap at 1 (reusable_block cannot transclude another reusable_block) |

## Cutover plan (Phase 1)

1. Migration: create `page` + `page_revision` (additive, zero downtime). Use `drizzle-kit generate` + `postgres-js` applier — `drizzle-kit push` hangs on Render per [[2026-05-08-drizzle-kit-push-hangs-on-render]].
2. Deploy backend (`lib/pages/`, `/api/admin/pages/*`) — no UI impact.
3. Deploy admin UI (`/admin/(authed)/pages`) — Rob can CRUD pages.
4. Seed Privacy + Terms with attached copy via admin save. Verify rendered output in staging.
5. Single commit: deploy `app/[...slug]/page.tsx` catch-all AND delete `app/privacy/page.tsx` + `app/terms/page.tsx` together (avoids the route-precedence ambiguity window).
6. Smoke test: `curl https://archoslabs.xyz/privacy | grep "ABN 18 379 780 858"`.

Rollback: revert the cutover commit (~3 min via Render). Feature flag `pages_cms_enabled` in `site_setting` allows toggling catch-all off without redeploy.

## NOT in scope (this plan)

- Multi-author admin / authorship attribution — single-admin model continues
- Full A/B testing (variant traffic split + significance) — X5 audience variants is the simpler subset
- Blog posts as a distinct content type — `tags: ['modelling-room']` covers 90%
- WYSIWYG rich-text editor — markdown + blocks IS the editor
- Real-time collaborative editing — single editor, last-write-wins
- Page-level access control (gated content) — future direction

## Security posture (delta from minimal)

- Block-props injection blocked by per-block Zod schemas at save + render
- Transclusion is one-way + depth-capped (no cycles)
- OG card Puppeteer renders only from internal URL — no user-supplied URL fetched (same constraint as PDF pipeline)
- AI prompts wrap user content in delimiters; output is plain text inserted into editor (not executed)
- Magic-link reviewers read-only; token hash storage matches [[magic-link-sign-in]] pattern

## Reuses (existing infrastructure)

- Admin auth shell `app/admin/(authed)/`
- `site_setting` save/load pattern → admin UI shape for `/admin/(authed)/pages`
- `magic_link_token` shape → `page_review_link`
- `integration_secret_audit` immutable-audit pattern → `page_revision`
- `scheduled_job` cron infrastructure → scheduled publish (E4)
- Puppeteer PDF pipeline ([[2026-05-13-puppeteer-on-render]]) → OG card auto-generation
- `/api/events` analytics-client → per-page scroll + CTA tracking (X4)
- OpenRouter integration ([[integration-config]]) → AI authoring (X2)
- Section components ([[home-page-section-components]], [[about-page-section-components]]) → block registry palette

## Backlog impact

- Item 13 (Privacy + Terms pages) — was marked shipped in [[shipped]]; this plan revises that line to "Privacy + Terms CMS-managed pages with corrected legal copy"
- "Custom CMS" line in [[backlog]] — superseded by this decision

## Open follow-ups (after Phase 6)

- Multi-author admin (when there's a second admin)
- Full A/B testing platform (when audience variants stop being enough)
- Dedicated blog content type (when Modelling Room outgrows tag-based pages)
- LinkedIn newsletter API push (currently manual copy-paste via D11)
- Page-level gated content / lead-only pages

## Status

ACTIVE — Phase 1 ready to enter `/plan-eng-review` for architecture deep-dive and test plan.
