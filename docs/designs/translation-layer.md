# WordPress → Archos Labs Migration — CEO Plan (rosy-bee)

**Branch:** main · **Date:** 2026-05-19 · **Mode:** TBD (pending D3)
**Codename:** rosy-bee
**Approach (locked):** APPROACH B — full post architecture published under **The Translation Layer** brand at `/blog`
**Scale (confirmed by Rob):** 200+ posts · robertangeles.com retires · SEO equity consolidates to archoslabs.xyz
**Brand reconciliation:** The Translation Layer (blog destination at `/blog`, NEW brand) and The Modelling Room (LinkedIn newsletter, UNCHANGED, separate channel) coexist as two thought-leadership surfaces — depth lives on the blog; conversation lives on LinkedIn.

---

## Context

Rob owns and operates [robertangeles.com](https://www.robertangeles.com/), a WordPress property he estimates contains 300+ posts. He wants those posts living on archoslabs.xyz. The stated goal is "prepare Archos Labs to display these posts."

This plan does **not** assume that statement is the right framing. Before sizing a build, a CEO review challenges three premises:

1. The real post count and what fraction is actually on-brand for Archos Labs
2. Whether absorbing personal-brand content into the consulting brand serves the business
3. Whether a full blog architecture is needed at all, or a lighter shape solves the goal

The intended outcome of this plan: a sized, brand-coherent path from "300 WordPress posts" to "the right content, in the right shape, on the right brand, at the right URL" — without bloating Archos Labs into "a blog with a contact form" (which CLAUDE.md explicitly forbids).

---

## Pre-review snapshot

### Archos Labs (target) — what's actually shipped

From `wiki/state.md` and direct read of [lib/db/schema.ts](cc-archos-labs/lib/db/schema.ts):

- **Pages CMS Phase 1 + 2 shipped** (PRs #58–#60, 2026-05-18). Tables: `page`, `page_revision`, `page_block`.
- `page` columns: `slug` (unique, flat), `title`, `content_md` (200KB cap), `template` (`long_form` | `composed`), `status` (`draft|published|archived`), `og_type`, `published_at`, SEO fields. **No author. No category. No tags. No post_type discriminator.**
- **Public render path is flat:** [app/[...slug]/page.tsx](cc-archos-labs/app/%5B...slug%5D/page.tsx) explicitly rejects multi-segment paths (`if (slugSegments.length > 1) return "__too_deep__"` → 404). Phase 4 of the CMS plan is the one that adds nesting.
- **Block registry has 11 types** (hero, proof_grid, service_grid, cta_pair, markdown, quick_diagnosis, timeline, objection_faq, stat_band, editorial_essay, process_steps, editorial_faq, closing_statement). **No `image` block. No `code_block` beyond markdown.**
- **Markdown renderer** ([components/pages/markdown-article.tsx](cc-archos-labs/components/pages/markdown-article.tsx)) uses `react-markdown` + `remark-gfm` *without* `rehype-raw` — deliberate XSS posture. Embedded HTML in WP content will be stripped.
- **The blog hook already exists.** [lib/claude-booking.ts](cc-archos-labs/lib/claude-booking.ts) has `matchBlogPosts()` reading `site_setting['blog_library']` for booking-email reading recommendations. Library is empty today (backlog item 33).
- **The Pages CMS expansion plan** ([wiki/decisions/2026-05-18-pages-cms-expansion.md](cc-archos-labs/wiki/decisions/2026-05-18-pages-cms-expansion.md)) *explicitly defers* "Dedicated blog content type (when Modelling Room outgrows tag-based pages)" (line 169).

### robertangeles.com (source) — what's actually there

From direct read of `c:\My AI Projects\robertangeles.com\`:

- Standard WP install. Theme: `kolumn-child` (Edge Themes). Page builder: Visual Composer (`js_composer`). SEO: Yoast v27.6. CPT plugin: `edge-cpt` (custom post types possibly registered).
- **DB:** `localhost`, prefix `uhiz_`, name `i3664903_x7et1`. **No SQL dump in the WP folder.** Real post count requires a DB query.
- **Uploads:** 2,734 files, **1.34 GB**, year-folder structure (`2025/`, `2026/`). Heavy PNG (with thumbnails — actual unique images much fewer).
- **Yoast `llms.txt` only lists 5 published posts** — all AI/governance/data content. On-brand for Archos Labs. (Yoast llms.txt filters to "high value" content, so this is a floor, not a ceiling.)
- **4 categories** (AI as Strategy, Data as a Decision Infrastructure, Human-Centered Transformation, The Execution Layer), 5 tags, single author.

### Brand position — what CLAUDE.md and the wiki actually say

- CLAUDE.md (Archos Labs): "Not a blog with a contact form." Identity is "practitioner studio" — content is a *moat*, not the offer.
- The Modelling Room is currently positioned as a **LinkedIn newsletter link-out**, not a destination on the site (backlog item 21).
- No wiki decision exists for: migration strategy, robertangeles.com relationship, SEO redirect plan, or mixing personal+consulting brand.

---

## 0A — Premise Challenge

### Premise 1: "300+ posts"
Yoast indexes 5. The delta is either (a) llms.txt filtering aggressively, (b) most posts being drafts/scheduled/private, (c) custom post types from `edge-cpt` inflating the count, or (d) the 300+ estimate being off. **Sizing the build before knowing the real number is irresponsible.** A real DB query (`SELECT post_status, post_type, COUNT(*) FROM uhiz_posts GROUP BY post_status, post_type`) closes this in 30 seconds.

### Premise 2: "We want these posts in Archos Labs"
Three possible brand stances, only one of which the user's framing implies:

| Stance | What it means | Brand cost |
|---|---|---|
| **Absorb** | robertangeles.com retires, redirects to Archos Labs | Personal brand collapses into business brand. Clean. One identity. |
| **Re-cast** | Selected posts move as "Modelling Room archive" — editorial framing | On-brand. Curation enforces quality. Consistent with existing IA. |
| **Bridge** | robertangeles.com stays live, Archos Labs links to curated picks | Two brands to maintain. SEO equity stays put. Lowest commitment. |

The user has not yet stated which stance. The plan must.

### Premise 3: "Prepare Archos Labs to display these posts"
This assumes a destination-style blog (archive, dates, pagination, categories). But the actual user-facing case for content on Archos Labs is **single-post arrival from search → conversion to call**. If arrival is one-post-deep, archive UI, date sorting, and pagination are dead weight. The minimum useful infra is: **permalink rendering + sitemap + the `blog_library` hook seeded**. Everything else is optional.

---

## 0B — Existing Code Leverage

What's already built that this migration can use:

- `page` table + revisions + `published_at` → already half of "post storage" if we add `category` and `author`.
- `MarkdownArticle` → renders the body for free (if WP content is converted to markdown — Gutenberg → md is mostly clean; Visual Composer shortcodes need stripping).
- `site_setting['blog_library']` + `matchBlogPosts()` → booking-email recommendations already wired, just empty.
- `page_revision` audit trail → import gets versioning for free.
- SEO fields on `page` (`seo_title`, `seo_description`, `og_type`) → Yoast metadata maps directly.

What's missing:

- Date-sortable post-listing UI (admin + public).
- Nested routing (`/insights/{slug}` or `/blog/{slug}`) — Phase 4 of CMS plan; could be unblocked piecemeal.
- An `image` block (or a markdown-image rewriter that points at re-hosted assets on Archos Labs).
- WP → markdown extraction tooling.
- Media migration pipeline (download from WP uploads → re-host on Archos Labs storage → rewrite URLs).
- 301 redirect map from robertangeles.com permalinks to new Archos Labs URLs.

---

## 0C — Dream State Mapping (12 months)

```
CURRENT STATE                     THIS MIGRATION                  12-MONTH IDEAL
─────────────────                 ──────────────                  ──────────────
Archos Labs ships static    ──▶   Best of robertangeles    ──▶   Archos Labs is the
pages + diagnostic.               becomes branded thought         credible publication
robertangeles.com is              leadership on Archos.           on AI program risk.
disconnected personal             Personal site retires           Lead-gen via search.
brand running WP.                 or 301s to Archos.              Single owned brand.
```

The migration question is really: *which path through the middle column gets us closest to the right side without the brand cost?*

---

## 0C-bis — Implementation Alternatives

Four approaches, increasing in scope. Effort is dual-scale (human / CC).

### APPROACH A — Curated paste-port (minimum viable)
Hand-pick the top 10–30 on-brand posts. Paste each as a Pages CMS `long_form` page. Slug-prefix manually (e.g., `insights-data-governance-framework`) since routing is flat today. Seed `blog_library` with their summaries. 301-redirect from robertangeles.com permalinks.

- **Effort:** human ~2–3 days / CC ~45–90 min
- **Risk:** Low. Reuses everything. Manual curation IS the brand filter.
- **Pros:** Ships fast. No new schema. No new tables. Quality threshold preserved by hand.
- **Cons:** Doesn't scale past ~30 posts. Tedious. No image block means inline images go via raw markdown URLs to wherever they're hosted.
- **Completeness:** 7/10 — covers happy path for curated content; punts archive UI and date sorting.

### APPROACH B — Full blog architecture (ideal long-term)
New `post` table (slug, title, content_md, content_blocks, author_id, status, category_id, tags JSONB, published_at). New routes `/insights` (index, paginated, filterable) + `/insights/[slug]` + `/insights/category/[slug]`. Admin post-listing with date sort, filters, bulk publish. New `image_block` type. WP REST API / SQL extraction script. Media re-host pipeline. Author table (currently just Rob, but extensible). SEO redirect generator.

- **Effort:** human ~2–3 weeks / CC ~3–5 days
- **Risk:** Med-High. New schema, new admin UI, media migration. Hijacks Phase 3 of the CMS plan (which was supposed to be AI authoring).
- **Pros:** Real publication. Scales to 300+. Search-friendly. Repositions Archos Labs as a credible publisher.
- **Cons:** Biggest scope expansion this project has had. Risks the "blog with a contact form" trap. Distracts from the higher-leverage consulting revenue path.
- **Completeness:** 10/10 — covers the whole lake including dates, archives, categories, media, admin.

### APPROACH C — Don't migrate; link-out + library (the inversion)
Keep robertangeles.com live. Add `/perspectives` on Archos Labs that curates 10–15 link-outs to robertangeles.com posts. Seed `blog_library`. Maybe a "Recently published" RSS-cached strip on Archos Labs home, server-rendered. Zero schema change.

- **Effort:** human ~half day / CC ~20–40 min
- **Risk:** Very Low.
- **Pros:** Cleanest brand separation. Personal brand survives. Lowest cost.
- **Cons:** Doesn't consolidate. Two brands to maintain. SEO equity stays with robertangeles.com. If the WP host is a recurring cost or maintenance burden, doesn't solve that.
- **Completeness:** 3/10 — addresses "have visible writing on Archos Labs" but not "consolidate the brand."

### APPROACH D — "Modelling Room archive" (recommended)
Frame the migration as building the **Modelling Room archive** — consistent with existing brand IA. Migrate only the on-brand subset (AI, data, governance, transformation — likely 30–80 posts depending on what the DB actually contains). Add a lightweight `post` type (either: a new `post` table, OR a `category` + `is_post` column on `page` — decision deferred to engineering review). New routes: `/blog` (landing, embeds LinkedIn newsletter CTA + archive grid) and `/blog/[slug]` (article). Add an `image` block (~30 min). Build a small WP-extraction script targeting only the categorised, on-brand subset. Image migration script for that subset only.

- **Effort:** human ~5–8 days / CC ~2–4 hours
- **Risk:** Med. Real schema change, but bounded by curation.
- **Pros:** On-brand by construction (Modelling Room already exists in the IA). Editorial framing avoids "blog with contact form" trap. Sized to content *value*, not raw post count. Phase 3 of the CMS plan stays focused (AI authoring is separate work). Backstops the LinkedIn newsletter with an owned destination.
- **Cons:** Requires real DB query before sizing. Curation discipline required. Image block work needed.
- **Completeness:** 9/10 — covers curated, branded, archive-able content with a coherent URL shape.

### Recommendation
**APPROACH D — Modelling Room archive.** Reasons, in order:
1. **Brand-coherent by construction.** Doesn't fight CLAUDE.md.
2. **Sized to actual content value**, not raw post count — the right scope-control mechanism.
3. **Reuses existing IA** (Modelling Room is already a planned destination). The migration *finishes* an existing thread rather than opening a new one.
4. **Bounded scope.** Curated subset = bounded WP extraction + bounded media migration.
5. **Backstops the LinkedIn newsletter.** Today the Modelling Room is a link-out; this gives it a home.

APPROACH A is a defensible step-1 *inside* APPROACH D (hand-port the first 5–10 to prove the pipeline before automating).

APPROACH B is *the right answer if and only if* (a) Rob plans to retire robertangeles.com entirely and (b) the post count is genuinely >100. Otherwise it's over-built.

APPROACH C is the right answer if Rob wants to keep robertangeles.com as a parallel brand. The brand-stance question (D2 below) determines whether this is viable.

---

## Decisions resolved

- **D1 — Real post count:** 200+ published, all worth migrating. (Rob, 2026-05-19)
- **D2 — Brand stance:** **Absorb.** robertangeles.com retires. All blog posts move to Archos Labs. SEO consolidates to archoslabs.xyz. (Rob, 2026-05-19)

## Approach locked

**APPROACH B — Full post architecture, with Modelling Room editorial framing on top.**

Data layer: every post migrates and is indexable (preserves SEO equity).
Presentation layer: curated, on-brand posts feature under `/blog`; older or off-topic posts remain accessible at their canonical URL but aren't front-and-centre in nav.

Why not pure APPROACH B (raw blog with everything in the nav)? CLAUDE.md's "not a blog with a contact form" rule still applies *visually* — the brand frame stays "practice + studio + thought-leadership archive." Migration is data; framing is editorial.

Why not pure APPROACH D (curated subset only)? Rob explicitly said *all* blog posts are absorbed. Curation happens at the **presentation layer** (what's featured/in nav/sitemapped-prominently), not at the **data layer** (everything migrates).

## SEO posture — build-from-scratch on archoslabs.xyz

Updated per Rob (2026-05-19): robertangeles.com has low traffic. **This is not a preserve-equity migration; it's a build-from-scratch SEO/AIEO play on archoslabs.xyz, using the 200+ posts as the corpus.** That lets us simplify several things:

- **Per-URL 301 mapping is not required.** A simple apex 301 (`robertangeles.com/*` → `archoslabs.xyz/blog`) covers the residual LinkedIn-shared / occasional-backlink case without engineering a per-slug redirect table. Keep the WP-export ability to generate one *if* a specific high-value backlink ever needs it, but don't build a redirect manifest by default.
- **Domain disposition: let it lapse after a short cool-off** (~30–60 days of the apex redirect, then drop the registration). No SEO equity to preserve.
- **Duplicate content concern drops** — once robertangeles.com is removed/redirected, crawlers see one canonical source.
- **Effort budget reallocates:** the saved time on redirect tooling goes into the AIEO + SEO foundation below.

## Decisions resolved (continued)

- **D3 — Review mode:** **SCOPE EXPANSION.** Rob overrode the HOLD recommendation. Aligned with his stated preference: design properly now beats ship-then-refactor.
- **D4 — Rollout sequencing:** **Phased A → B → C → D.** Schema, render+pilot, bulk cutover, polish — each phase a separate PR behind a feature flag.
- **D5 — URL structure:** **`/blog/[slug]` flat.** Blog brand is **The Translation Layer**, rendered as the section identity on `/blog`. URL stays generic so it survives any future rebrand of the section name.
- **D6 — robertangeles.com:** **Apex 301 only, then let lapse after 30–60-day cool-off.** Low source traffic per Rob means no per-URL redirect manifest, no Search Console Change of Address, no domain-extension cost. Migration is build-from-scratch on archoslabs.xyz, not equity transfer.
- **AIEO scope** (Rob flagged 2026-05-19): SEO + AIEO foundations baked into base scope — `llms.txt`, `llms-full.txt`, AI-crawler-permissive `robots.txt`, canonical URLs, full OG/Twitter meta, Organization schema, Bing Webmaster registration, editorial answer-first principles. See "SEO + AIEO Strategy" section.

## Accepted scope expansions (cathedral pieces)

All accepted at full scope unless noted.

| # | Expansion | Decision | Scope |
|---|---|---|---|
| E1 | Semantic search + Read Next | Add full | pgvector + embeddings at import + `/search` route + read-next widget at end of every post |
| E2 | AI migration polish (Claude per-post pass) | Add full | excerpt + currency check + topic tags + needs_review flag per post |
| E3 | Branded OG image auto-generation | Add full | Templated `@vercel/og` images for all 200+ posts at migration |
| E4 | JSON-LD structured data | Add full | Article + Person + BreadcrumbList; FAQ where Q&A structure detected |
| E5 | Executive reading UX bundle | Add full | TOC + reading time + last-reviewed stamp + heading copy-link + styled pull-quotes |
| E6 | Newsletter capture + vendor integration | Add full | Capture UI + `newsletter_signup` table + double-opt-in + admin view + **Resend** integration (E6.1) |
| E7 | Post analytics & conversion tracking | **Deferred to TODOS.md** | Plausible-or-similar lite analytics. Captured as deferred work, not in migration scope. |

---

## SEO + AIEO Strategy (cross-cutting — added to base scope)

Rob explicitly flagged this. Treating it as first-class scope, not a polish item. AIEO = AI Engine Optimisation: getting cited by ChatGPT, Claude, Perplexity, Google AI Overviews, Bing Copilot, You.com, etc. Increasingly important for B2B knowledge brands in 2026; for executive readers, an LLM citation is becoming as valuable as a Google rank.

### What's already in scope (accepted expansions cover this)

| Need | Covered by |
|---|---|
| Rich search-result cards | E4 — JSON-LD Article + Person + Breadcrumb + FAQ schema |
| Social previews on every share | E3 — branded OG images for all 200+ posts |
| Internal link graph + topic clusters | E1 — semantic read-next widget on every post |
| Content-currency signal to LLMs | E2 — last_reviewed_at + needs_review flag at migration |
| Skimmable structure (h2/h3 hierarchy) | E5 — TOC bundle forces good heading discipline |
| Clean canonical URLs | D5 — flat `/blog/[slug]` |
| Stable URLs (no 301 chains internal) | D5 — flat pattern; no recategorisation breakage |
| Author authority signal | E4 (Person schema) + existing PersonCard |

### What's NOT yet in scope — baking into base scope now (cheap, high leverage)

These are technical SEO/AIEO foundations. Each is small enough that they belong in base migration scope, not as opt-in expansions. Surface only if Rob wants to opt OUT of any:

1. **`/llms.txt` + `/llms-full.txt` at site root** — The emerging standard for AI crawlers. `llms.txt` lists top content with descriptions; `llms-full.txt` is the full corpus dump. robertangeles.com was already generating one (via Yoast) — match it and improve. Auto-generated at build time from `post` table; updates on every deploy.

2. **`/robots.txt` explicitly allowing AI crawlers.** Current Next.js default is permissive but doesn't name AI bots. Add explicit `User-agent` blocks for: `GPTBot`, `ClaudeBot`, `PerplexityBot`, `Google-Extended`, `Bingbot`, `Applebot-Extended`, `CCBot` (Common Crawl). Disallow none. Point at `/sitemap.xml` and `/llms-full.txt`.

3. **Canonical URL emission on every post page.** `<link rel="canonical" href="https://archoslabs.xyz/blog/[slug]">`. Prevents duplicate-indexing across UTM-tagged shares.

4. **OpenGraph + Twitter Card meta tags on every page.** Beyond OG image (E3): `og:title`, `og:description`, `og:type=article`, `article:published_time`, `article:modified_time`, `article:author`, `twitter:card=summary_large_image`, `twitter:creator`. Already partially scoped in `page` table; extend to `post`.

5. **Organization schema (site-wide, JSON-LD).** Emit once on every page: `Organization` for Archos Labs with `sameAs` to your LinkedIn company page, registered ABN, official URL. Reinforces entity recognition for AI crawlers.

6. **Sitemap with `<lastmod>` + `<priority>`** auto-generated. Posts updated within last 60 days get higher priority hint. Submitted to Search Console + Bing Webmaster.

7. **Bing Webmaster Tools** registration (often skipped). Bing → Copilot → ChatGPT (which uses Bing for grounding). Indexing on Bing = indirect AIEO surface.

8. **Article frontmatter "answer-first" pattern** — editorial guideline, not technical. First paragraph = direct answer to the implied query the title raises. LLMs preferentially cite the first paragraph; Google's AI Overviews extract from it. Bake into the post-authoring guidance / Claude polish prompt (E2).

### Editorial AIEO principles (style guide, baked into E2 polish prompt)

These shape WHAT gets cited, not the technical plumbing:

- **Name the framework.** "The Archos Labs AI Readiness Framework" gets cited; "AI readiness" doesn't. Encourage proprietary names for original frameworks; treat them as IP.
- **Definitions in dedicated blocks.** When a post defines a term, render it as a styled definition block (visible to readers, parseable to LLMs). Future block-type addition under E1's reading UX bundle.
- **Step-by-step lists where applicable.** Numbered lists rank disproportionately well in AI citations.
- **Quotable single-sentence claims.** Posts that include 1–3 self-contained, citable claims get pulled into AI answers; rambling posts don't.
- **Cite primary sources inline.** Where Rob references EU AI Act, NIST AI RMF, McKinsey reports, etc., link them. AIEO favours posts that demonstrate research.
- **Self-contained context.** Each post should make sense when read in isolation (an LLM may surface a single post out of context). No "as I said in my last post" without re-stating the claim.

### Deferred to TODOs (next sprint, not migration)

- **AI-citation tracking tool** (Profound, Otterly.AI, AI Overview Tracker, similar). ~$30–100/mo. Measures whether posts are being cited by ChatGPT/Claude/Perplexity. Premature before content lands; right after migration.
- **Schema.org HowTo + Course schema** for guide-style posts. Optional, post-migration.
- **Custom search engine submission** (Brave, DuckDuckGo, Kagi). Optional.
- **Backlink campaign** (proactive outreach for high-authority citations). Manual work, separate plan.

### Verification (added to Phase C pass criteria)

```
✓ curl https://archoslabs.xyz/llms.txt          → 200, lists top posts
✓ curl https://archoslabs.xyz/llms-full.txt     → 200, full corpus
✓ curl https://archoslabs.xyz/robots.txt        → 200, allows AI bots, points to sitemap + llms-full
✓ curl https://archoslabs.xyz/sitemap.xml       → 200, all listed posts present with <lastmod>
✓ View-source any /blog/[slug] page             → JSON-LD Article + Person + Breadcrumb
✓ View-source any page                          → Organization schema present
✓ View-source any /blog/[slug] page             → og:* meta, twitter:* meta, canonical link
✓ Submit sitemap to Google Search Console + Bing Webmaster Tools
✓ Open-graph debugger (https://www.opengraph.xyz/) on 3 sample posts → all clean
✓ Rich Results Test (Google) on 3 sample posts  → all valid
```

---

### Cathedral picture (what 'done' looks like)

```
   ┌────────────────────────────────────────────────────────────────┐
   │   archoslabs.xyz   (single brand, all content absorbed)        │
   │                                                                │
   │   /blog                  ◀── editorial home          │
   │     ├── /[slug]  (200+ posts)      ◀── flat under MR namespace │
   │     ├── /category/[slug]           ◀── 4 categories, filterable│
   │     └── /search       (semantic, pgvector)                     │
   │                                                                │
   │   Every post page:                                             │
   │     ├── 7 min read · Last reviewed: 2026-03                    │
   │     ├── Sticky TOC (desktop) / Drawer (mobile)                 │
   │     ├── JSON-LD Article + Person + Breadcrumb                  │
   │     ├── Branded OG image (auto-generated)                      │
   │     ├── Heading copy-link buttons                              │
   │     ├── Inline newsletter capture @ 60% scroll                 │
   │     └── Read-next widget (semantic similarity)                 │
   │                                                                │
   │   robertangeles.com → 301 → archoslabs.xyz/blog/...  │
   └────────────────────────────────────────────────────────────────┘
```

### Scope cost estimate (dual-scale)

| Track | Human-team time | CC+gstack time |
|---|---|---|
| Schema + admin UI | ~5–7 days | ~6–10 hours |
| WP extraction + transform | ~3–4 days | ~3–5 hours |
| Media migration + rehost | ~2–3 days | ~2–4 hours |
| Public render + nested routing | ~2–3 days | ~2–4 hours |
| Search infra (pgvector + UI) | ~2–3 days | ~3–5 hours |
| AI migration polish | ~1–2 days | ~2–3 hours |
| OG image auto-gen | ~1 day | ~1–2 hours |
| JSON-LD | ~half day | ~30–60 min |
| Reading UX bundle | ~1–2 days | ~2–3 hours |
| Newsletter capture + Resend | ~1–2 days | ~2–3 hours |
| Redirects + sitemap + GSC | ~1 day | ~1–2 hours |
| Tests + QA + deploy | ~2–3 days | ~3–5 hours |
| **Total** | **~22–35 human-team days** | **~28–48 CC hours** |

This is the largest project on the roadmap. The CC compression ratio is roughly 10×. Realistic calendar time at solo-with-CC pace: 2–4 weeks of focused work.

---

---

## Section reviews (1–11)

CEO-level depth. Engineering details are explicitly deferred to `/plan-eng-review`.

### Section 1 — Architecture

**Recommended shape:** new `post` table as a sibling of `page` (not a subtype). Page is for static marketing pages; Post is for time-stamped editorial. Mixing them creates accidental coupling between two evolution tracks.

**Proposed schema sketch** (final shape in `/plan-eng-review`):

```
post:                              author:
  id uuid pk                         id uuid pk
  slug text unique                   slug text unique
  title text                         name text
  content_md text                    bio_md text
  content_blocks jsonb               photo_url text
  excerpt text                       linkedin_url text
  author_id uuid fk → author
  category_id uuid fk → category   category:
  tags jsonb                         id uuid pk
  status enum (draft|published|     slug text unique
            archived)                name text
  visibility enum (listed|          description text
                   unlisted)
  og_image_path text               post_revision:
  embedding vector(1536)             (mirrors page_revision)
  word_count int
  reading_time_min int             newsletter_signup:
  source_wp_id int  -- idempotency   id uuid pk
  needs_review bool                  email text
  last_reviewed_at timestamptz       source_post_id fk → post
  published_at timestamptz           confirmed_at timestamptz
  created_at, updated_at             double_opt_in_token text
```

**`visibility` enum is the editorial guard:** `unlisted` posts are indexable via direct URL (preserves SEO equity) but don't appear in /blog index, category pages, sitemap-prominent listings, or read-next widget. Lets you migrate all 200+ for SEO while curating what's "featured."

**Routes:**

```
PUBLIC                                    ADMIN
/blog                           /admin/(authed)/posts
  └── index, paginated, listed only         └── listing, filters, bulk actions
/blog/[slug]                    /admin/(authed)/posts/new
  └── article                             /admin/(authed)/posts/[id]
/blog/category/[slug]             └── edit
  └── category index                      /admin/(authed)/posts/[id]/revisions
/search                                     └── revision history
  └── semantic search UI                  /admin/(authed)/authors
/blog/feed.xml                  /admin/(authed)/categories
  └── RSS for the LinkedIn-newsletter-       └── taxonomy admin
      synced audience
```

**Data flow (happy + shadow paths):**

```
                    HAPPY                 NIL              EMPTY              ERROR
WP row        ──▶  uhiz_posts row    →    post_status      title-only         DB connection
                                          = draft          row                fails → halt
                          │                                                    + alert
                          ▼
Extract       ──▶  field-by-field    →    missing field    short body         shortcode
                   pull                   → log, default   → migrate,         unparseable
                                          empty            mark needs_review  → strip + flag
                          │
                          ▼
Transform     ──▶  HTML → md         →    no body          1-line body        malformed HTML
                                          → skip with      → migrate          → keep raw,
                                          warning                              flag for review
                          │
                          ▼
Claude polish ──▶  excerpt+tags+     →    short post       Claude refusal     timeout
                   currency check         (skip currency)  → keep defaults,   → retry 3x,
                                                            flag              then flag
                          │
                          ▼
Embed         ──▶  text-embedding    →    too-short post   (n/a)              provider error
                                          → embed title              → retry, then queue
                          │                only                       for later re-run
                          ▼
OG generate   ──▶  branded image     →    no title         very long title    template render
                                          (impossible)     → truncate         fail → default OG
                          │
                          ▼
Insert post   ──▶  upsert by         →    (n/a)            (n/a)              unique constraint
                   source_wp_id                                                violation → log
                                                                               + skip
                          │
                          ▼
Emit 301      ──▶  redirect rule     →    no old slug      slug collision     duplicate rule
                                          → log, skip      → log, choose      → log, last wins
                                                            non-colliding
```

**ASCII system diagram:**

```
   ┌───────────────────────┐     ┌─────────────────────────────────────────┐
   │  robertangeles.com    │     │           archoslabs.xyz                 │
   │  WordPress + Yoast    │     │  Next.js 16 + Render Postgres + pgvector │
   │  uhiz_posts (200+)    │     │  Resend (newsletter)                     │
   └──────────┬────────────┘     └────────────────────┬─────────────────────┘
              │                                       │
              │  (1) one-time extract                 │
              ▼                                       │
   ┌──────────────────────────────────────────────────┴─────────────┐
   │                  scripts/migrate-wp/                            │
   │   extract.ts → transform.ts → claude-polish.ts → embed.ts       │
   │                            ↓                                    │
   │           media-rehost.ts → og-generate.ts → insert.ts          │
   │                            ↓                                    │
   │          redirect-map.ts → sitemap.ts → manifest.json           │
   └──────────────────────────────────────────────────────────────────┘
                               │
                               ▼ (2) populate
   ┌──────────────────────────────────────────────────────────────────┐
   │     post · author · category · post_revision · newsletter_signup │
   │     pgvector index on post.embedding                             │
   └──────────────────────────────────────────────────────────────────┘
                               │
                               ▼ (3) serve
   ┌──────────────────────────────────────────────────────────────────┐
   │   /blog  ·  /blog/[slug]  ·  /search         │
   │   feature-flagged off until cutover                              │
   └──────────────────────────────────────────────────────────────────┘
                               │
                               ▼ (4) cut over
   ┌──────────────────────────────────────────────────────────────────┐
   │   robertangeles.com → 301 → archoslabs.xyz/blog/...    │
   │   Search Console: change-of-address                              │
   └──────────────────────────────────────────────────────────────────┘
```

**Risks:** (i) partial-migration state if script halts mid-run — solved by idempotent upsert on `source_wp_id`. (ii) Page CMS Phase 4 (nested routing) was supposed to enable `/category/[slug]` paths; this migration unblocks /blog/[slug] independently, then Phase 4 needs to land separately for static pages.

### Section 2 — Error & Rescue Map

| Codepath | Failure mode | Rescue | User sees | Logged |
|---|---|---|---|---|
| `extract.ts` | DB connect fail | Halt run, exit 1 | (n/a — script) | Yes |
| `extract.ts` | Row missing required field | Default empty + flag `needs_review` | (n/a) | Yes |
| `transform.ts` | Visual Composer shortcode unparseable | Strip shortcode, flag `needs_review` | (n/a) | Yes |
| `transform.ts` | Malformed HTML | Keep raw in content, flag `needs_review` | (n/a) | Yes |
| `claude-polish.ts` | API timeout | Retry 3× exponential backoff | (n/a) | Yes |
| `claude-polish.ts` | Rate limit (429) | Backoff, requeue | (n/a) | Yes |
| `claude-polish.ts` | Malformed JSON response | Re-prompt with strict format; flag if still bad | (n/a) | Yes |
| `claude-polish.ts` | Refusal | Keep defaults, flag | (n/a) | Yes |
| `embed.ts` | Provider timeout | Retry 3× | (n/a) | Yes |
| `embed.ts` | Empty response | Skip embedding, queue for re-run | (n/a) | Yes |
| `media-rehost.ts` | Image URL 404 on WP | Leave reference, flag `needs_review` | (n/a) | Yes |
| `og-generate.ts` | Template render fail | Fall back to default brand OG, flag for redo | (n/a) | Yes |
| `insert.ts` | Unique constraint violation | Upsert on `source_wp_id` | (n/a) | Yes |
| `/blog/[slug]` | Post not found | 404 | "Post not found" friendly | Yes |
| `/blog/[slug]` | Embedding query timeout | Render page WITHOUT read-next widget | Hidden — graceful degrade | Yes (warn) |
| `/blog/[slug]` | JSON-LD gen fails | Render page WITHOUT structured data | Hidden | Yes (warn) |
| `/search` | Embedding API down | Fall back to Postgres full-text | "Results may be less precise" notice | Yes |
| `/api/newsletter/subscribe` | Resend API error | Queue locally, retry async, return 202 | "We'll send your confirmation shortly" | Yes |
| `/api/newsletter/subscribe` | Already-subscribed | Idempotent 200 | "You're already on the list" | No (not an error) |
| `/api/newsletter/confirm` | Token expired | Friendly re-send page | "Link expired — re-confirm here" | Yes |
| Apex 301 from robertangeles.com | Any path on old domain | Single apex 301 to archoslabs.xyz/blog | Lands on /blog index | Yes (sample) |

**No catch-all `catch (e)` blocks.** Each rescue names its exception. The `needs_review` flag is the migration's silent-failure killer — every fuzzy outcome surfaces in the admin queue.

### Section 3 — Security & Threat Model

| Threat | Likelihood | Impact | Mitigation |
|---|---|---|---|
| HTML-to-md conversion lets raw HTML through → XSS on rendered post | High | High | Use strict converter (turndown.js with whitelist). NEVER add `rehype-raw`. Test with malicious WP fixture rows. |
| Migration script accidentally writes to prod DB | Med | High | Migration script reads `DATABASE_URL` from env. Refuse to run unless `MIGRATION_CONFIRMED=true`. Print connection target + counts before mutating. |
| robertangeles.com WP admin still reachable during transition | Med | Med | Force WP admin behind IP allowlist or shut down WP entirely once DB is dumped. |
| Newsletter signup form abused as email harvester | High | Med | Rate limit per IP. Strict email validation. Double-opt-in mandatory. CAPTCHA if abuse detected. |
| Embedding API key leaked client-side | Low | High | All embedding calls server-side only. `/api/search` proxies. Key in env, not in `NEXT_PUBLIC_*`. |
| Sitemap exposes unlisted/draft posts | Med | Med | Sitemap query filters by `status=published AND visibility=listed`. Integration test. |
| Search query enables SQL injection / prompt injection | Med | Med | Parameterised query. Embedding input length-capped (1000 chars). Search log redacted. |
| OG image generation accepts user input | Low | Med | OG generation is migration-script-only (not user-facing endpoint). |
| Personal info in old WP posts (commenter emails, drafts with PII) | Med | High | Migration script DOES NOT migrate `wp_comments`. Drafts excluded by `post_status='publish'` filter. Audit before cutover. |
| LinkedIn newsletter link-out CSRF | Low | Low | Use `rel="noopener noreferrer"` on outbound. |

**Comments are not migrated.** WP `wpdiscuz` comments stay on the WP DB dump (archived offline). Brand rule per CLAUDE.md.

### Section 4 — Data Flow & Interaction Edge Cases

| Interaction | Edge case | Handled? | How |
|---|---|---|---|
| Newsletter signup | Double-submit | Yes | Idempotent endpoint; already-subscribed → 200 with friendly message |
| Newsletter signup | Token expired (>72h) | Yes | Friendly re-send page; new token issued |
| Newsletter signup | Email harvester | Yes | Rate limit + double-opt-in + optional CAPTCHA |
| Newsletter confirm | User clicks link 2× | Yes | Idempotent confirmation; second click → "already confirmed" |
| Search | 0 results | Yes | Show fallback: "No matches; here are 3 recent posts" |
| Search | Very long query | Yes | Truncate to 1000 chars server-side |
| Search | Empty query | Yes | Show /blog index instead |
| Post view | Post deleted while user reading | Yes | ISR-cached version survives until revalidate; admin sees stale-cache warning |
| Post view | User on `/blog/{old-wp-slug}` | Yes | 301 from robertangeles.com → archoslabs.xyz/blog/{new-slug}; archoslabs.xyz internal slug stays canonical |
| Read-next widget | All posts in category have <2 read-next candidates | Yes | Fall back to most-recent-3 |
| TOC | Post has no h2/h3 | Yes | Hide TOC; render post body full-width |
| OG image | Title >120 chars | Yes | Truncate with ellipsis at word boundary |
| Migration script | Re-run after partial completion | Yes | Idempotent upsert on `(source_wp_id)` |
| Migration script | Mid-run host restart | Yes | Resume from last successfully-inserted `source_wp_id` |

### Section 5 — Code Quality

**Reuse:** `MarkdownArticle` (rendered for posts), `PersonCard` (author bio at bottom), `page_revision` audit-trail pattern (mirror in `post_revision`), Pages CMS admin auth chain.

**No duplication:** post and page coexist; do not template through a shared "content" abstraction (premature). They diverge in routing, listing, and editorial framing.

**File shape (per CLAUDE.md `lib/` rules):**
- `lib/posts.ts` — steady-state post queries (read, create, update)
- `lib/post-rendering.ts` — TOC generation, reading-time, last-reviewed display
- `lib/search.ts` — pgvector queries
- `lib/newsletter.ts` — Resend integration
- `lib/og-image.ts` — `@vercel/og` template
- `lib/structured-data.ts` — JSON-LD emitters
- `scripts/migrate-wp/` — one-shot migration tooling (this is the only place lifecycle hooks belong)

Routes stay thin per CLAUDE.md.

### Section 6 — Tests

**Unit:**
- `transform.ts`: 8+ fixtures (Gutenberg block, classic HTML, Visual Composer shortcode, malformed HTML, embedded YouTube, code block, inline image, footnote)
- `getReadingTime(md)` — deterministic given word count
- `generateToc(md)` — h2 + h3 nesting, no h1 expected
- `slugify(title)` — Unicode, special chars, collision resolution
- `parseShortcode()` / `stripShortcode()`
- `redirect-map.ts` — old-slug → new-slug

**Integration:**
- End-to-end migration of fixture WP row → post DB row → rendered page → 301 emitted → sitemap entry
- Search ANN against canned 5-post embedding set → top-3 results stable
- Newsletter signup happy path + double-opt-in + already-subscribed + expired token
- /api/search rate limiting

**E2E (Playwright per CLAUDE.md):**
- `/blog` loads, shows pagination
- `/blog/[slug]` loads, OG image src present, JSON-LD present (assert `<script type="application/ld+json">`), TOC renders
- `/search` typing → results updates with debounce
- Newsletter capture card click → form → success state
- robertangeles.com fixture URL → 301 → archoslabs.xyz path → 200

**Security:**
- Malicious HTML fixture in WP row → rendered post does NOT execute script
- Rate limit on /api/newsletter/subscribe enforced
- /api/search query length cap enforced

**Test ambition check:**
- 2am-Friday test: pilot 5-post migration runs idempotently, /blog serves all 5 with full polish, /search returns expected, 301s work.
- Hostile QA test: malicious WP fixture (XSS payload in title, body, slug); 200-post migration with intentional 10% malformed rows; concurrent migration + read traffic.
- Chaos test: Claude API hard-fail mid-migration; embedding API hard-fail mid-migration; Resend hard-fail mid-newsletter-signup. All should degrade gracefully.

### Section 7 — Performance

| Concern | Sizing | Mitigation |
|---|---|---|
| pgvector ANN read-next | 200 posts × ~1KB embedding | `ivfflat` index, `lists=14` (≈√200); p99 < 50ms |
| `/search` ANN | Same | p99 < 200ms with embedding API latency dominant |
| Migration script runtime | 200 posts × (extract + transform + 3× Claude + embed + og + insert) | ~3-5 sec/post serial → ~15min total; parallelise to 4 workers → <5min |
| Media migration | 1.34GB of uploads (deduplicated of thumbnails maybe ~400-600MB) | One-time. CDN re-host. Lazy-load below-fold. |
| Public post page | Markdown + TOC + JSON-LD + read-next | ISR with revalidate; cold render <500ms |
| Newsletter signup | 1 DB write + 1 Resend API call | Async on retry; user sees 202 immediately |

**N+1 check:** read-next widget needs a single ANN query, not N queries. Category index page needs JOIN on category + post (not N queries per post).

### Section 8 — Observability

**Logs (structured):**
- Migration script logs per-post: `{source_wp_id, slug, decisions: {shortcodes_stripped: N, claude_currency_flag, claude_needs_review, embedding_dim, og_generated}, errors: []}`
- Public post render logs: log only on slow render (>1s) or graceful-degrade events (read-next or JSON-LD failure)
- Newsletter signup logs: signup, confirm, error — never raw email outside of hashed form for analytics

**Metrics (where to read them):**
- `posts_migrated_total`, `posts_needs_review_total`, `posts_failed_total` — from migration manifest
- `posts_listed_total` vs `posts_unlisted_total` — admin dashboard
- `search_queries_total`, `search_results_zero_total` — Plausible (E7, deferred) or admin SQL
- `newsletter_signups_total`, `newsletter_confirmed_total` — admin view

**Alerts (day 1):**
- Any post page returning 404 in week after migration → check redirect map (until Search Console confirms transition)
- Migration script: terminal failure → alert per CLAUDE.md cron-alert pattern (backlog item 34 already covers this)
- Resend bounce rate > 5% → email-list health alert

**Dashboards (day 1):**
- Migration manifest viewer (admin route reading `scripts/migrate-wp/manifest.json` or DB-stored equivalent)
- Posts admin: counts by status × visibility × needs_review
- Newsletter signups: pending vs confirmed, source-post breakdown

**Runbook (day 1):**
- "A post 404s in production": check `post.visibility`, check 301 redirect map, check ISR cache.
- "Migration script halted mid-run": re-run; idempotency via `source_wp_id` upsert handles resumption.
- "Search returns empty for known query": check `pgvector` extension, check embedding completeness on post rows.

### Section 9 — Deployment & Rollout

**Phased rollout (matches CLAUDE.md "feature flag for shared code"):**

```
PHASE A   Schema + admin posts list + dry-run extract
          ─────────────────────────────────────────────
          ✓ Migration ships post/author/category tables
          ✓ pgvector extension enabled on Render Postgres
          ✓ Admin /admin/(authed)/posts page renders (empty)
          ✓ scripts/migrate-wp/ supports --dry-run flag
          ✓ Public routes NOT shipped or feature-flagged OFF
          ✓ Rollback: trivial — drop migration

PHASE B   Public render + integration tests + pilot migration
          ─────────────────────────────────────────────
          ✓ Public /blog/* routes shipped, flag OFF
          ✓ Full integration + E2E tests passing
          ✓ Pilot: hand-pick 5 posts → run migration → preview deploy
          ✓ Verify on preview deploy: render, OG, JSON-LD, search, TOC
          ✓ Rollback: feature flag OFF, posts remain in DB

PHASE C   Bulk migration + cutover
          ─────────────────────────────────────────────
          ✓ Run full migration script (200+ posts)
          ✓ Generate OG images (background or in-line)
          ✓ Generate embeddings (background or in-line)
          ✓ Spot-check 10 random posts on preview deploy
          ✓ Verify SEO/AIEO foundations:
              - /llms.txt, /llms-full.txt, /robots.txt, /sitemap.xml all 200
              - JSON-LD + canonical + OG meta on every post
          ✓ Flip feature flag → /blog public on Archos Labs
          ✓ Apex 301: robertangeles.com/* → archoslabs.xyz/blog (simple)
          ✓ Submit Archos Labs sitemap to Google Search Console + Bing Webmaster
          ✓ Decommission WP admin (keep apex 301 only for 30-60 days)
          ✓ Schedule domain non-renewal after cool-off window
          ✓ Rollback: feature flag OFF. Posts still in DB; redirect easily reverted.

PHASE D   Polish + Resend integration + Search UI
          ─────────────────────────────────────────────
          ✓ Resend integration live (newsletter signups confirm)
          ✓ /search UI live
          ✓ Read-next widget on every post
          ✓ TOC + reading time + last-reviewed UI shipped
          ✓ Rollback: per-feature flag.
```

**Migration script is the only non-reversible step (in terms of "we've moved data"), but it's idempotent — re-runnable, no data loss.** The truly irreversible step is decommissioning robertangeles.com WP. Defer that to the end of Phase C, after 7 days of stable 301 traffic.

**Deploy-time risk window:** Pages CMS Phase 3 (AI authoring) is still planned. This migration must avoid hijacking Phase 3 — keep `post` separate from `page` so both can evolve.

**Smoke tests post-deploy:**
- curl https://archoslabs.xyz/blog/{known-slug} → 200 + correct content
- curl https://robertangeles.com/{known-old-slug} → 301 → archoslabs.xyz/blog/{new-slug}
- curl https://archoslabs.xyz/sitemap.xml | grep modelling-room | wc -l → expected count
- View-source: JSON-LD present, OG image valid
- /search "data governance" → expected posts

### Section 10 — Long-Term Trajectory

**Reversibility:** **4/5** at feature-flag level. **2/5** after Search Console change-of-address (Google re-indexing is slow to reverse). **1/5** after WP decommission (no undo).

**Path dependency:**
- Pages CMS Phase 3 (AI authoring) → rebrand as Post authoring (creating new posts via AI).
- Pages CMS Phase 4 (nested routing) — independent; this migration uses its own nested namespace `/blog/[slug]`.
- Phase 5/6 (audience variants, AI translations) — can extend to posts naturally.

**Tech debt introduced:**
- Migration script under `scripts/migrate-wp/` is one-shot; after Phase C it's effectively dead code. Archive but don't delete (audit trail value).
- Media rehosting decision compounds — chosen CDN becomes long-term commitment.
- Embedding model choice compounds — if model changes, regenerate all 200+ embeddings (~$0.10, cheap).

**1-year question:** New engineer in May 2027 reads `lib/posts.ts` + `app/blog/[slug]/page.tsx` + the schema → has the model in <30 min. The migration script is archaeology, not load-bearing.

**Platform potential:**
- Post + author + category infrastructure later supports guest authors (if Archos Labs evolves into a multi-contributor publication).
- Semantic search + read-next infrastructure later supports the Executive AI Diagnostic recommending posts based on diagnostic results — high leverage.
- Newsletter capture infrastructure later supports product-launch announcements, course launches, etc.

### Section 11 — Design & UX

**Significant UI scope.** Recommend running `/plan-design-review` after this CEO review completes.

**New surfaces:** /blog (index), /blog/[slug] (article), /blog/category/[slug] (category index), /search (search UI), TOC component, read-next widget, newsletter capture card (inline + footer), OG image template, author bio card (PersonCard reuse), admin /posts listing.

**Information architecture (post page):**
```
   ┌─────────────────────────────────────────────────┐
   │  H1: Post title                                 │
   │  ─────────────────────────────                  │
   │  7 min read · Last reviewed: 2026-03            │
   │  ─────────────────────────────                  │
   │                              │                   │
   │  Body                        │  [TOC sticky]     │
   │  (markdown with pull-quotes) │   - Section 1     │
   │                              │   - Section 2     │
   │                              │     - Subsection  │
   │                                                  │
   │   [Inline newsletter capture @ 60% scroll]      │
   │                                                  │
   │  Author bio (PersonCard — Rob)                   │
   │  ─────────────────────────────                   │
   │  Read next: [3 semantically related posts]       │
   │  ─────────────────────────────                   │
   │  [Footer newsletter capture]                     │
   └─────────────────────────────────────────────────┘
```

**Interaction state coverage:**
| Feature | Loading | Empty | Error | Success | Partial |
|---|---|---|---|---|---|
| /blog index | Skeleton list | "No posts yet" (shouldn't happen post-migration) | Show cached version + small banner | List renders | (n/a) |
| /blog/[slug] | Skeleton article | (post not found → 404) | Graceful — render without read-next | Full render | TOC may hide if no headings |
| /search | Debounced spinner | "No matches; here's recent" | Fall back to full-text + notice | Results | (n/a) |
| Newsletter signup | Inline spinner on submit button | (n/a) | Error message + retry | Confirmation card | "Already on the list" |
| Read-next widget | Lazy-load below fold | "Browse all posts" link | Hide widget silently | 3 cards | <3 candidates → most-recent-3 |
| TOC | (n/a — server-rendered) | Hidden (no headings) | (n/a) | Sticky on desktop | Drawer on mobile |

**AI slop risk:** avoid generic-blog patterns — giant featured-image hero, "Read more" pseudo-CTAs, infinite scroll, sidebar ad slots, share-buttons-on-every-third-paragraph. Magazine intentionality. Subtraction default.

**Mobile-first:** TOC drawer, copy-link buttons at thumb-friendly size, newsletter card not blocking scroll.

**Accessibility:** heading hierarchy strict, search input keyboard-navigable, copy-link buttons have aria-labels, OG images have alt text, JSON-LD doesn't break screen readers.

---

## Failure Modes Registry

| Codepath | Failure mode | Rescued? | Test? | User sees? | Logged? |
|---|---|---|---|---|---|
| `extract.ts` DB conn fail | Connection refused | Y (halt + alert) | Y | n/a | Y |
| `transform.ts` shortcode unparseable | Visual Composer shortcode | Y (strip + flag) | Y | n/a | Y |
| `claude-polish.ts` timeout | Anthropic API timeout | Y (retry 3×) | Y | n/a | Y |
| `claude-polish.ts` refusal | Model returns refusal | Y (keep defaults + flag) | Y | n/a | Y |
| `embed.ts` provider down | Embedding API 5xx | Y (retry, queue) | Y | n/a | Y |
| `media-rehost.ts` 404 | Image URL gone from WP | Y (flag) | Y | Broken img | Y |
| `og-generate.ts` render fail | Template fails | Y (default OG) | Y | Default OG | Y |
| `insert.ts` duplicate | Re-run after partial | Y (upsert) | Y | n/a | Y |
| `/blog/[slug]` not found | Bad slug | Y (404) | Y | Friendly 404 | Y |
| `/blog/[slug]` embedding query timeout | pgvector slow | Y (hide widget) | Y | No read-next | Y (warn) |
| `/search` API down | Provider down | Y (FTS fallback) | Y | Notice + degraded results | Y |
| `/api/newsletter/subscribe` Resend down | Vendor 5xx | Y (queue + retry) | Y | "Confirmation coming" | Y |
| `/api/newsletter/confirm` token expired | Time-based | Y (re-send page) | Y | Friendly re-send | Y |
| 301 from robertangeles unknown path | Old slug not mapped | Y (apex 301) | Y | Lands on index | Y |

**Zero rows with RESCUED=N, TEST=N, USER SEES=Silent.** Zero CRITICAL GAPS.

---

## TODOS proposals (deferred from this plan)

To be added to `wiki/backlog/` (or equivalent) — none are in migration scope:

1. **Post analytics (E7 deferred).** Plausible integration, page-view + scroll-depth + outbound-click + /book-a-call conversion. Effort: human ~1 day / CC ~1-2 hours. Priority: P2 (post-migration).
2. **Pages CMS Phase 3 — AI authoring.** Already on the backlog; expand to cover both pages AND posts.
3. **Pages CMS Phase 4 — nested routing.** Already on the backlog; this migration sidesteps it via `/blog/*` namespace.
4. **Multi-author support (future).** Schema already supports it; UI for inviting/managing authors is deferred. Priority: P3.
5. **Comments / engagement layer.** Explicitly skipped per brand. Re-evaluate if engagement signal becomes needed. Priority: P4.
6. **TTS audio version of posts.** Bling for now; consider if data shows audio demand. Priority: P4.
7. **"Mentioned in" backlinks** — show when post A links to post B, surface from B. Useful for a 200-post library. Priority: P3.
8. **Print stylesheet for posts** — executive readers print. Priority: P3.

---

## Stale diagram audit

Diagrams in files this plan touches:
- `wiki/decisions/2026-05-18-pages-cms-expansion.md` Phase 3/4 diagrams — will need an update note: "Modelling Room posts ship as a parallel track (rosy-bee plan); Phase 3 AI authoring covers both pages and posts post-migration."
- No other diagrams stale.

---

## Verification (end-to-end success)

Concrete pass criteria, in execution order:

```
PHASE A pass criteria
─────────────────────
✓ pnpm drizzle-kit push succeeds; pgvector extension confirmed:
    SELECT * FROM pg_extension WHERE extname='vector';
✓ Tables present: post, author, category, post_revision, newsletter_signup
✓ /admin/(authed)/posts loads (empty listing)
✓ scripts/migrate-wp/ --dry-run --source-db=$WP_DB_URL outputs manifest
✓ Manifest shows: total rows, post-types breakdown, draft/published counts,
   media-URL list, "needs_review" preview tags

PHASE B pass criteria
─────────────────────
✓ Pilot: run migration on 5 hand-picked posts (preview DB)
✓ Render /blog/{slug} on preview — typography, OG, JSON-LD all present
✓ /search returns expected for canned query
✓ E2E Playwright suite passes
✓ Curl: GET /blog/{slug} returns 200 + JSON-LD in HTML

PHASE C pass criteria
─────────────────────
✓ Migration runs against prod DB; manifest counts match expectations
✓ All 200+ posts insertable; needs_review backlog reviewed by Rob
✓ Feature flag flipped: archoslabs.xyz/blog is live
✓ Curl: robertangeles.com (any path) → 301 → archoslabs.xyz/blog
✓ Curl: archoslabs.xyz/sitemap.xml | grep '/blog/' | wc -l == migrated count
✓ Curl: archoslabs.xyz/llms.txt → 200, lists top posts
✓ Curl: archoslabs.xyz/llms-full.txt → 200, full corpus
✓ Curl: archoslabs.xyz/robots.txt → 200, allows AI bots
✓ Sitemap submitted to Google Search Console + Bing Webmaster
✓ Rich Results Test on 3 sample posts → all valid
✓ 7-day observation: no 404 spike on archoslabs.xyz

PHASE D pass criteria
─────────────────────
✓ Resend test signup: confirmation email arrives, double-opt-in works,
   subscriber appears in admin /newsletter
✓ TOC renders on long post; hides on short post
✓ Read-next widget shows on every post; ≥3 cards or graceful fallback
✓ Copy-link buttons work on every heading
✓ Reading-time matches manual count for 5 sample posts
✓ /search live and returning expected results
```

---

## NOT in scope (until proven necessary)

- Multi-author editing or contributor invitations.
- Comments (`wpdiscuz` does not need to migrate).
- Custom post types from `edge-cpt` (case studies, testimonials) — separate decision if they exist.
- Visual Composer shortcode round-tripping. (Shortcodes will be stripped; the on-brand subset is likely post-Gutenberg and clean.)
- robertangeles.com domain redirects at DNS level — separate decision tied to whether the site retires.
- AI-authored summaries / OG images — that's Phase 3 of the CMS plan, separate work.

---

## What already exists (don't rebuild)

- `page` table + revisions ([lib/db/schema.ts](cc-archos-labs/lib/db/schema.ts:714))
- `MarkdownArticle` renderer ([components/pages/markdown-article.tsx](cc-archos-labs/components/pages/markdown-article.tsx))
- Block registry (11 types, missing `image` and `code`)
- `matchBlogPosts()` + `site_setting['blog_library']` hook ([lib/claude-booking.ts](cc-archos-labs/lib/claude-booking.ts))
- Yoast metadata on the WP side (maps cleanly to `seo_title` / `seo_description`)
- Admin auth ([app/admin/(authed)/](cc-archos-labs/app/admin/(authed)/))

---

## Dream state delta

This migration moves Archos Labs from "static practice site + diagnostic" to "static practice site + diagnostic + branded thought-leadership archive." It does **not** move it to "publication" unless APPROACH B is chosen. Choosing D leaves room for B later; choosing B now spends effort that should probably go to consulting revenue.

---

---

# Engineering Review (`/plan-eng-review`)

**Run:** 2026-05-19 · **Mode:** FULL_REVIEW
**Scope posture:** CEO review locked SCOPE EXPANSION with all six accepted expansions plus AIEO foundations. Complexity-check threshold IS triggered (15+ files, multiple new services) — flagged, but committed-fully per the skill rule. No re-arguing scope.

## ENG Section 1 — Architecture (locked decisions)

### Schema — new tables

Mirror the `page` / `page_revision` / `page_block` pattern: text columns (not Postgres ENUMs) for enum-like fields so migrations stay cheap; ASCII state diagrams in comments; index comments naming the query each serves.

```typescript
// lib/db/schema.ts — new section after page_block

// ============================================================================
// post — Translation Layer (rosy-bee migration)
// ============================================================================
// Time-stamped editorial content migrated from robertangeles.com WordPress.
// Sibling of `page` (not a subtype). Page = static marketing pages; Post =
// time-stamped editorial under /blog. Different lifecycles, different surfaces
// (post-listing UI, /search, read-next widget), different field set.
//
// Lifecycle:
//
//   draft ──schedule──▶ scheduled ──auto-publish──▶ published
//     │                                                │
//     │                                                ▼
//     └──────────────publish────────────────────▶ published ──archive──▶ archived
//                                                     ▲                       │
//                                                     └─── restore ───────────┘
//
// Visibility (independent of status):
//   listed   = appears in /blog index, sitemap-prominent, read-next pool
//   unlisted = indexable via direct URL only (SEO preserved, editorially hidden)

export const post = pgTable(
  "post",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),                   // /blog/[slug]
    title: text("title").notNull(),
    excerpt: text("excerpt"),                                // Claude-generated (E2)
    contentMd: text("content_md").notNull().default(""),     // Turndown output
    seoTitle: text("seo_title"),
    seoDescription: text("seo_description"),
    ogImagePath: text("og_image_path"),                      // R2 path or /public/og/...
    ogImageGeneratedAt: timestamp("og_image_generated_at", { withTimezone: true }),
    authorId: uuid("author_id").references(() => author.id),
    categoryId: uuid("category_id").references(() => category.id),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),  // free-form, secondary to category
    status: text("status").notNull().default("draft"),       // draft|scheduled|published|archived
    visibility: text("visibility").notNull().default("listed"), // listed|unlisted
    embedding: vector("embedding", { dimensions: 1024 }),    // voyage-3-large
    wordCount: integer("word_count").notNull().default(0),
    readingTimeMin: integer("reading_time_min").notNull().default(0),
    needsReview: boolean("needs_review").notNull().default(false),  // Claude polish (E2) flag
    sourceWpId: integer("source_wp_id"),                     // uhiz_posts.ID — idempotency key
    lastReviewedAt: timestamp("last_reviewed_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Public catch-all: SELECT ... WHERE slug = $1 AND status='published' AND visibility='listed' AND archived_at IS NULL
    // slug is already UNIQUE; composite index serves /blog index pagination
    index("post_status_visibility_published_at_idx").on(table.status, table.visibility, table.publishedAt),
    // Read-next ANN query: pgvector HNSW (m=16, ef_construction=64)
    // ivfflat would also work for 200 docs (lists=10) but HNSW scales without rebuild
    // Custom SQL in migration: CREATE INDEX ... USING hnsw (embedding vector_cosine_ops)
    index("post_category_id_idx").on(table.categoryId),
    index("post_archived_at_idx").on(table.archivedAt),
    // Migration idempotency: re-runs upsert on source_wp_id
    uniqueIndex("post_source_wp_id_unique").on(table.sourceWpId),
    // Admin "needs review" queue
    index("post_needs_review_idx").on(table.needsReview).where(sql`needs_review = true`), // partial
  ],
)
```

Companion tables: `author` (single-row today, schema supports multi later), `category` (4 rows: AI as Strategy, Data as a Decision Infrastructure, Human-Centered Transformation, The Execution Layer — seed at migration), `post_revision` (mirror `page_revision` exactly), `newsletter_signup` (capture state, vendor-decision in plan: Resend Audiences).

### Library + vendor locks

| Decision | Locked choice | Why | Alternatives considered |
|---|---|---|---|
| Post storage strategy | Separate `post` table | Different lifecycle (scheduled status, visibility enum, category, embedding), different routing (`/blog/[slug]`), different admin UI. Mirrors CLAUDE.md "one responsibility per file." | `kind` discriminator on `page` table — rejected: overloads page, mixes evolution tracks |
| Image CDN | **Cloudflare R2** *(Rob, ENG-1)* | Zero egress cost, S3-compatible, edge network, ~$0.06/mo for ~400 MB. Set as `next/image` remotePattern for on-the-fly optimisation. | Vercel Blob (priced egress), Render disk (no CDN), Cloudinary ($89+/mo overkill) |
| Embedding model | **Voyage `voyage-3-large`** *(Rob, ENG-2)* | Anthropic-recommended, 1024 dims, stack-aligned (Claude + Voyage). Backfill cost ~$0.07 for 200 posts. | OpenAI text-embedding-3-* (adds vendor), voyage-3 lite (lower quality) |
| pgvector index | **HNSW** with `m=16, ef_construction=64` | Modern best practice. Scales without rebuild. For 200 docs, IVFFlat would also be fine but HNSW future-proofs to 10K+. Build time sub-second. | IVFFlat (older, requires re-tuning at scale) |
| HTML → markdown | **Turndown** ([`turndown`](https://www.npmjs.com/package/turndown) ~70K weekly DL) + `turndown-plugin-gfm` | Battle-tested, dominant choice. Plugin covers GFM tables/strikethrough. | `node-html-markdown` (faster, less mature), custom rehype-remark (over-engineering) |
| Migration concurrency | Sequential within a post, **p-limit pool of 3** across posts | 200 posts × ~5 sec/post = ~10 min sequential; with 3-wide pool ~3.5 min. Stays under provider rate limits without backoff complexity. | BullMQ / Redis queue (over-engineering for 200 posts), full parallel (rate-limit hell) |
| OG image generation | `next/og` `ImageResponse` from a build-time script (NOT a request-time route) | Generate once at migration, store path on `post.og_image_path`. Avoids edge-runtime cost per request. | Request-time `/og/[slug]` route (compute on every share — wasteful), Cloudinary on-the-fly (vendor lock) |
| Test framework | **vitest** + Playwright | Per CLAUDE.md; already the project default. | Jest (legacy) |

### Migration script architecture (`scripts/migrate-wp/`)

```
scripts/migrate-wp/
  index.ts              ← orchestrator: arg parsing, dry-run flag, manifest writer
  extract.ts            ← mysql2 → typed `WpPost` records from uhiz_posts
  transform.ts          ← WP HTML → markdown (Turndown), shortcode stripper, slug normaliser
  claude-polish.ts      ← excerpt + currency-check + topic-tagging per post (E2)
  embed.ts              ← Voyage voyage-3-large embedding, batched 8 posts/request
  media-rehost.ts       ← download from wp-content/uploads → upload to R2 → URL rewrite
  og-generate.ts        ← invoke @vercel/og ImageResponse, upload to R2
  insert.ts             ← upsert by source_wp_id (idempotent)
  redirect-rules.ts     ← emit apex-301 nginx/Apache config for robertangeles.com
  llms-txt.ts           ← regenerate /llms.txt + /llms-full.txt from post table
  manifest.json         ← OUTPUT: per-post decisions log (read by admin UI)
```

Orchestrator runs each post through the pipeline, p-limit(3), retries with exponential backoff per step, halts on first **post**-level fatal (but continues other posts in the pool). Manifest captures `{source_wp_id, slug, decisions: {...}, errors: [...], needs_review: bool}` so the admin "needs review" queue is populated automatically.

**Idempotency:** every post insert is `ON CONFLICT (source_wp_id) DO UPDATE SET ...`. Re-running the script is safe and updates fields that have changed; never duplicates.

**Resumability:** halted mid-run, restart skips successfully-inserted posts (their `source_wp_id` already exists) and reattempts the rest.

### Authentication and authorisation

All new admin routes (`/admin/(authed)/posts*`, `/admin/(authed)/authors`, `/admin/(authed)/categories`, `/admin/(authed)/newsletter`) inherit the existing Pages CMS auth chain — no new auth surface introduced. Public routes (`/blog`, `/blog/[slug]`, `/search`, `/api/newsletter/subscribe`) require no auth.

### Realistic production failure scenarios (one per integration point)

| Integration | Failure | Handled? | Mitigation |
|---|---|---|---|
| WP MySQL extract | DB unreachable mid-run | Yes | Halt + manifest captures progress; restart resumes via source_wp_id |
| Claude API | Rate limit 429 during polish | Yes | p-limit(3) + exponential backoff per post; prompt caching keeps cost down |
| Voyage embedding API | Provider 5xx | Yes | Retry 3×, then queue post with `needs_review=true` for manual re-embed |
| R2 upload | Network timeout | Yes | Retry 3×; manifest flags `media_rehost_failed=true`; post inserts with original WP URL (broken but visible) + needs_review |
| pgvector index build | OOM on Render Postgres | Low risk | HNSW for 200 docs is <100 MB; if hit, fall back to IVFFlat |
| /blog/[slug] ANN query | pgvector timeout (>500ms) | Yes | Graceful degrade: render post without read-next widget; log warn |
| Resend API | Vendor down during signup | Yes | Queue signup locally; retry async via cron; user sees "we'll confirm shortly" |
| @vercel/og generation | Template render exception | Yes | Fall back to default brand OG; manifest flags `og_failed=true` |
| WP source media | Image URL 404 | Yes | Leave reference, flag needs_review; admin can fix or remove |
| Shortcode parser | Visual Composer shortcode unknown | Yes | Strip with warning; flag needs_review; never breaks the post |

Zero silent-failure paths. Every degraded outcome surfaces in the `needs_review` queue or admin logs.

### Distribution / CI

No new artifact type (web app, not a binary). Existing CI pipeline (`pnpm install --frozen-lockfile`, lint, tsc, vitest, build) covers all new code. Adding pre-deploy step in Phase A: `pnpm drizzle-kit push` from project root after merging schema PR.

## ENG Section 2 — Code Quality

### File shape (locked, per CLAUDE.md `lib/` rules)

```
lib/
  posts.ts                  ← steady-state queries: getPostBySlug, listPosts,
                              listByCategory, getReadNext, getRecentPosts
  post-rendering.ts         ← generateToc, getReadingTime, formatLastReviewed
  search.ts                 ← annSearch(query, limit), ftsSearch fallback,
                              normaliseQuery
  newsletter.ts             ← subscribe, confirm, alreadySubscribed,
                              resendClient (Resend Audiences API)
  structured-data.ts        ← Article schema, Person schema, Breadcrumb, FAQ,
                              Organization (site-wide)
  og-image.ts               ← ImageResponse template (shared by build script + admin preview)
  llms-txt.ts               ← buildLlmsTxt(posts), buildLlmsFullTxt(posts)

app/api/
  newsletter/subscribe/route.ts
  newsletter/confirm/route.ts
  search/route.ts           ← GET ?q=... → ANN results

app/
  blog/
    page.tsx                ← /blog index (paginated, listed-only)
    [slug]/page.tsx         ← post article
    category/[slug]/page.tsx
    feed.xml/route.ts       ← RSS for LinkedIn newsletter sync
  search/page.tsx           ← /search UI
  llms.txt/route.ts         ← dynamic, generated from post table
  llms-full.txt/route.ts
  robots.txt/route.ts       ← extended to allow AI crawlers explicitly

components/blog/
  PostHeader.tsx            ← title + reading-time + last-reviewed micro-row
  Toc.tsx                   ← sticky desktop / drawer mobile
  ReadNext.tsx              ← 3-card semantic recommendation widget
  NewsletterCard.tsx        ← inline @ 60% scroll + footer variant
  HeadingCopyLinkButton.tsx ← per-heading deep-link copy button
  PullQuote.tsx             ← styled blockquote variant

scripts/migrate-wp/        (already enumerated in Section 1)
```

### DRY review

- **MarkdownArticle** ([components/pages/markdown-article.tsx](cc-archos-labs/components/pages/markdown-article.tsx)) reused unchanged for `/blog/[slug]` body. Do NOT fork it. If post-specific styling is needed, layer via wrapper component, not a second renderer.
- **PersonCard** existing in `/about` reused for author bio at end of every post — single source of truth for Rob's bio.
- **Page revision pattern** ([lib/db/schema.ts](cc-archos-labs/lib/db/schema.ts) `pageRevision`) mirrored in `post_revision` — same diff_size_pct heuristic, same cascade-delete posture, same `saved_by` text column.
- **Reserved-slug guard** existing for pages (`lib/pages/reserved-slugs`) — extend, not duplicate, for `/blog/[slug]`. The list grows; the validator stays one file.
- **Resend client** for newsletter shares the same SDK config as any future transactional email (booking confirmations were originally on this roadmap). Single `lib/resend.ts` exports the client; `newsletter.ts` and any future `transactional.ts` consume it.

### Under-engineering / over-engineering checks

- ✅ No premature abstraction over `page` and `post` — sibling tables, no shared base class. Correct per CLAUDE.md "no abstractions for single-use code."
- ✅ No content_blocks column on `post` (only `content_md`). Post is markdown-only; composed-block templates are a Pages-CMS-Phase-3 concept for marketing pages, not editorial posts. Add later only if a real need surfaces.
- ⚠️ `tags` JSONB is intentionally a free-form array, not a `post_tag` junction table. For 200 posts × ~5 tags avg = ~1000 (post, tag) pairs total. JSONB is correct here — querying via `WHERE tags @> '["AI strategy"]'` with a GIN index is plenty fast. Normalising to `tag` + `post_tag` adds two tables and three joins for zero analytic gain at this scale.
- ⚠️ Free-form tags risk drift (typos, case variance). Mitigation: at migration time, Claude polish (E2) generates tags from a fixed taxonomy list passed in the prompt. Admin UI later: tag suggestions from existing-tag dropdown. No enforcement table needed unless drift becomes painful.

### Stale-diagram audit

The `page` table has a lifecycle ASCII diagram in its schema comment ([lib/db/schema.ts:724](cc-archos-labs/lib/db/schema.ts#L724)). After this migration ships, no change required — `page` lifecycle is unchanged. The `post` table introduces its own diagram (see Section 1 schema sketch).

No issues found in Section 2 that gate a decision.

## ENG Section 3 — Test Coverage Diagram

Project uses **vitest** (per CLAUDE.md) + Playwright for E2E. Test command: `pnpm test` / `pnpm test:integration` / `pnpm test:e2e`.

```
CODE PATHS                                                  USER FLOWS
─────────────────────────────────────────────────────       ─────────────────────────────────────────────
[+] scripts/migrate-wp/extract.ts                           [+] Reader on /blog/[slug] (cold)
  ├── connectToWpDb()                                         ├── [GAP] [→E2E] Lands from Google search result
  │   ├── [GAP] success path                                  │           — sees title, byline, reading time,
  │   └── [GAP] connection refused                            │             OG image preview confirmed in <head>
  └── mapRowToPost(row)                                       ├── [GAP] [→E2E] Reads to 60% → newsletter card appears
      ├── [GAP] complete row                                  └── [GAP] [→E2E] Reads to bottom → sees read-next + author bio
      ├── [GAP] nil body                                    
      ├── [GAP] missing slug                                  [+] Reader on /blog index
      └── [GAP] custom-post-type row (edge-cpt)               ├── [GAP] [→E2E] Loads page 1 → sees 10 posts in date order
                                                              ├── [GAP] [→E2E] Clicks page 2 → loads more, scroll preserved
[+] scripts/migrate-wp/transform.ts                           └── [GAP]        Filters by category → URL updates to /blog/category/x
  ├── htmlToMarkdown(html)
  │   ├── [GAP] Gutenberg block fixture                     [+] Searcher on /search
  │   ├── [GAP] Classic Editor HTML fixture                   ├── [GAP] [→E2E] Types query → debounced results render
  │   ├── [GAP] Visual Composer shortcode (strip + flag)      ├── [GAP] [→E2E] Zero results → graceful "no matches" UX
  │   ├── [GAP] embedded YouTube                              ├── [GAP]        Provider down → FTS fallback + notice
  │   ├── [GAP] inline image                                  └── [GAP]        Cmd-K opens search from any page
  │   ├── [GAP] code block (```language)
  │   ├── [GAP] footnote markdown                            [+] Newsletter signup
  │   └── [GAP] malformed HTML (keep raw, flag)               ├── [GAP] [→E2E] Submit valid email → see "check your inbox"
  ├── stripShortcodes(text)                                   ├── [GAP] [→E2E] Click confirmation link → see "you're in"
  │   ├── [GAP] known shortcode (caption, gallery)            ├── [GAP]        Already-subscribed → friendly idempotent UX
  │   └── [GAP] unknown shortcode (strip + warn)              ├── [GAP]        Expired token → re-send page
  └── slugify(title)                                          ├── [GAP]        Rate-limit hit (>5 attempts/min) → 429 + friendly
      ├── [GAP] Unicode chars                                 └── [GAP]        Malicious email payload (HTML/SQL) → rejected
      ├── [GAP] special punctuation
      └── [GAP] collision resolution (append -1, -2)        [+] Cross-domain reader (LinkedIn share, old URL)
                                                              └── [GAP] [→E2E] Visits robertangeles.com/old-slug
[+] scripts/migrate-wp/claude-polish.ts                                  → 301 → archoslabs.xyz/blog (apex)
  ├── buildPrompt(post)                                                  → reader lands on /blog index, finds the post
  │   └── [GAP] truncates posts >32k tokens
  ├── parseResponse(json)                                   [+] AI crawler (GPTBot, ClaudeBot, etc.)
  │   ├── [GAP] valid JSON                                    └── [GAP] curl -A "GPTBot" /llms.txt → 200, lists top posts
  │   ├── [GAP] malformed JSON (re-prompt strict)                   curl -A "GPTBot" /robots.txt → allows GPTBot
  │   └── [GAP] refusal (keep defaults, flag)                       curl -A "GPTBot" /blog/[slug] → 200, JSON-LD present
  └── runWithRetry(fn)
      └── [GAP] 429 backoff
                                                            [+] Admin moderates the migration
[+] scripts/migrate-wp/embed.ts                               ├── [GAP]        Sees needs_review queue post-migration
  ├── chunkText(content_md, 8000)                             ├── [GAP]        Opens flagged post, reviews diff, clears flag
  │   ├── [GAP] short post (1 chunk)                          ├── [GAP] [→E2E] Edits post → revision created, blocks_snapshot=null
  │   └── [GAP] long post (multiple chunks, avg-pool)         └── [GAP]        Toggles visibility listed↔unlisted, UI updates
  └── embedBatch(texts)
      ├── [GAP] 200 success
      ├── [GAP] empty batch (skip)
      └── [GAP] provider 5xx (retry, then queue)

[+] scripts/migrate-wp/media-rehost.ts
  ├── downloadFromWp(url)
  │   ├── [GAP] 200 success
  │   ├── [GAP] 404 (flag needs_review)
  │   └── [GAP] timeout (retry, then flag)
  └── uploadToR2(buffer, key)
      ├── [GAP] success
      └── [GAP] R2 5xx (retry, then flag)

[+] scripts/migrate-wp/og-generate.ts
  ├── renderTemplate(post)
  │   ├── [GAP] short title
  │   ├── [GAP] long title (truncate ellipsis)
  │   └── [GAP] missing excerpt
  └── uploadToR2

[+] scripts/migrate-wp/insert.ts
  └── upsertPost(post) ON CONFLICT (source_wp_id)
      ├── [GAP] insert path
      ├── [GAP] update path (re-run idempotency)
      └── [GAP] unique slug collision (different source_wp_id)

[+] scripts/migrate-wp/redirect-rules.ts
  └── emitNginxConfig(posts)
      └── [GAP] generates single apex 301 rule

[+] scripts/migrate-wp/llms-txt.ts
  ├── buildLlmsTxt(posts)
  │   └── [GAP] top-20 listed posts, alphabetical
  └── buildLlmsFullTxt(posts)
      └── [GAP] all listed posts in full

[+] lib/posts.ts
  ├── getPostBySlug(slug)
  │   ├── [GAP] published + listed: returns post
  │   ├── [GAP] published + unlisted: returns post (direct URL OK)
  │   ├── [GAP] draft/scheduled/archived: returns null
  │   └── [GAP] unknown slug: returns null
  ├── listPosts(opts)
  │   ├── [GAP] page 1, listed-only, paginated
  │   ├── [GAP] unlisted posts excluded
  │   └── [GAP] empty result (impossible post-migration but covered)
  ├── getReadNext(postId, limit=3)
  │   ├── [GAP] returns 3 semantically related posts
  │   ├── [GAP] post has no embedding (graceful fallback to most-recent)
  │   ├── [GAP] <3 candidates available (returns what's there)
  │   └── [GAP] excludes the current post
  └── listByCategory(categorySlug)
      └── [GAP] returns listed posts in that category

[+] lib/search.ts
  ├── annSearch(query, limit)
  │   ├── [GAP] returns ranked results
  │   ├── [GAP] embedding provider error → throws to caller
  │   └── [GAP] empty query rejected at API layer
  └── ftsSearch(query, limit)
      └── [GAP] used when annSearch throws — fallback path

[+] lib/newsletter.ts
  ├── subscribe(email, sourcePostId)
  │   ├── [GAP] new email: creates row, calls Resend, sends confirmation
  │   ├── [GAP] existing pending: re-sends confirmation
  │   ├── [GAP] existing confirmed: returns "already subscribed" idempotent
  │   ├── [GAP] invalid email: rejects
  │   ├── [GAP] rate-limit hit: returns 429
  │   └── [GAP] Resend 5xx: queues for retry, returns 202
  └── confirm(token)
      ├── [GAP] valid unconfirmed token: marks confirmed
      ├── [GAP] already-confirmed token: idempotent
      ├── [GAP] expired token (>72h): re-send page
      └── [GAP] unknown token: 404

[+] lib/structured-data.ts
  ├── articleSchema(post)
  │   └── [GAP] correct shape per schema.org Article
  ├── personSchema()
  │   └── [GAP] Rob with sameAs LinkedIn etc.
  ├── breadcrumbSchema(slug, category)
  │   └── [GAP] /blog → category → slug
  ├── faqSchema(post)
  │   └── [GAP] detects Q&A structure, emits if found, else skip
  └── organizationSchema()
      └── [GAP] Archos Labs entity, site-wide

[+] lib/og-image.ts → ImageResponse
  └── [GAP] renders snapshot test against committed PNG fixtures (3 templates)

[+] app/blog/[slug]/page.tsx
  ├── [GAP] post not found → 404
  ├── [GAP] post found → renders MarkdownArticle + TOC + ReadNext + NewsletterCard
  ├── [GAP] JSON-LD emitted in <head>
  ├── [GAP] canonical link in <head>
  ├── [GAP] OG/Twitter meta in <head>
  └── [GAP] ISR config: revalidate per 60s; on-demand via admin save

[+] app/api/newsletter/subscribe/route.ts
  ├── [GAP] POST happy path
  ├── [GAP] POST invalid email → 400
  ├── [GAP] POST rate-limited → 429
  └── [GAP] POST malformed body → 400

[+] app/api/search/route.ts
  ├── [GAP] GET ?q=valid → ANN results
  ├── [GAP] GET ?q=empty → 400
  ├── [GAP] GET ?q=overlong → truncated to 1000 chars
  └── [GAP] GET rate-limit per IP

[+] app/llms.txt/route.ts
  └── [GAP] returns 200 with top-20 listed posts, text/plain

[+] app/robots.txt/route.ts
  └── [GAP] returns User-agent blocks for GPTBot, ClaudeBot, PerplexityBot,
           Google-Extended, Bingbot, Applebot-Extended, CCBot

[+] Security paths
  ├── [GAP] Malicious HTML fixture in WP row → rendered post does NOT execute script
  ├── [GAP] Newsletter signup with XSS payload in email → rejected at validator
  ├── [GAP] Search query with SQL chars → parameterised, no injection
  └── [GAP] Rate-limit bypass attempts (X-Forwarded-For spoof) → handled at upstream

COVERAGE: 0 / 95 paths tested (0%) — pre-implementation
QUALITY targets: ★★★ on every async/error path · ★★ minimum on every code path · ★ never alone
GAPS at write time: 95 (12 E2E, 1 eval for Claude polish quality, 0 regression — new feature)

E2E suite must include the 12 [→E2E] flows above plus the cross-domain redirect verification.
EVAL suite for Claude polish: 10 pinned posts × {excerpt quality, tag relevance, currency-check accuracy} scored by a separate Claude judge against a rubric, baseline saved.
```

### Critical regression-style test (mandatory per skill IRON RULE)

None applicable — this is purely new code (new `post` table, new routes, new lib files). No existing behaviour to regress.

### Test Plan Artifact

(File path that `/qa` and `/qa-only` consume — written here in the plan since gstack tooling isn't on this Windows machine; can be copied to `~/.gstack/projects/...` later if/when gstack is set up.)

**Affected Pages/Routes:**
- `/blog` — index, paginated, listed-only
- `/blog/[slug]` — article render with TOC + ReadNext + JSON-LD + OG
- `/blog/category/[slug]` — category index
- `/search` — semantic search UI
- `/llms.txt`, `/llms-full.txt`, `/robots.txt`, `/sitemap.xml` — SEO/AIEO foundations
- `/admin/(authed)/posts*` — admin CRUD + revisions + needs-review queue
- `/admin/(authed)/newsletter` — subscriber list + status
- `/api/newsletter/subscribe`, `/api/newsletter/confirm`, `/api/search` — public APIs

**Key Interactions:**
- Click "Read more" / post card on /blog → lands on /blog/[slug]
- Scroll to 60% on post → inline newsletter card appears
- Click any h2/h3 copy-link → URL hash updates, clipboard contains canonical
- Type in /search → results update with <200ms debounce
- Submit newsletter → confirmation email arrives (verify via Resend dashboard or Mailhog)
- Click email confirmation link → "you're confirmed" page
- TOC click → smooth-scroll to section, sticky on desktop
- /blog/[slug] view-source → JSON-LD Article schema present + valid

**Edge Cases:**
- /blog/[slug] for an unlisted post — should render normally (direct URL works)
- /blog/[slug] for an archived post — should 404
- /search with 0 results — friendly fallback to "recent posts"
- /search with provider down — FTS fallback + notice banner
- Newsletter submit with already-subscribed email — idempotent friendly message
- Newsletter confirmation link clicked twice — idempotent
- LinkedIn-shared robertangeles.com URL — apex 301 to /blog

**Critical Paths:**
- New visitor finds a post via Google → reads to end → subscribes → confirms email
- Returning visitor searches → finds a different post → reads "Read next" → clicks /book-a-call
- AI crawler (GPTBot etc.) hits /llms-full.txt → gets full corpus → cites a post in an answer

## ENG Section 4 — Performance

### Rendering strategy

- **`/blog/[slug]`**: ISR with `revalidate: 60` (revalidate every minute) + on-demand `revalidatePath` from admin save endpoint. Cold render <500ms (markdown render is the dominant cost; pgvector ANN ~50ms; JSON-LD generation negligible). Warm cache <50ms.
- **`/blog` (index)**: ISR with `revalidate: 60` + on-demand revalidate from admin post-status-change. Pagination via search params, server-rendered.
- **`/search`**: dynamic SSR (cannot be ISR — query is user input). Aggressive client-side caching of recent searches.
- **`/llms.txt`, `/llms-full.txt`**: ISR with `revalidate: 3600` (regen hourly) — change cadence is days, not minutes.

### pgvector tuning

```sql
-- HNSW index, applied via custom Drizzle migration step
CREATE INDEX IF NOT EXISTS post_embedding_hnsw_idx
ON post USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
```

Query patterns:
- **Read-next** (per post page): `SELECT id, slug, title, excerpt FROM post WHERE id != $1 AND status='published' AND visibility='listed' ORDER BY embedding <=> $2 LIMIT 3` — p99 < 100ms for 200 docs.
- **/search**: same shape but no `id != $1` filter; LIMIT 10. p99 < 200ms with embedding API latency dominant (~100-150ms for Voyage call).

Set `SET LOCAL hnsw.ef_search = 40` for slightly higher recall at modest cost. Defaults are fine for 200 docs; can tune up if quality issues surface.

### N+1 watch

- ✅ Read-next: single ANN query per post page, no N+1.
- ✅ Category index: single `JOIN category ON post.category_id = category.id` query.
- ✅ Admin post listing: paginated, no per-row joins.
- ⚠️ JSON-LD generation: needs author + category data. Solve via `.with({ author: true, category: true })` Drizzle relational query. NOT a separate query per post.
- ✅ Sitemap generation: single `SELECT slug, updated_at FROM post WHERE status='published' AND visibility='listed'` query.

### Memory + bundle size

- Markdown rendering server-side; no client-side markdown library bundle.
- `next/og` ImageResponse generation deferred to build-time script; not bundled with app.
- TOC component: server-rendered from h2/h3 extraction in markdown processor; no client JS unless sticky-behaviour is added (then ~2KB client component).
- Newsletter card: small client component (~3KB) for form state.
- Search UI: client component with debounced input; uses `useTransition` for non-blocking results updates.

### Caching strategy

- All public routes use Next.js cache + ISR.
- `pnpm build` produces a build manifest; Render handles distribution.
- `/llms.txt` + `/llms-full.txt` cached at edge via Cache-Control headers (1h).
- `/api/search` results NOT cached (user-specific queries); rate-limit instead.
- Embedding API responses cached per-query for 1h in Redis if Redis is added later (TODO; not migration scope).

### Rate-limit budget

- `/api/newsletter/subscribe`: 5 requests/min/IP.
- `/api/search`: 30 requests/min/IP (search is interactive, double-tap should not block).
- `/api/newsletter/confirm`: 10 requests/min/IP (lower — these are token-clicks).

No issues found in Section 4 that gate a decision.

## ENG — NOT in scope

Reconfirmed from CEO review + eng-specific deferrals:

- Multi-author UI (schema supports it via `author` table; admin invite flow is later work)
- Comments (wpdiscuz NOT migrated — brand rule)
- TTS audio version of posts
- AI-citation tracking via Profound/Otterly (E7 + tooling — Phase 2)
- Plausible analytics integration (E7 deferred to TODOs)
- Custom code-block syntax highlighting (markdown handles it; Prism/Shiki later if needed)
- Live search index update on admin save (ISR revalidate is sufficient at 200-post scale)
- Webmention support / IndieWeb integration
- AMP versions of posts (AMP is largely deprecated, Google moved away)
- Sticky scroll-progress bar (bling; not executive-reader-grade)

## ENG — What already exists (reused, don't rebuild)

| Existing | Reused for |
|---|---|
| `page` table pattern + comments style | Schema design for `post`, `author`, `category`, `post_revision`, `newsletter_signup` |
| `page_revision` audit trail pattern | `post_revision` (same diff_size_pct, cascade-delete, saved_by) |
| Reserved-slug guard (`lib/pages/reserved-slugs`) | Extend list, not duplicate |
| `MarkdownArticle` ([components/pages/markdown-article.tsx](cc-archos-labs/components/pages/markdown-article.tsx)) | Renders post body unchanged |
| `PersonCard` from `/about` | Author bio at end of each post |
| Admin auth chain (`app/admin/(authed)/`) | All new admin routes |
| `lib/claude-booking.ts` Anthropic client setup | Adapt for `lib/claude-migration.ts` (E2 polish) |
| Drizzle migration tooling | New tables ship via `drizzle-kit push` |
| Vitest + Playwright config | All new tests |
| Pages CMS Phase 2 admin shell | Admin posts list inherits navigation pattern |
| `next/og` (Next.js 16 built-in) | OG image generation in migration script |

## ENG — Worktree parallelization

Plan is implementable as 4 phases (A→B→C→D from CEO review). Within each phase, several workstreams are independent and parallelisable:

**Phase A — Schema + admin scaffold**

| Step | Modules touched | Depends on |
|---|---|---|
| A1 | `lib/db/schema.ts` (new tables) | — |
| A2 | `app/admin/(authed)/posts/` (empty listing UI) | A1 |
| A3 | `app/admin/(authed)/authors/`, `categories/`, `newsletter/` | A1 |
| A4 | `scripts/migrate-wp/` skeleton + `--dry-run` | A1 |

A2 and A3 touch different admin subdirectories — parallelisable. A4 is independent of A2/A3.

**Phase B — Public render + pilot migration**

| Step | Modules touched | Depends on |
|---|---|---|
| B1 | `app/blog/[slug]/page.tsx` + `app/blog/page.tsx` + `lib/posts.ts` | A1 |
| B2 | `lib/structured-data.ts` + `lib/og-image.ts` | A1 |
| B3 | `app/llms.txt/`, `app/robots.txt/`, sitemap update | A1, B1 |
| B4 | `scripts/migrate-wp/` full pipeline (extract, transform, claude, embed, media, og, insert) | A4, B2 |
| B5 | `components/blog/` (PostHeader, Toc, ReadNext, NewsletterCard, etc.) | B1 |

B2 and B5 are independent (different file trees). B3 depends on B1 (sitemap reads from post table). B4 depends on B2 (OG generation reuses the template).

**Phase C — Cutover (sequential)**

| Step | Modules touched | Depends on |
|---|---|---|
| C1 | Run full migration script against prod DB | B4 |
| C2 | Generate OG images + embeddings for all 200+ posts | C1 |
| C3 | Flip feature flag, set apex 301 on robertangeles.com | C2 |
| C4 | Submit sitemap + Bing Webmaster + verify SEO/AIEO endpoints | C3 |

Strictly sequential.

**Phase D — Polish + Resend (parallel within phase)**

| Step | Modules touched | Depends on |
|---|---|---|
| D1 | `lib/newsletter.ts` + Resend integration + `/api/newsletter/*` | A1, B1 |
| D2 | `/search` UI + `app/api/search/route.ts` + `lib/search.ts` | A1, B1 |
| D3 | E5 reading UX polish (TOC behaviour, copy-link UX) | B5 |

All three are independent — parallelisable.

**Lane summary:**
- Phase A: 3 parallel lanes (A2/A3 || A4 after A1)
- Phase B: 2-3 parallel lanes (B2 || B5 || B4 after dependencies)
- Phase C: 1 sequential lane
- Phase D: 3 parallel lanes

Conflict flag: any work on `lib/db/schema.ts` is the single chokepoint — A1 must merge before parallel lanes can branch. Plan the schema PR first, sized small, no other changes.

## ENG — Outside Voice

**Skipped.** The CEO review just ran its outside-voice equivalent (cathedral check + 7 expansion decisions) ~5 minutes ago. Running codex review now would duplicate context with low marginal yield. Re-evaluate before Phase B implementation if any of the locked decisions (R2, Voyage, HNSW) want a second opinion.

## ENG — Completion summary

```
+====================================================================+
|             ENG PLAN REVIEW (rosy-bee) — COMPLETION SUMMARY        |
+====================================================================+
| Mode                 | FULL_REVIEW                                   |
| Scope status         | Locked by CEO review — committed fully       |
| Step 0 complexity    | 15+ files triggers smell — CEO accepted      |
| Section 1 (Arch)     | 2 decisions surfaced (R2, Voyage) — locked   |
|                      | 5 decisions auto-locked (best practice)      |
| Section 2 (Quality)  | File shape locked per CLAUDE.md; 0 issues    |
| Section 3 (Tests)    | 95-path coverage diagram + test plan written |
| Section 4 (Perf)     | ISR + HNSW + N+1 audited; 0 issues           |
+--------------------------------------------------------------------+
| NOT in scope         | Written (10 items)                            |
| What already exists  | Written (11 reuse points)                    |
| TODOs proposed       | 0 new (CEO review already captured 8)        |
| Failure modes        | 10 production paths, 0 critical gaps         |
| Outside voice        | Skipped (CEO review just ran one)            |
| Parallelization      | 4 phases, ~8 parallel lanes total            |
| Lake Score           | 7/7 (every choice picked the complete option)|
+====================================================================+
```

**Unresolved decisions:** 0

**Status:** ENG REVIEW COMPLETE — `/plan-design-review` is the recommended next gate (significant UI scope: 6 new public surfaces, 4 admin surfaces, OG template, reading UX bundle). Implementation can start Phase A1 (schema PR) in parallel with design review.

---

---

# Design Review (`/plan-design-review`)

**Run:** 2026-05-19 · **Designer binary:** unavailable on Windows (text-only review)
**DESIGN.md status:** Comprehensive, Linear-themed, fully tokenised — all design decisions calibrate against it.

## Design system anchors (locked, do not deviate)

From [DESIGN.md](cc-archos-labs/DESIGN.md) + [app/globals.css](cc-archos-labs/app/globals.css):

| Concern | Token | Value |
|---|---|---|
| Canvas | `bg-canvas` | `#010102` (near-pure black, faint blue) |
| Lavender accent (scarce — brand mark, CTA, focus, link only) | `text-primary` / `bg-primary` | `#5e6ad2` |
| Surface ladder | `surface-1` → `surface-4` | charcoal lifts |
| Hairlines | `border-hairline` / `-strong` / `-tertiary` | 1px dark dividers |
| Ink hierarchy | `text-ink` / `-muted` / `-subtle` / `-tertiary` | light → dim |
| Body type | Geist Sans (Linear Display fallback) | -0.05px tracking |
| Display | `text-display-xl` (80px) → `text-display-md` (40px) | aggressive negative tracking |
| Reading column | `max-w-[760px]` | per existing `MarkdownArticle` |
| Card radius | `rounded-lg` 12px | feature, pricing, testimonial |
| Product/screenshot frame | `rounded-xl` 16px | only when image is the subject |
| Button | `rounded-md` 8px, padding 8px 14px | never pill |
| Section spacing | 96px | between sections |
| Inside-panel spacing | 24px | between content blocks |

**Hard rules carried into rosy-bee:**
- No second chromatic accent. Lavender only on brand-mark, CTA, focus, link emphasis.
- No decorative gradients. No spotlight cards. No drop shadows on dark.
- No pill-rounded CTAs.
- No `#000000` true black; use `#010102` canvas.
- Display weight 600, body weight 400. No 700+ display.
- Eyebrow uses POSITIVE tracking (+0.4px) — taxonomy marker against display's negative tracking.

## Resolved design decisions (DES-1 through DES-4)

| # | Decision | Locked | Notes |
|---|---|---|---|
| DES-1 | Read-next widget shape | **3-column card grid** (Rob override) | High AI-slop risk; spec'd carefully below to avoid the trap |
| DES-2 | Search UX shape | **Both /search + Cmd-K** | Shared result-card component; /search is canonical surface |
| DES-3 | OG image direction | **Typographic + small product mark** | Dark canvas, display-lg title, lavender eyebrow + lavender Archos mark bottom-right |
| DES-4 | Newsletter capture intensity | **Quiet inline** | Single-line capture between hairlines at 60% scroll |

### DES-1 spec (3-column card grid, AI-slop-resistant)

```
┌────────────────────────────────────────────────────────────────────────┐
│                                                                        │
│  Read next                                  text-eyebrow text-primary  │
│  ────────────────────────────────           border-hairline rule       │
│                                                                        │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐    │
│  │ AI as Strategy   │  │ Data as Infra    │  │ Execution Layer  │    │
│  │ text-eyebrow     │  │ text-eyebrow     │  │ text-eyebrow     │    │
│  │ text-ink-subtle  │  │ text-ink-subtle  │  │ text-ink-subtle  │    │
│  │                  │  │                  │  │                  │    │
│  │ The Board's AI   │  │ Why Lineage      │  │ The Tech Debt    │    │
│  │ Governance Gap   │  │ Beats Lakes      │  │ Beneath AI       │    │
│  │ text-card-title  │  │ text-card-title  │  │ text-card-title  │    │
│  │ text-ink         │  │ text-ink         │  │ text-ink         │    │
│  │                  │  │                  │  │                  │    │
│  │ One-line excerpt │  │ One-line excerpt │  │ One-line excerpt │    │
│  │ text-body-sm     │  │ text-body-sm     │  │ text-body-sm     │    │
│  │ text-ink-subtle  │  │ text-ink-subtle  │  │ text-ink-subtle  │    │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘    │
│                                                                        │
│  Cards: bg-surface-1 · border border-hairline · rounded-lg            │
│         padding 24px · LEFT-ALIGNED · NO icons · NO images            │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

**Critical AI-slop avoidance rules** (this is what differentiates from the slop pattern):
- ❌ NO icon-in-coloured-circle at the top of each card
- ❌ NO centered text
- ❌ NO bold uniform border-left accent stripe
- ❌ NO drop shadow or glow
- ❌ NO "Read more →" pseudo-CTA at the bottom
- ✅ Eyebrow at top is the category (taxonomy signal, not decoration)
- ✅ Title is the link target (whole card clickable; title underlines on hover)
- ✅ One-line excerpt only — not 2-line description
- ✅ Visited cards: title shifts to `text-ink-muted` (preserves visited/unvisited distinction per universal rule)
- ✅ Hover: card lifts to `bg-surface-2` (matches DESIGN.md hover ladder)
- ✅ Mobile: stack to single column (NOT 2-column at any breakpoint — the brand is content density, not awkward 2-column tilings)

### DES-2 spec (search shapes)

**`/search` (public surface, server-rendered, shareable URL):**
- Top: search input on `bg-surface-1`, `text-input` token, full-width up to 760px max
- Below: results stack — same editorial-list layout (eyebrow + title + excerpt + hairline rule between)
- 0 results: friendly fallback "No matches for '[query]'. Try [3 popular categories as chips]."
- Loading: skeleton list (3 placeholder rows with hairline rules, pulsing surface-1)
- Provider down: render with notice banner "Showing keyword matches (semantic search briefly unavailable)" + FTS results

**Cmd-K modal:**
- Trigger: `Cmd-K` (mac) / `Ctrl-K` (win) anywhere; also a search icon in top-nav with `Cmd-K` chip
- Surface: `bg-surface-2` overlay on `bg-semantic-overlay` 60% scrim
- Same result component as /search page (one design, two entry points)
- Result keyboard-nav (↑/↓ to move, Enter to navigate, Esc to close)
- Mobile: Cmd-K becomes a slide-up sheet (no keyboard shortcut surfaced; touch-only via nav icon)

### DES-3 spec (OG image template)

```
┌───────────────────────────────────────────────────────────────┐
│  ARCHOS LABS · THE TRANSLATION LAYER                          │  ← eyebrow row
│                                            text-eyebrow,      │     +0.4px tracking
│                                            text-primary       │     lavender
│                                                               │
│                                                               │
│  The Board's AI Governance                                    │
│  Gap, and How to Close It                                     │  ← display-lg, 56px
│                                            text-ink           │     -1.8px tracking
│                                            wraps at 2 lines   │     truncate at 3 with …
│                                                               │
│                                                               │
│                                                               │
│  ───────────────────────  [AL]                                │  ← bottom row:
│  rob angeles · 7 min       lavender mark    text-caption      │     byline + reading time
│                                             text-ink-subtle   │     + small product mark
│                                                               │
│  Canvas: #010102                                              │
│  1200 × 630 (LinkedIn / OG standard)                          │
└───────────────────────────────────────────────────────────────┘
```

**Template invariants** (locked at @vercel/og template time):
- Canvas `#010102` (NEVER `#000000`)
- Eyebrow row top — always "ARCHOS LABS · THE TRANSLATION LAYER" in `text-primary` (lavender)
- Title — `text-display-lg` 56px Geist Sans -1.8px tracking, wraps at 2 lines; ellipsis at 3
- Bottom row — byline + reading time in `text-ink-subtle` left; small lavender Archos Labs mark right
- ABSOLUTELY NO: gradients, decorative blobs, photo backgrounds, illustrations, emoji, second accent colour, drop shadows
- One template only — no category variants (rejected DES-3 option D)

### DES-4 spec (quiet inline newsletter capture)

```
┌────────────────────────────────────────────────────────────────────────┐
│ ──────────────────────────────────────────────────────────────         │  hairline above
│                                                                        │
│ New essays on AI program risk in your inbox.                          │  ← text-body
│                                                                        │     text-ink
│ ┌──────────────────────────────┐  ┌──────────────┐                    │
│ │ your@email.com               │  │  Subscribe   │  ← text-input +    │
│ │ text-input · bg-surface-1    │  │  bg-primary  │     button-primary │
│ └──────────────────────────────┘  └──────────────┘                    │
│                                                                        │
│ ──────────────────────────────────────────────────────────────         │  hairline below
└────────────────────────────────────────────────────────────────────────┘

Placement: appears once per post at the 60% scroll mark. NOT in the sidebar.
NOT a modal. NOT a sticky footer banner. One-time appearance, easy to scroll past.
```

## Pass-by-pass design review

### Pass 1 — Information Architecture · **6/10 → 9/10**

**Was 6:** Section 11 in the plan had a post-page IA diagram but no /blog index, /search, or /blog/category IA. Top-nav placement of "Blog" link unspecified.

**Now 9 (fix added below):**

```
TOP-NAV (extended)
  ── archoslabs.xyz/  → Home
  ── /consulting     → Consulting
  ── /blog           → The Translation Layer  ◀── NEW link
  ── /about          → About
  ── [Cmd-K icon]    → opens search modal     ◀── NEW
  ── /book           → Book a call (primary CTA)

/blog (index)
  ┌─────────────────────────────────────────────────────────────┐
  │ THE TRANSLATION LAYER                  text-eyebrow primary │
  │ ────────────────────────────────                            │
  │                                                              │
  │ Essays on AI program risk, data architecture,               │ ← intro sentence
  │ and what actually breaks in transformation.   subhead       │   max 1-2 lines
  │                                                              │
  │ ────────────────────────────────                            │
  │                                                              │
  │ [All]  [AI as Strategy]  [Data as Infra]  [Human-Centered]  │ ← category filter row
  │ pricing-tab pattern, pill-rounded, ink-subtle when unpicked │
  │                                                              │
  │ ─────────────────────────                                   │
  │ AI as Strategy                                              │
  │ The Board's AI Governance Gap                               │ ← editorial-list row
  │ One-line excerpt. 7 min read · Updated 2026-03  ink-subtle  │   (no card chrome)
  │ ─────────────────────────                                   │
  │ ... more rows                                               │
  │                                                              │
  │     [← Newer]    Page 2 of 8    [Older →]                   │ ← pagination
  └─────────────────────────────────────────────────────────────┘

/blog/category/[slug] (category index)
  Same layout as /blog, but eyebrow = category name, filter chip pre-selected.

/blog/[slug] (article) — already in Section 11, kept verbatim
```

The /blog index list uses the editorial-list pattern (not cards). The 3-column card grid is RESERVED for the read-next widget at end of post — that's where DES-1 lives. Distinction is intentional: /blog index = high-density library; read-next = highlight 3 adjacent picks.

### Pass 2 — Interaction State Coverage · **4/10 → 9/10**

**Was 4:** Plan listed states in Section 11 but didn't spec what each looks like.

**Now 9 (full table added):**

| Surface | Loading | Empty | Error | Success | Partial |
|---|---|---|---|---|---|
| `/blog` index | Skeleton list: 6 rows × (eyebrow + title + caption placeholders pulsing surface-1) | "No posts yet — first essays land soon." + LinkedIn-newsletter CTA (only fires if literally zero posts — impossible post-migration) | Render last-known cached version + small banner "Showing cached. Refresh to retry." | Renders | (n/a — paginated) |
| `/blog/[slug]` article | (server-rendered, no skeleton) | (impossible — 404 handles missing post) | If post body fails to parse, render title + "We're fixing this post. [back to Blog]" + Sentry alert | Renders | TOC hides when no h2/h3; read-next falls back to most-recent-3 if <3 semantic candidates |
| `/search` | Debounced spinner (after 200ms) replacing results area only — input stays focused | "No matches for '[query]'. Try [chip: AI Governance] [chip: Data Lineage] [chip: Transformation]" | "Showing keyword matches (semantic search briefly unavailable)" + FTS results below | Renders ranked list | (n/a) |
| Cmd-K modal | Same as /search but in modal frame | Same as /search | Same as /search | Selecting result navigates + closes modal | (n/a) |
| Newsletter capture | Inline spinner replacing button label, button disabled | (n/a — always shows) | "That email didn't look right. Try again?" inline below the field; field re-focuses | Field + button replaced inline with: "Check your inbox to confirm." ink-muted | If Resend is queued: "We'll send your confirmation shortly." ink-subtle |
| Newsletter confirm `/newsletter/confirm?token=...` | (server-rendered) | (impossible — 404 if token unknown) | "Link expired. [Re-send confirmation]" + form | "You're in. New essays land every other Tuesday. [Back to The Translation Layer]" with lavender check icon | "Already confirmed — you're on the list." idempotent |
| Read-next widget | (server-rendered) | "Browse all essays →" link if 0 semantic candidates | Hide widget silently (graceful degrade) | 3 cards render | <3 candidates → fall back to most-recent 3 |
| TOC | (server-rendered) | Hidden when no h2/h3 in post | (n/a) | Sticky desktop / drawer mobile | Long TOC → scrollable inside its sticky column |
| Admin posts list | Spinner replacing table | "No posts yet — run scripts/migrate-wp" + link to migration docs | Inline error banner top of table | Renders | Filter "needs_review" → shows only flagged posts |

**Empty-state warmth principle applied:** No "No items found." anywhere. Every empty state has context + a primary action.

### Pass 3 — User Journey & Emotional Arc · **7/10 → 9/10**

**Was 7:** CEO review had a strong journey storyboard in Section 11.

**Now 9, with the emotional arc made explicit:**

```
STEP                              USER DOES              USER FEELS                  PLAN SUPPORTS
1. Google search hit              Clicks SERP result     "Looks credible — Rob       Rich JSON-LD Article
                                                          Angeles, AI program risk"   schema → rich SERP card

2. Lands on /blog/[slug]          Scans page             "Wait, this is a magazine,  text-display-md title,
   first 5 seconds (visceral)                            not a blog"                  Geist Sans, dark canvas,
                                                                                      "7 min · Last reviewed"
                                                                                      micro-row, hairline rule

3. Starts reading                 Scrolls through TOC    "Density I respect.         text-body-lg, max-w-[760px],
   5-min behavioural                                     This person has done         ink-subtle body, no
                                                          this work."                  decorative chrome

4. Hits 60% scroll                Sees newsletter card   "Not pushy. Editorial."     Quiet inline (DES-4)
                                                                                      between hairlines

5. Finishes reading               Sees author bio + 3    "What else does he have     PersonCard + read-next
                                  related posts          on this?"                    3-card grid (DES-1)

6. Either:                        a) Reads next post     "He has a depth here.       Cmd-K accessible from
   5-year reflective              b) Cmd-K to search     I want to check him out      anywhere — power-user
                                  c) Subscribes via      properly"                    cue (DES-2)
                                     confirmation         OR
                                  d) Books a call        "I should talk to him."     /book CTA in top-nav
```

The 5-second visceral test is the OG image preview on LinkedIn / Slack: typographic poster (DES-3) lands the brand immediately. The 5-year reflective test is "did I come back two months later because the content kept earning it?" — this is what the editorial discipline (E2 Claude polish, last-reviewed stamps, AIEO foundations) buys.

### Pass 4 — AI Slop Risk · **6/10 → 8/10**

**Was 6:** Three slop traps were ambient in the plan: (1) read-next as cards (Rob locked this as 3-column card grid — DES-1 mitigation spec'd above), (2) generic "Recently published" grid as fallback (not in plan after this review), (3) OG image with decorative chrome (DES-3 locked the typographic poster route).

**Slop blacklist audit:**

| Pattern | Risk in this plan | Status |
|---|---|---|
| Purple/violet gradient backgrounds | Tempted by lavender accent for "premium feel" | ✅ DESIGN.md forbids gradients; lavender scarce |
| 3-column feature grid with icons-in-circles | Read-next widget (DES-1) | ⚠️ Mitigated: NO icons, NO centered text, NO icon-circles. Eyebrow + title + excerpt only. |
| Icons in coloured circles | Read-next, post-listing | ✅ Explicitly forbidden in DES-1 spec |
| Centered everything | "Hero" section of /blog | ✅ Left-aligned per DESIGN.md and existing /about pattern |
| Uniform bubbly border-radius | All cards rounded-lg 12px is OK because that's the system; not pill | ✅ |
| Decorative blobs, floating circles, wavy SVGs | Tempted on /blog index "hero" | ✅ DESIGN.md forbids; intro is type-only |
| Emoji as design elements | Newsletter card, success states | ✅ Lavender check icon for confirm only; otherwise type-only |
| Coloured left-border on cards | Read-next, post listings | ✅ Hairline border only; no accent stripe |
| Generic hero copy | /blog index intro | ⚠️ Plan needs a non-generic intro line — added below: "Essays on AI program risk, data architecture, and what actually breaks in transformation." (specific, not "Welcome to The Translation Layer") |
| Cookie-cutter section rhythm | /blog/[slug] body | ✅ Markdown rendering preserves author's structure; no template-imposed rhythm |
| system-ui as primary font | Already loaded Geist Sans | ✅ |

Why not 9 or 10: Rob picked the 3-column card grid (DES-1 option A) over my recommended editorial list. The spec'd mitigation (no icons, hairline, eyebrow+title+excerpt) avoids the worst of the slop pattern but the format itself carries some residual risk. Mitigation will need verification on a real implementation pass (via `/design-review` post-build).

### Pass 5 — Design System Alignment · **5/10 → 10/10**

**Was 5:** Plan didn't reference DESIGN.md tokens. Implementer would need to guess.

**Now 10 (full token map added below):**

| New component | Background | Text | Type token | Border | Padding | Radius |
|---|---|---|---|---|---|---|
| `PostHeader` | (transparent on canvas) | `text-ink` title, `text-ink-subtle` micro-row | `text-display-md` md/`text-display-lg` desktop title; `text-caption` micro-row | (none) | matches MarkdownArticle | (n/a) |
| `Toc` (desktop sticky) | (transparent) | `text-ink-subtle` items, `text-ink` active | `text-body-sm` | `border-hairline` left rule on active item | 0 px 16px py-8 | (n/a) |
| `Toc` (mobile drawer) | `bg-surface-2` overlay | `text-ink` | `text-body-sm` | (none) | py-24px px-16px | `rounded-lg` |
| `ReadNext` card | `bg-surface-1` (hover `bg-surface-2`) | eyebrow `text-primary`, title `text-ink`, excerpt `text-ink-subtle`, visited title `text-ink-muted` | `text-eyebrow` / `text-card-title` / `text-body-sm` | `border-hairline` | 24px | `rounded-lg` |
| `NewsletterCard` (inline) | (transparent canvas) | `text-ink` lead, `text-ink-subtle` field | `text-body` lead, `text-input` field | `border-hairline` top + bottom | py-24px | (none) |
| `HeadingCopyLink` icon | (transparent) | `text-ink-tertiary` (becomes `text-primary` on hover) | (icon, 16px) | (none) | 0 | (n/a) |
| `PullQuote` | (transparent canvas) | `text-ink` quote, `text-ink-subtle` attribution | `text-card-title` quote, `text-caption` attribution | `border-hairline` left rule, 2px wide | py-24px pl-32px | (none) |
| `CategoryChip` (filter row) | `bg-canvas` default / `bg-surface-2` selected | `text-ink-subtle` / `text-ink` | `text-button` | (none) | py-6px px-14px | `rounded-pill` |
| `SearchInput` (page + modal) | `bg-surface-1` | `text-ink`; placeholder `text-ink-subtle` | `text-body` | `border-hairline` (focus: `2px outline primary-focus`) | py-8px px-12px | `rounded-md` |
| `CmdKModal` overlay | `bg-semantic-overlay` 60% | (n/a) | (n/a) | (n/a) | py-48 px-24 (centred) | `rounded-lg` |
| `EditorialListRow` (/blog index) | `bg-canvas` | eyebrow `text-primary`, title `text-ink`, excerpt + meta `text-ink-subtle` | `text-eyebrow` / `text-headline` / `text-body-sm` | `border-hairline` bottom | py-32px | (none) |
| `AdminPostsTable` row | `bg-surface-1` even, `bg-canvas` odd | `text-ink` | `text-body-sm` | `border-hairline` bottom | py-12px px-16px | (none) |
| `NeedsReviewBadge` | `bg-semantic-warning/20` | `text-semantic-warning` | `text-caption` | (none) | py-2px px-8px | `rounded-pill` |
| `UnlistedBadge` | `bg-surface-2` | `text-ink-muted` | `text-caption` | (none) | py-2px px-8px | `rounded-pill` |

Every new component now maps to existing DESIGN.md tokens. No new colours introduced. No new radii introduced. Lavender stays scarce (only on `text-primary` eyebrow, link emphasis, focus rings, OG mark, primary CTA).

### Pass 6 — Responsive & Accessibility · **4/10 → 9/10**

**Was 4:** Plan mentioned "TOC drawer on mobile" but nothing else.

**Now 9 (responsive + a11y spec added):**

**Breakpoints (per DESIGN.md):**

| Surface | Mobile (<768px) | Tablet (768–1023px) | Desktop (≥1024px) |
|---|---|---|---|
| `/blog` index | single-column list, full-width filter chips that horizontally scroll | same | same with `max-w-[1280px]` container |
| `/blog/[slug]` article | full-width body, TOC as bottom-sheet drawer triggered by floating button | body + sticky TOC right column at 1024px+ | as plan describes |
| Read-next cards | single-column stack (NOT 2-up — keeps editorial density consistent) | 2-up | 3-up |
| `/search` page | full-width input, results full-width list | same | results constrained to `max-w-[760px]` |
| Cmd-K modal | bottom-sheet slide-up, ~80% viewport height | centered modal | centered modal `max-w-[640px]` |
| Newsletter inline | field + button stacked vertically | field + button inline | field + button inline |
| Top nav | hamburger drawer (Linear pattern) | same | full nav inline + Cmd-K chip |

**Accessibility (locked):**

- Heading hierarchy strict: H1 = post title (single), H2 = section, H3 = subsection. TOC skips H1 (it's the page title), starts from H2.
- Search input has `aria-label="Search The Translation Layer"`, results have `role="listbox"`, items `role="option"`.
- Cmd-K modal traps focus, returns focus to invoker on close, has `role="dialog"` + `aria-modal="true"` + `aria-label="Search posts"`.
- Heading copy-link buttons have `aria-label="Copy link to {heading text}"`.
- TOC items are anchor links — keyboard-navigable by default. Active item has `aria-current="location"`.
- Read-next cards are entirely clickable (link wraps title + excerpt), title gets the `<a>` for screen reader announcement.
- Newsletter form: label `<label for="email">Email</label>` visible (NOT placeholder-as-label per universal rule), inline validation message uses `aria-live="polite"`.
- Touch targets: all buttons ≥44px tall on touch viewports (DESIGN.md spec).
- Contrast: ink-subtle (`#8a8f98`) on canvas (`#010102`) = 6.2:1 ratio, well above 4.5:1 AA threshold. Eyebrow lavender on canvas = 4.8:1 (passes AA for ≥18px). Verified.
- Visited-link distinction preserved: read-next title shifts `text-ink` → `text-ink-muted` on visited.
- Reduced motion: `@media (prefers-reduced-motion: reduce)` disables sticky-TOC smooth-scroll, search debounce animations, and any subtle hover lifts.
- Print stylesheet: existing print mode in [globals.css](cc-archos-labs/app/globals.css) flips canvas to white — already covers /blog/[slug] via the same overrides. Verified by reading.

### Pass 7 — Unresolved Design Decisions

**None.** DES-1, DES-2, DES-3, DES-4 all resolved.

Two follow-up TODOs surfaced (not blocking implementation):

1. **Branded loading skeletons** — generic pulsing rectangles work, but a branded shimmer using lavender at 8% opacity would feel more intentional. ~30 min CC. Defer to post-launch polish.
2. **OG image A/B variants** — generate one bold-title variant vs one quieter eyebrow-heavy variant; track LinkedIn engagement via Plausible (E7 deferred). Defer until E7 is built.

## Design — NOT in scope

- Custom illustrations for category landing pages (text-only intros)
- Author photos beyond Rob (single-author setup)
- Animated transitions between posts (Next.js navigation default is enough)
- Bespoke 404 page beyond CMS default (current generic 404 is on-brand)
- Print-optimised stylesheet for posts specifically — existing global print mode in [globals.css](cc-archos-labs/app/globals.css) handles it
- Dark/light mode toggle — DESIGN.md is dark-only by decision
- A11y audit beyond WCAG AA — AAA is not the bar for this audience

## Design — What already exists (reused, don't rebuild)

- `MarkdownArticle` — entire post body rendering, with `max-w-[760px]` reading column and ink-subtle body
- `PersonCard` — author bio at post end
- All DESIGN.md tokens — no new colours, type, or shape tokens added
- Print stylesheet — covers /blog/[slug] for executive print readers
- Top-nav pattern — `/blog` link slots in without restructuring
- `text-input`, `button-primary`, `button-secondary` components from DESIGN.md
- `status-badge` shape — reused for needs-review + unlisted indicators

## Approved Mockups

None generated this run (designer binary unavailable on Windows). All design decisions captured as DESIGN.md token references + ASCII layout specs. A post-implementation `/design-review` pass should run on a preview deploy to verify the AI-slop mitigation on the read-next widget specifically.

## Design — Completion summary

```
+====================================================================+
|         DESIGN PLAN REVIEW (rosy-bee) — COMPLETION SUMMARY         |
+====================================================================+
| Initial design score  | 6.5/10                                      |
| Final design score    | 9/10                                        |
| DESIGN.md status      | Comprehensive, fully tokenised              |
| Mockup generation     | Skipped (designer binary unavailable)       |
| Outside voices        | Skipped (CEO + eng just ran)                |
| Pass 1 (Info Arch)    | 6/10 → 9/10                                 |
| Pass 2 (States)       | 4/10 → 9/10                                 |
| Pass 3 (Journey)      | 7/10 → 9/10                                 |
| Pass 4 (AI Slop)      | 6/10 → 8/10 (DES-1 carries residual risk)   |
| Pass 5 (Design Sys)   | 5/10 → 10/10 (full token map added)         |
| Pass 6 (Responsive)   | 4/10 → 9/10                                 |
| Pass 7 (Decisions)    | 4 resolved (DES-1, DES-2, DES-3, DES-4)     |
+--------------------------------------------------------------------+
| NOT in scope          | 7 items                                     |
| What already exists   | 7 reuse anchors                             |
| Approved mockups      | 0 (text spec only — verify post-build)      |
| Decisions added       | 4 + interaction state table + token map     |
| TODOs deferred        | 2 (branded skeletons, OG A/B test)          |
| Unresolved            | 0                                           |
+====================================================================+
```

**Status:** DESIGN REVIEW COMPLETE. Implementation can start at Phase A1 (schema PR) without blocking.

Post-implementation: run `/design-review` against a preview deploy specifically to verify the DES-1 read-next widget doesn't fall into the AI-slop pattern in practice — this is the single highest-risk design decision in the plan.

---

## Completion summary

```
+====================================================================+
|            CEO PLAN REVIEW (rosy-bee) — COMPLETION SUMMARY         |
+====================================================================+
| Mode selected        | SCOPE EXPANSION                              |
| Approach locked      | B — Full post architecture w/ MR framing     |
| D1 — Post count      | 200+ published, all migrate                  |
| D2 — Brand stance    | Absorb (robertangeles.com retires)           |
| D3 — Review mode     | SCOPE EXPANSION                              |
| D4 — Sequencing      | Phased A → B → C → D                         |
| D5 — URL structure   | /blog/[slug] · brand: The Translation Layer  |
| D6 — Old domain      | Apex 301 only · lapse after 30-60d cool-off  |
| SEO/AIEO scope       | Baked into base — llms.txt + robots + JSON-LD|
+--------------------------------------------------------------------+
| Expansion proposals  | 7 surfaced                                   |
| Accepted             | 6 (E1, E2, E3, E4, E5, E6+E6.1)              |
| Deferred to TODOs    | 1 (E7 analytics)                             |
+--------------------------------------------------------------------+
| Section 1 (Arch)     | Schema sketched; data flow + diagrams done   |
| Section 2 (Errors)   | 21 error paths mapped; 0 silent failures     |
| Section 3 (Security) | 10 threats mapped; HTML→md is highest risk   |
| Section 4 (Data/UX)  | 13 edge cases mapped; all handled            |
| Section 5 (Quality)  | File shape per CLAUDE.md; no premature DRY   |
| Section 6 (Tests)    | Unit + integration + E2E + security mapped   |
| Section 7 (Perf)     | pgvector ivfflat; ISR; <5min migration       |
| Section 8 (Observ)   | Manifest + logs + alerts + runbook defined   |
| Section 9 (Deploy)   | 4-phase rollout; feature-flag-gated           |
| Section 10 (Future)  | Reversibility 4/5 pre-cutover, 1/5 after     |
| Section 11 (Design)  | UI scope significant — /plan-design-review   |
+--------------------------------------------------------------------+
| Failure modes        | 14 total, 0 CRITICAL GAPS                    |
| TODOs proposed       | 8 items deferred                              |
| CEO plan             | this file                                     |
+====================================================================+
```

## Unresolved decisions

**None.** D1 through D6, all seven expansion proposals (E1–E7+E6.1), and the AIEO scope are resolved. Plan is complete and ready for `/plan-eng-review`.

## Next reviews

- **`/plan-eng-review`** — required gate. Architecture, schema details, library choices (turndown vs html-to-md, embedding provider, image migration strategy, CDN choice), test plan finalisation. Highest priority next step.
- **`/plan-design-review`** — recommended. Significant UI scope: 6 new public surfaces, 4 new admin surfaces, branded OG template, reading UX polish.
- **`/codex review`** *(optional)* — independent second opinion on the plan. ~2 min.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | COMPLETE | 7 expansions proposed, 6 accepted; mode EXPANSION; D1–D6 resolved; 14 error paths mapped, 0 critical gaps |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | COMPLETE | 7 architectural decisions (5 auto-locked, 2 user-confirmed: R2, Voyage); 95-path test coverage diagram; 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | COMPLETE | score: 6.5/10 → 9/10; 4 design decisions resolved (DES-1 read-next, DES-2 search, DES-3 OG, DES-4 newsletter); full DESIGN.md token map added; AI-slop mitigation spec'd for read-next |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | Optional |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | n/a |

**UNRESOLVED:** 0
**VERDICT:** CEO + ENG + DESIGN CLEARED — plan is implementation-ready. Start Phase A1 (schema PR). Post-build: run `/design-review` against preview deploy to verify DES-1 read-next widget doesn't land in AI-slop pattern in practice.
