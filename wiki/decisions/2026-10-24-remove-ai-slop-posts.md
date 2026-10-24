---
title: Remove 206 of 254 agent-written posts (editorial review)
category: decision
created: 2026-10-24
updated: 2026-10-24
related: [[blog-writer-agent]], [[2026-10-24-gate-measured-grounding-not-value]], [[2026-07-25-no-fabricated-experience]]
---

The blog writer agent was switched off and 206 of its 254 published posts were removed. This page is the record of why, how the cut was made, and how to undo it.

## Evidence

- **Search Console, 22 Jul – 21 Oct 2026:** the whole site had 1 click and 86 impressions. **0 of the 254 agent posts had a single impression.** Only 42 URLs on the site were indexed.
- **Duplication:** 236 of 254 had a sibling agent post within cosine distance 0.25; 75 within 0.15. The duplicate guard embeds the title only but the stored vectors are title + excerpt + body, so its 0.25 threshold was never comparable.
- **Defects in published text:** the literal label `[Inference]` in 7 posts, "not X, but Y" in 64 despite being banned, first-person claims of experience in 12.
- Same sources in every post: MIT 33 posts, McKinsey 40, Gartner 21, a 95% figure in 21.

## The cut

Each of the 254 was read in full by a reviewer against a 1–5 rubric (a skeptical founder who would only forward something useful). Scores: 1 → 3, 2 → 71, 3 → 125, 4 → 51, 5 → 4.

**Kept (48):** score ≥ 4, no leaked pipeline text, no claimed personal experience, and not within 0.15 of a higher-scored survivor. **Removed (206):** everything else. Score-3 posts were removed deliberately: "could be written by anyone from a Google search" is the failure this decision is about.

Human-written posts (298 live) were not reviewed or touched.

## How

- Each removed URL 301s to its nearest surviving post by embedding distance, or `/blog` when the nearest was ≥ 0.30 away (11 posts). Source of truth: [lib/blog-removed-redirects.json](../../lib/blog-removed-redirects.json), spread into `redirects()` in `next.config.ts`.
- Rows are **archived** (`archived_at`), never deleted. Redirects deploy first, archive after, so there is no 404 gap.
- Backup before the change: `pg_dump -t post -t post_revision` to `~/.gstack/backups/archos_pdb_post_2026-10-24_pre-slop-removal.dump`.
- The agent was disabled by setting `blog_agent_config.enabled = false` on PROD (via a `jsonb_set`, so the value stays an object).

## Undo

Clear `archived_at` on the post (`restoreFromArchive`), and delete its entry from the JSON file, or the 301 will keep winning.

## Open

The redesign is not done: the 20 queued topics, the static one-query topic supply, the title-only duplicate guard and the essay prompt are all unchanged. Do not re-enable the agent until [[2026-10-24-gate-measured-grounding-not-value]] is addressed.
