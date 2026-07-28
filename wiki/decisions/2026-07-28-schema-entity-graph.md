---
title: One entity graph with stable @ids, and a byline that has to be true
category: decision
created: 2026-07-28
updated: 2026-07-28
related: [[2026-07-12-seo-crawl-not-indexed-hygiene]], [[translation-layer]], [[deployment-architecture]]
---

Structured data across the site was consolidated into a single `@graph` with stable `@id`s, and the blog byline now credits a human reviewer only where one actually reviewed the post.

## Trigger

A FAT audit (fat-agent-skill) reported 15 findings. **Ten were wrong.** Verified against live production before any code was written: JSON-LD was already present on every page (6 blocks on `/`), `/login` and `/sign-in` both returned 200, sitemap and robots were reachable, breadcrumbs already shipped, and the logo's `alt=""` was correct WCAG that the audit wanted to "fix". It also assumed Vercel and prescribed `vercel.json`; the site runs on Render behind Cloudflare.

The lesson is not "that tool is bad" — it is that an audit which cannot fetch the site will still produce confident findings. **Verify every external finding against live prod before planning work.**

## What was actually wrong

Five audit findings survived, plus three the audit missed entirely:

- **Stored XSS.** Four pages emitted admin-editable text into `<script>` via bare `JSON.stringify`, violating the rule set in [[2026-07-12-seo-crawl-not-indexed-hygiene]]. Only the layout and the blog post route had ever been converted to `jsonLdScript()`.
- **Every admin save nulled `last_reviewed_at`.** The form omits the key, `normalisePostInput` collapsed `undefined` to `null`, and `updatePost` wrote it — so a human edit reverted the post's freshness date across `dateModified`, `article:modified_time`, sitemap `lastmod` and llms.txt.
- **The Organization schema said Sydney.** Every user-facing surface says Melbourne.

## Decisions

**Entity graph.** Nodes are declared once, in `app/layout.tsx`'s `@graph`, with `@id`s from `lib/schema-graph.ts`. Everything else references them. Before this, `/about` declared a second `Person` and every blog post declared a third plus its own inline `Organization`, with three different job titles — Google had no basis to conclude they described one business.

`SCHEMA_IDS` hardcodes the production origin rather than `getSiteUrl()`. An `@id` is an identifier, not an address; deriving it from the running host would mint different identities per environment.

**`sameAs` is split by entity.** `lib/social-links.ts` was labelled "founder identity links" but contained `x.com/archoslabsxyz`, the brand account. Feeding it into the founder's `sameAs` asserts Rob Angeles and Archos Labs are one entity — the exact fragmentation the graph removes.

**Blog posts resolve to `#metis`, never the founder.** There is one row in `author` and the seed backfill renamed it "Metis", so `post.authorName` cannot resolve to Rob. A founder branch keyed on the name would be unreachable code.

**The byline gate is a conjunction: `is_agent_generated AND reviewed_by_human_at`.** The timestamp alone proves review, not authorship. Gating on it alone would let a WordPress-migrated post render "Researched by Metis" over writing Metis never touched. One predicate — `showsDualByline()` — feeds both the visible byline and the Article schema, because structured data contradicting the page is worse than none.

Read the predicate as *"the resolved author is Metis AND a human reviewed it"*. It collapses to `isAgentGenerated` only because there is a single author row. If real author rows appear and authorship becomes reassignable, switch the first term to the resolved author identity.

## Known and deliberately not fixed

- **The seed backfill collapsed every author into one "Metis" row**, so the ~120 WordPress-migrated posts are misattributed on their face, independent of any of this. Needs its own change.
- **FAQ rich results.** The `/consulting` FAQPage markup is valid and its answers match the rendered copy, but Google restricted FAQ SERP snippets to government and health sites in 2023. It will not produce a visible rich result — it helps LLM citation only.
- **Cross-script `@id` merging** is Google's documented technique, not a spec guarantee. The `curl` checks prove the `@id`s are present and consistent; they do not prove Google's parser merges them. Worth one Rich Results Test pass.

## Shipped

PR #220 hygiene + security · #221 entity graph · #222 cache invalidation · #223 conditional byline.

Migration 0037 (`post.reviewed_by_human_at`, additive, nullable, no index) **must be applied to PROD by hand** — there is no migrate-on-deploy hook. See [[deployment-architecture]].
