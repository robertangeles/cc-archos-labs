---
title: WordPress posts: named-person stories rewritten as hypotheticals
category: decision
created: 2026-10-24
updated: 2026-10-24
related: [[2026-10-24-scrub-duplicate-human-posts]], [[2026-07-25-no-fabricated-experience]], [[wp-inventory-2026-05-19]], [[2026-05-19-translation-layer-migration]]
---

24 live posts that came over from robertangeles.com told stories about named or described people ("A CEO friend recently told me…", "I watched a retail company spend $2 million…"). The owner could not vouch for them, so each story was rewritten as an explicit hypothetical on PROD. Nothing was archived or deleted.

## Why

The 253 WordPress posts were migrated on 2026-05-19 with the body text untouched; Claude only wrote excerpts, tags and a currency flag ([[2026-05-19-translation-layer-migration]]). The repo holds no record of whether the stories happened. Most were published one a day between 2025-06-01 and 2025-08-06, 500-700 words each, in the same shape (a story as the hook, then "the pattern"). That looks like a batch run; it is an inference, not a finding. Every live post, WordPress ones included, is bylined "Metis", an AI persona, so first-person claims sat under a byline that cannot have experienced them. Same principle as [[2026-07-25-no-fabricated-experience]], applied to older human-bylined content.

## What changed

72 paragraph edits across 24 posts, applied 2026-10-24 22:34 UTC in one guarded transaction (it commits only if every post still matches the text that was read). Backup first: `~/.gstack/backups/archos_pdb_post_2026-10-25_pre-wp-group-a.dump`.

- Each story now opens with "Picture / Consider / Imagine…" and keeps its point, numbers and quotes as illustration.
- Where the next paragraphs continue in past tense, the story stays in past tense; elsewhere it moved to present. Dangling "his / her / their" references were repointed.
- Removed outright: the "One director told me…" quote in `leaders-translators-technology-business-value`, and a few "I've seen / companies I've worked with" asides inside the same posts.

Posts: `transformation-fails-when-you-dont-translate`, `transformation-isnt-a-project-its-a-pattern-for-success`, `build-for-decisions-not-reports-why-legacy-bi-fails-front-lines`, `what-good-data-looks-like-to-the-c-suite`, `dashboards-dont-drive-decisions-people-do`, `the-ai-hype-trap-why-smart-businesses-focus-on-value-not-buzz`, `scaling-vs-repeating-noise-define-meaningful-growth-first`, `data-transformation-projects-never-finish-the-expert-truth`, `data-and-ai-transform-government-services-into-public-value`, `ai-hype-pays-better-than-truth-the-uncomfortable-choice`, `ai-will-never-replace-human-judgment-but-it-will-punish-weak`, `leaders-translators-technology-business-value`, `the-5-voices-missing-from-your-transformation-team`, `ai-ethics-practice-why-design-principles-beat-pr-statements`, `when-to-ignore-your-chief-data-officer-for-strategic-wins`, `you-built-a-dashboard-not-a-decision-system`, `data-gravity-ai-transformation`, `the-roi-of-psychological-safety`, `from-mvp-to-meaning-why-ai-pilots-fail-at-scale`, `if-your-data-isnt-trusted-it-isnt-useful-why-quality-beats-quantity`, `strategic-ai-is-boring-and-thats-why-it-works`, `data-as-infrastructure-not-exhaust-build-foundations-first`, `ai-psychology-whats-really-holding-business-back-in-2025`, `data-debt-is-strategy-debt-why-cleanup-is-executive-priority`.

Two more from the original list of 26 (`your-org-chart-isnt-your-culture-map-hidden-networks-rule`, `you-dont-have-a-data-problem-you-have-a-decision-problem`) were already retired as duplicates.

## Second batch: "I worked with" client stories (11 posts)

After the first batch a search found 11 more WordPress posts claiming client work ("One company I worked with…", "A team I coached…", "We rolled out a bot…"). Rewritten the same way on PROD, 19 edits, one guarded transaction, backup `~/.gstack/backups/archos_pdb_post_2026-10-25_pre-wp-group-b.dump`. Stories kept their past tense and only the lead-in changed ("Consider a company that killed…"); implied participation was removed ("A bot was rolled out", "When the company applied…"). The heading "A Real Example:" in `psychological-safety-in-automation` became "An Example:" because "real" was no longer true.

Posts: `ai-cant-fix-broken-culture`, `applied-ai-engineering-failure-modes`, `build-vs-buy-decision-framework`, `change-adoption-at-work`, `data-pipeline-governance-strategy-tax`, `if-your-data-cant-be-questioned-it-cant-be-trusted`, `psychological-safety-in-automation`, `query-optimisation-the-environmental-cost-nobody-talks-about`, `the-most-strategic-thing-an-executive-can-do-is-slow-down`, `transformation-starts-with-listening`, `vendor-control-framework-roadmap-latency-exportability-tco`.

Verified afterwards: no live post matches the first-person client phrasing, except `ai-decision-making-is-the-new-corporate-alibi`, whose hit is a quoted hypothetical.

## Still open

- **"A Real Example" sections about unnamed companies.** A phrase search after the second batch found nine more posts whose sections are headed "A Real Example" or "Case Study" and describe a specific company with figures, with no first-person phrasing for the regex to catch: `ai-governance-decision-rights`, `ai-infrastructure-strategy`, `ai-program-kpis`, `ai-roi-budget-that-pays-for-itself`, `conversational-analytics-is-replacing-dashboards` ("One client had five sales dashboards"), `executives-weaponize-uncertainty`, `lineage-that-leaders-trust`, `single-source-of-truth-without-religion`, `the-most-expensive-dashboard-in-the-company-the-one-nobody-trusts`. More cases without such headings are likely. A broader sweep for any specific-company anecdote is the next step if wanted.
- **Generic "I've seen this pattern" lines** (about 27 posts) were left alone.
- **Unnamed case claims with figures** ("A retail chain discovered this accidentally… stockouts dropped 40%") make no personal claim but carry invented-looking numbers. Not touched.
- **The "Metis" byline** on all live posts is a separate decision, tied to the pipeline redesign.
- The check is regex-based and only finds first-person or "X I know" phrasing.

## Undo

Restore the `content_md` of the 24 slugs from the first backup (and the 11 from the second). `post_revision` was not written by this edit.
