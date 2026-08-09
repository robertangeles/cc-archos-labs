---
title: Positioning consolidates on "Fractional Semantic Data Expert"
category: decision
created: 2026-08-10
updated: 2026-08-10
related: [[2026-07-12-seo-crawl-not-indexed-hygiene]], [[deployment-architecture]]
---

Rob's public title becomes "Fractional Semantic Data Expert" everywhere the site
sells, while past-tense biography keeps describing the work rather than claiming
the new title retroactively.

## What was actually wrong

The site was not carrying one positioning with one stale string in it. It was
carrying six competing self-descriptions:

| Surface | String before |
| --- | --- |
| Home `<title>` | Your Fractional Data **Team** for Startups & SMBs |
| About `<title>` | Rob Angeles, Fractional Data **Architect** |
| Consulting `<title>` | Fractional Data **& AI Consulting** for Startups |
| `Service` name (×2 files) | Fractional Data **Leadership** |
| `FOUNDER_JOB_TITLE` in JSON-LD | **Principal Consultant** |
| PROD `site_setting.description` | Get a **fractional data architect** |

`FOUNDER_JOB_TITLE` already existed precisely to stop this drift — see the
comment block in `lib/schema-graph.ts`, which records three earlier conflicting
titles. It had drifted again anyway, because the constant only governs the
JSON-LD `Person` node and nothing forces page titles to agree with it.

Google resolves an entity more confidently against one repeated `jobTitle` than
several competing ones, so the consolidation is the point — not the wording.

## The rule: change what you sell, keep what you did

Renaming every occurrence of "data architect" would have been wrong in two
distinct ways.

**It would have falsified the CV.** "I've been the data architect on programs
with eight-figure budgets" is the proof that makes the positioning credible. A
reader who checks LinkedIn and finds a title that never existed loses trust in
everything else on the page. Biography prose was therefore reframed to describe
*the work* — "led the semantic and data architecture" — which is true, supports
the new positioning, and claims no title Rob did not hold.

**It would have corrupted the CDMP exam.** "Data Architecture" is a DAMA-DMBOK
knowledge area, and `lib/cdmp/config-shared.ts` uses it as an exam topic label.
Renaming it makes the practice exam factually wrong about the certification it
prepares people for. Same for editorial taxonomy and Model Studio audience copy.

Of 32 "data architect" hits in the codebase, only ~8 were positioning.

## SEO cost, accepted deliberately

"Fractional data architect" and "fractional data team" have real search volume.
"Semantic Data Expert" is a coined category with effectively none. This trades
discoverable keywords for an uncontested term — a legitimate brand play, but a
measurable SEO cost on the highest-value strings on the site. Flagged before the
change; Rob chose it knowingly.

Two title-hygiene fixes rode along because the longer term forced a retitle:
the homepage dropped the leading "Your" (a function word in the highest-weight
position) and gained "Melbourne" (absent from every title despite local intent
and a `PostalAddress` schema saying Melbourne). All three titles land at 54–58
characters, inside the ~60 / ~580px SERP budget.

## The blog masthead had gone false

Separately, `/blog` claimed to be "the only AI newsletter written by someone who
has broken these programs from the inside". Metis drafts the posts now, so the
claim had quietly become untrue.

The replacement had to survive `lib/blog/byline.ts`, which exists to stop
exactly this class of over-claim: `showsDualByline` gates on
`isAgentGenerated && reviewedByHumanAt`, because ~120 WordPress-migrated posts
are human-written and the single `author` row cannot tell them apart. A masthead
saying "written by Metis" over-claims in the opposite direction. The shipped copy
uses that module's vocabulary — *Researched by Metis · Reviewed by Rob Angeles* —
so the header, the byline, and the Article JSON-LD assert the same two facts.

## Left open

- **Metis is typed `"@type": "Person"`** in `metisNode()`. Defensible while the
  page never said Metis was an AI; the page now says "an AI research agent I
  built". `lib/blog/byline.ts` sets the standard itself: structured data that
  contradicts the visible page is worse than none. The node is `@id`-referenced
  as `author` across every Article, and schema.org has no clean AI-agent type,
  so retyping it is a real decision rather than a quick fix.
- **`/tools/ai-readiness` claims a "practitioner-written report"** while the
  report is LLM-generated. Same class of claim as the blog masthead.
- **`scripts/migrate-wp/llms-txt.ts` still says "By Rob Angeles"** — reachable
  only from the one-off WordPress migration, not the live site.

## Code cannot finish this change

`site_setting.description` is a DB row, not a constant. `SITE_DEFAULTS` in
`lib/site-config-shared.ts` is only the fallback used when no row exists, so
merging this PR does not change what PROD serves. That row feeds the
`Organization` and `WebSite` JSON-LD, the global OG card, and `llms.txt` — it is
an entity-level claim, and on 2026-08-10 it still read "Get a fractional data
architect".

The same is true of the Metis author bio: `scripts/seed/blog-author-backfill.ts`
and `scripts/update-author-bio.mjs` both hardcode it, and the seed's own header
warns that drift between them silently reverts the live byline. Editing the
scripts changes nothing until `update-author-bio.mjs --apply` runs.

DEV and PROD held three different values for `description` and two for `tagline`
while this work was underway. Check the `DATABASE_URL` host before believing any
claim about which one you are looking at.
